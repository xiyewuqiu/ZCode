import { stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  SessionDatabaseMaintenanceAction,
  SessionDatabaseMaintenanceReason,
  SessionDatabaseOptimizeParams,
  SessionDatabaseOptimizeResult,
  SessionDatabaseStats,
} from "@ycode/shared";

// SQLite 结果码低 8 位是 busy 家族（SQLITE_BUSY/SQLITE_BUSY_SNAPSHOT 等）。
const SQLITE_BUSY = 5;
// 维护调用只在同步片段内临时缩短等待；调用结束立刻恢复连接原有 busy_timeout。
const MAINTENANCE_BUSY_TIMEOUT_MS = 250;
// 低于这个规模整理文件几乎不会缩小，不值得付出 VACUUM 的独占锁与 2 倍空间。
const VACUUM_MIN_FREELIST_PAGES = 64;
const VACUUM_MIN_FREELIST_BYTES = 1024 * 1024;
const VACUUM_MIN_FREELIST_RATIO = 0.05;

function readPragmaNumber(db: DatabaseSync, name: string): number {
  const row = db.prepare(`pragma ${name}`).get() as Record<string, unknown> | undefined;
  const value = row?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readJournalMode(db: DatabaseSync): string {
  const row = db.prepare("pragma journal_mode").get() as Record<string, unknown> | undefined;
  const value = row?.journal_mode;
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : "unknown";
}

async function readFileBytes(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    // WAL/SHM 文件可能不存在；主库读取失败时 UI 会看到 0 而不是伪造大小。
    return 0;
  }
}

function withMaintenanceBusyTimeout<T>(db: DatabaseSync, run: () => T): T {
  const row = db.prepare("pragma busy_timeout").get() as Record<string, unknown> | undefined;
  const previous = typeof row?.timeout === "number" ? row.timeout : undefined;
  if (previous === undefined) return run();
  db.exec(`pragma busy_timeout = ${MAINTENANCE_BUSY_TIMEOUT_MS}`);
  try {
    return run();
  } finally {
    db.exec(`pragma busy_timeout = ${previous}`);
  }
}

function isSqliteBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    typeof (error as { errcode?: unknown }).errcode === "number" &&
    ((error as { errcode: number }).errcode & 0xff) === SQLITE_BUSY
  );
}

/** TRUNCATE checkpoint 成功才说明没有其它连接持有读/写快照；busy 时不继续 VACUUM。 */
function truncateWal(db: DatabaseSync): boolean {
  const row = db.prepare("pragma wal_checkpoint(truncate)").get() as
    | Record<string, unknown>
    | undefined;
  return Number(row?.busy ?? 0) === 0;
}

function shouldVacuum(stats: SessionDatabaseStats): boolean {
  if (stats.autoVacuum !== 0) return false;
  if (stats.freelistCount < VACUUM_MIN_FREELIST_PAGES) return false;
  return (
    stats.freelistBytes >=
    Math.max(VACUUM_MIN_FREELIST_BYTES, stats.databaseBytes * VACUUM_MIN_FREELIST_RATIO)
  );
}

async function hasSpaceForVacuum(dbPath: string, databaseBytes: number): Promise<boolean> {
  try {
    const info = await statfs(dirname(dbPath));
    return Number(info.bavail) * Number(info.bsize) >= databaseBytes;
  } catch {
    // 无法探测时不阻止；VACUUM 仍会因 SQLITE_FULL 失败并原样上抛，不伪报成功。
    return true;
  }
}

export async function readSessionDatabaseStats(
  db: DatabaseSync,
  dbPath: string,
): Promise<SessionDatabaseStats> {
  const pageSize = readPragmaNumber(db, "page_size");
  const freelistCount = readPragmaNumber(db, "freelist_count");
  return {
    databaseBytes: await readFileBytes(dbPath),
    walBytes: await readFileBytes(`${dbPath}-wal`),
    pageSize,
    pageCount: readPragmaNumber(db, "page_count"),
    freelistCount,
    freelistBytes: freelistCount * pageSize,
    autoVacuum: Math.min(2, Math.max(0, readPragmaNumber(db, "auto_vacuum"))),
    journalMode: readJournalMode(db),
  };
}

/**
 * 显式数据库整理。唯一所有者是持有 SQLite 连接的 Agent 进程：
 * checkpoint 预检 → PRAGMA optimize → 条件式 VACUUM/incremental_vacuum → checkpoint。
 * 锁冲突与空间不足以 refused 返回；SQLITE_FULL 等真实错误继续抛出。
 */
export async function optimizeSessionDatabase(
  db: DatabaseSync,
  dbPath: string,
  params: SessionDatabaseOptimizeParams,
): Promise<SessionDatabaseOptimizeResult> {
  if (params.confirm !== true) throw new Error("session_database_optimize_not_confirmed");
  const startedAt = Date.now();
  const before = await readSessionDatabaseStats(db, dbPath);
  const refused = (reason: SessionDatabaseMaintenanceReason): SessionDatabaseOptimizeResult => ({
    status: "refused",
    action: "none",
    reason,
    before,
    after: before,
    reclaimedBytes: 0,
    durationMs: Date.now() - startedAt,
  });

  if (before.journalMode === "wal" && !withMaintenanceBusyTimeout(db, () => truncateWal(db))) {
    return refused("database-busy");
  }

  try {
    withMaintenanceBusyTimeout(db, () => db.exec("pragma optimize"));
  } catch (error) {
    if (isSqliteBusy(error)) return refused("database-busy");
    throw error;
  }

  let action: SessionDatabaseMaintenanceAction = "optimize-only";
  let reason: SessionDatabaseMaintenanceReason | undefined = "freelist-low";
  if (before.autoVacuum === 2 && before.freelistCount > 0) {
    action = "incremental-vacuum";
    reason = undefined;
    try {
      withMaintenanceBusyTimeout(db, () => db.exec("pragma incremental_vacuum"));
    } catch (error) {
      if (isSqliteBusy(error)) return refused("database-busy");
      throw error;
    }
  } else if (shouldVacuum(before)) {
    if (!(await hasSpaceForVacuum(dbPath, before.databaseBytes)))
      return refused("insufficient-disk-space");
    action = "vacuum";
    reason = undefined;
    try {
      withMaintenanceBusyTimeout(db, () => db.exec("vacuum"));
    } catch (error) {
      if (isSqliteBusy(error)) return refused("database-busy");
      throw error;
    }
  }

  // VACUUM 后再次截断 WAL；busy 不改变已完成的整理结果，after.walBytes 会如实显示残留。
  if (before.journalMode === "wal") withMaintenanceBusyTimeout(db, () => truncateWal(db));

  const after = await readSessionDatabaseStats(db, dbPath);
  return {
    status: "optimized",
    action,
    ...(reason ? { reason } : {}),
    before,
    after,
    reclaimedBytes: Math.max(0, before.databaseBytes - after.databaseBytes),
    durationMs: Date.now() - startedAt,
  };
}
