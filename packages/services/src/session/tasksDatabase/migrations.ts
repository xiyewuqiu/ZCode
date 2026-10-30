import { databaseMigrationIdSchema, type DatabaseMigrationFacts } from "@ycode/shared";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  AUTOMATION_SCHEMA,
  OFF_PEAK_SCHEMA,
  TASK_INDEX_SCHEMA,
} from "#src/session/tasksDatabase/schema-v1.js";
import { importLegacyAutomationSelections } from "#src/session/tasksDatabase/provider-selection-v2.js";
import { OFFICIAL_GLM_SELECTION_MIGRATION_SQL } from "#src/session/tasksDatabase/official-glm-selection-v3.js";
import { TASK_STORAGE_PURGE_MIGRATION_SQL } from "#src/session/tasksDatabase/task-storage-purge-v4.js";
import { CONTROLLER_REMOTE_SCHEMA_SQL } from "#src/session/tasksDatabase/controller-remote-schema-v4.js";
import {
  adoptSourceServerWorkspaceSchema,
  SOURCE_SERVER_SCHEMA_CHECKSUM_INPUT,
} from "#src/session/tasksDatabase/source-server-schema-v5.js";

// 冻结历史列声明，不能以实时 Repo/schema 代替，否则新版构建会改变已应用 checksum。
const columns = [
  ["tasks", "title_overridden", "INTEGER NOT NULL DEFAULT 0"],
  ["tasks", "last_unread_at", "INTEGER NOT NULL DEFAULT 0"],
  ["tasks", "searchable_text", "TEXT NOT NULL DEFAULT ''"],
  ["tasks", "cron_automation_id", "TEXT"],
  ["tasks", "off_peak_task_id", "TEXT"],
  ["automations", "target_task_id", "TEXT"],
  ["automations", "bot_delivery_target", "TEXT"],
  ["automations", "mode", "TEXT"],
  ["automations", "end_at", "INTEGER"],
  ["automations", "schedule_rule", "TEXT"],
  ["automations", "schedule_edited_by_user", "INTEGER NOT NULL DEFAULT 0"],
  ["automations", "thought_level", "TEXT"],
  ["automations", "model_selection", "TEXT"],
  ["automations", "scheduled_run_count", "INTEGER NOT NULL DEFAULT 0"],
  ["automation_runs", "model_selection", "TEXT"],
  ["off_peak_tasks", "thought_level", "TEXT"],
  ["off_peak_tasks", "model_selection", "TEXT"],
  ["off_peak_tasks", "history_deleted_at", "INTEGER"],
] as const;
const indexes = `
  CREATE INDEX IF NOT EXISTS idx_tasks_cron_automation ON tasks(cron_automation_id, updated_at DESC)
    WHERE cron_automation_id IS NOT NULL AND deleted=0;
  CREATE INDEX IF NOT EXISTS idx_tasks_off_peak_task ON tasks(off_peak_task_id, updated_at DESC)
    WHERE off_peak_task_id IS NOT NULL AND deleted=0;
  CREATE INDEX IF NOT EXISTS idx_automations_target_task ON automations(target_task_id) WHERE target_task_id IS NOT NULL;
`;
const terminalStatuses = "'completed','failed','cancelled'";
const activePredicate = `session_id IS NOT NULL AND status NOT IN (${terminalStatuses})`;
const boundIndex = `CREATE UNIQUE INDEX IF NOT EXISTS idx_off_peak_bound_active ON off_peak_tasks(workspace_key,session_id) WHERE ${activePredicate}`;

// 0005 只追加 CLI 事实列；逐列 PRAGMA 检查保证中断后重跑安全，回填只碰 NULL/旧壳位。
const taskFactColumns = [
  ["cli_title", "TEXT"],
  ["cli_title_source", "TEXT"],
  ["cli_created_at", "INTEGER"],
  ["cli_updated_at", "INTEGER"],
  ["cli_last_outcome", "TEXT"],
  ["cli_deleted", "INTEGER"],
  ["handoff_pending", "INTEGER NOT NULL DEFAULT 0"],
] as const;
const taskFactBackfillSql = `
  UPDATE tasks SET
    cli_title=coalesce(cli_title,title),
    cli_title_source=coalesce(cli_title_source, CASE WHEN title_overridden=1 THEN 'custom' ELSE 'default' END),
    cli_created_at=coalesce(cli_created_at,created_at),
    cli_updated_at=coalesce(cli_updated_at,updated_at),
    cli_deleted=coalesce(cli_deleted,deleted),
    handoff_pending=coalesce(handoff_pending,0)
      | CASE WHEN deleted=1 THEN 1 ELSE 0 END
      | CASE WHEN title_overridden=1 THEN 2 ELSE 0 END;
`;

// 与 Agent 同样是库级串行事务，但不跨域依赖其具体 adapter。TS 转换使用冻结语义版本，
// 禁用 function.toString 哈希：Electron/SEA 打包会改变函数文本而非迁移语义。
const definitions = [
  {
    id: "0001_adopt_task_schema",
    checksumInput: [
      TASK_INDEX_SCHEMA,
      AUTOMATION_SCHEMA,
      OFF_PEAK_SCHEMA,
      columns,
      indexes,
      boundIndex,
      "scheduled-count-backfill-v1",
    ],
    apply: adoptSchema,
  },
  {
    id: "0002_provider_selection",
    checksumInput: ["legacy-automation-selection-v1", "no-provider-for-legacy-off-peak-v1"],
    apply: importLegacyAutomationSelections,
  },
  {
    id: "0003_official_glm_selection",
    checksumInput: [OFFICIAL_GLM_SELECTION_MIGRATION_SQL],
    apply: (db: DatabaseSync) => db.exec(OFFICIAL_GLM_SELECTION_MIGRATION_SQL),
  },
  {
    id: "0004_task_storage_purge",
    checksumInput: [TASK_STORAGE_PURGE_MIGRATION_SQL],
    apply: (db: DatabaseSync) => db.exec(TASK_STORAGE_PURGE_MIGRATION_SQL),
  },
  {
    id: "0005_task_facts_columns",
    checksumInput: [taskFactColumns, taskFactBackfillSql],
    apply: adoptTaskFactsSchema,
  },
] as const;

export type TasksDatabaseMigrationScope = "base" | "controller-remote" | "source-server";

interface TasksDatabaseMigrationOptions {
  scope?: TasksDatabaseMigrationScope;
  transactionOpen?: boolean;
  migration?: DatabaseMigrationFacts;
  onProgress?: (phase: "migrating" | "committing", migration: DatabaseMigrationFacts) => void;
}

interface TasksDatabaseMigrationDefinition {
  id: string;
  checksumInput: unknown;
  apply: (db: DatabaseSync) => void;
}

/**
 * 两端专属表仍归同库账本协调，不会为另一端创建无关表。
 * Source/Controller 的扩展迁移与 Core 基础迁移写入同一个 ledger，按 scope 分别校验。
 */
function prepareMigrations(
  scope: TasksDatabaseMigrationScope,
): readonly TasksDatabaseMigrationDefinition[] {
  if (scope === "controller-remote")
    return [
      {
        id: "0004_controller_remote_identity",
        checksumInput: [CONTROLLER_REMOTE_SCHEMA_SQL],
        apply: (db) => db.exec(CONTROLLER_REMOTE_SCHEMA_SQL),
      },
    ];
  if (scope === "source-server")
    return [
      {
        id: "0005_source_server_workspace_schema",
        checksumInput: SOURCE_SERVER_SCHEMA_CHECKSUM_INPUT,
        apply: adoptSourceServerWorkspaceSchema,
      },
    ];
  return definitions;
}

function migrationChecksum(migration: TasksDatabaseMigrationDefinition): string {
  return createHash("sha256").update(JSON.stringify(migration.checksumInput)).digest("hex");
}

export function runTasksDatabaseMigrations(
  db: DatabaseSync,
  scopeOrOptions: TasksDatabaseMigrationScope | TasksDatabaseMigrationOptions = "base",
): void {
  const options: TasksDatabaseMigrationOptions =
    typeof scopeOrOptions === "string" ? { scope: scopeOrOptions } : scopeOrOptions;
  const scope = options.scope ?? "base";
  const migrations = prepareMigrations(scope);
  // 已应用的库不再取得写锁；Source 身份查询/连接恢复可能在别的连接持有写锁时只读返回。
  if (!options.transactionOpen && areTasksDatabaseMigrationsApplied(db, scope)) return;
  if (!options.transactionOpen) db.exec("BEGIN IMMEDIATE");
  const migrationFacts: DatabaseMigrationFacts = options.migration ?? {
    kind: "none",
    executedCount: 0,
    committedCount: 0,
  };
  let currentMigrationId: string | undefined;
  try {
    if (!options.migration) migrationFacts.kind = inspectTasksMigrationKind(db, scope);
    db.exec(`CREATE TABLE IF NOT EXISTS tasks_schema_migration (
      id TEXT PRIMARY KEY, checksum TEXT NOT NULL, time_applied INTEGER NOT NULL
    )`);
    // 锁内、版本 SQL 之前采集；空账本是 none，异常编号不作为遥测原文发送。
    const baseline = db
      .prepare("SELECT id FROM tasks_schema_migration ORDER BY id DESC LIMIT 1")
      .get();
    migrationFacts.lastAppliedMigrationId = baseline
      ? databaseMigrationIdSchema.safeParse(baseline.id).data
      : null;
    for (const migration of migrations) {
      currentMigrationId = migration.id;
      const checksum = migrationChecksum(migration);
      const applied = db
        .prepare("SELECT checksum FROM tasks_schema_migration WHERE id=?")
        .get(migration.id);
      if (applied) {
        if (applied.checksum !== checksum)
          throw Object.assign(
            new Error(`Task database migration checksum mismatch: ${migration.id}`),
            { kind: "checksum_mismatch" },
          );
        continue;
      }
      if (migrationFacts.kind === "none") migrationFacts.kind = "upgrade";
      options.onProgress?.("migrating", { ...migrationFacts });
      migration.apply(db);
      migrationFacts.executedCount++;
      db.prepare("INSERT INTO tasks_schema_migration VALUES(?,?,?)").run(
        migration.id,
        checksum,
        Date.now(),
      );
    }
    options.onProgress?.("committing", { ...migrationFacts });
    db.exec("COMMIT");
    migrationFacts.committedCount = migrationFacts.executedCount;
  } catch (error) {
    // 回滚也可能因 IO 失败，不能覆盖真正导致迁移失败的异常。
    try {
      if (db.isTransaction) db.exec("ROLLBACK");
    } catch {
      /* 调用方关闭连接恢复。 */
    }
    if (error && typeof error === "object" && currentMigrationId)
      Object.assign(error, { migrationId: currentMigrationId });
    throw error;
  }
}

function adoptSchema(db: DatabaseSync): void {
  db.exec(TASK_INDEX_SCHEMA + AUTOMATION_SCHEMA + OFF_PEAK_SCHEMA);
  for (const [table, column, definition] of columns) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.some((entry) => entry.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (table === "automations" && column === "scheduled_run_count") {
      db.exec("UPDATE automations SET scheduled_run_count=run_count");
    }
  }
  db.exec(indexes);
  // 沿用已裁决的旧重复绑定保留策略，但不再吞掉权限/语法/磁盘等真实 SQL 错误。
  const duplicate = db
    .prepare(`SELECT 1 FROM off_peak_tasks WHERE ${activePredicate}
    GROUP BY workspace_key, session_id HAVING count(*)>1 LIMIT 1`)
    .get();
  if (!duplicate) db.exec(boundIndex);
}

/**
 * additive CLI 事实列。PRAGMA 检查让中断/重复执行安全；回填只补空值和旧壳位，
 * 不重写已有 CLI 事实、正文或组织态。
 */
function adoptTaskFactsSchema(db: DatabaseSync): void {
  const existing = new Set(
    (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map(
      (entry) => entry.name,
    ),
  );
  for (const [column, definition] of taskFactColumns) {
    if (existing.has(column)) continue;
    db.exec(`ALTER TABLE tasks ADD COLUMN ${column} ${definition}`);
  }
  db.exec(taskFactBackfillSql);
}

/** 交接只复用已完成初始化；每个新连接仍按冻结账本确认，替换/清空文件不能假 ready。 */
export function areTasksDatabaseMigrationsApplied(
  db: DatabaseSync,
  scope: TasksDatabaseMigrationScope = "base",
): boolean {
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_schema_migration'")
      .get()
  )
    return false;
  for (const migration of prepareMigrations(scope)) {
    const row = db
      .prepare("SELECT checksum FROM tasks_schema_migration WHERE id=?")
      .get(migration.id);
    if (!row) return false;
    if (row.checksum !== migrationChecksum(migration))
      throw Object.assign(new Error(`Task database migration checksum mismatch: ${migration.id}`), {
        kind: "checksum_mismatch",
      });
  }
  return true;
}

/** 只读账本的展示预检，不授权执行；迁移 runner 拿锁后仍复查每一项。 */
export function inspectTasksMigrationKind(
  db: DatabaseSync,
  scope: TasksDatabaseMigrationScope = "base",
): DatabaseMigrationFacts["kind"] {
  const hasLedger = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_schema_migration'")
    .get();
  let pending = false;
  for (const migration of prepareMigrations(scope)) {
    const row = hasLedger
      ? db.prepare("SELECT checksum FROM tasks_schema_migration WHERE id=?").get(migration.id)
      : undefined;
    if (!row) pending = true;
    else if (row.checksum !== migrationChecksum(migration))
      throw Object.assign(new Error(`Task database migration checksum mismatch: ${migration.id}`), {
        kind: "checksum_mismatch",
        migrationId: migration.id,
      });
  }
  if (!pending) return "none";
  return db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT IN ('tasks_schema_migration', 'sqlite_sequence') LIMIT 1",
    )
    .get()
    ? "upgrade"
    : "initialize";
}
