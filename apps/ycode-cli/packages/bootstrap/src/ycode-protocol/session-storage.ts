import {
  sessionDatabaseOptimizeParamsSchema,
  sessionPurgeParamsSchema,
  sessionStorageTargetSchema,
  type SessionDatabaseOptimizeResult,
} from "@ycode/shared";
import type { YCodeProtocolAgentServerContext } from "./server-types.js";

/** 共享会话库只读统计；不改变连接、锁或业务表。 */
export async function readSessionDatabaseStats(context: YCodeProtocolAgentServerContext) {
  const store = context.deps.sessionStore;
  if (!store?.getSessionDatabaseStats) throw new Error("session_storage_unavailable");
  return await store.getSessionDatabaseStats();
}

/**
 * 显式整理共享会话库。存在运行中/排队/待交互会话时直接拒绝；
 * 取进程维护闸门后由 store 执行 checkpoint + optimize + 条件式 VACUUM。
 */
export async function optimizeSessionDatabase(
  context: YCodeProtocolAgentServerContext,
  input: unknown,
): Promise<SessionDatabaseOptimizeResult> {
  const params = sessionDatabaseOptimizeParamsSchema.parse(input);
  const store = context.deps.sessionStore;
  const pool = context.sessionResidentPool;
  if (!store?.optimizeSessionDatabase || !store.getSessionDatabaseStats)
    throw new Error("session_storage_unavailable");
  const startedAt = Date.now();
  const before = await store.getSessionDatabaseStats();
  const refused = (reason: "sessions-active" | "database-busy"): SessionDatabaseOptimizeResult => ({
    status: "refused",
    action: "none",
    reason,
    before,
    after: before,
    reclaimedBytes: 0,
    durationMs: Date.now() - startedAt,
  });
  if (pool?.hasActiveWork()) return refused("sessions-active");

  let release: (() => void) | undefined;
  try {
    release = pool?.acquireStorageMaintenance();
  } catch {
    // 还有协议请求或去激活在飞：快速拒绝，不排队等待 SQLite 锁。
    return refused("database-busy");
  }
  try {
    const result = await store.optimizeSessionDatabase(params);
    context.logger?.info("Session database maintenance finished", {
      event: "ycode_protocol.storage.database.optimized",
      maintenanceStatus: result.status,
      action: result.action,
      ...(result.reason ? { reason: result.reason } : {}),
      databaseBytesBefore: result.before.databaseBytes,
      databaseBytesAfter: result.after.databaseBytes,
      freelistPagesBefore: result.before.freelistCount,
      freelistPagesAfter: result.after.freelistCount,
      reclaimedBytes: result.reclaimedBytes,
      durationMs: result.durationMs,
    });
    return result;
  } finally {
    release?.();
  }
}

export async function previewSessionStorage(
  context: YCodeProtocolAgentServerContext,
  input: unknown,
) {
  const target = sessionStorageTargetSchema.parse(input);
  const store = context.deps.sessionStore;
  if (!store?.previewSessionStorage) throw new Error("session_storage_unavailable");
  const preview = await store.previewSessionStorage(target);
  if (
    context.sessionResidentPool?.isStorageBlocked(target.sessionId) &&
    !preview.blockers.includes("session-active")
  ) {
    preview.blockers.push("session-active");
  }
  return preview;
}

export async function purgeSessionStorage(
  context: YCodeProtocolAgentServerContext,
  input: unknown,
) {
  const params = sessionPurgeParamsSchema.parse(input);
  const store = context.deps.sessionStore;
  const pool = context.sessionResidentPool;
  if (!store?.purgeSessionStorage || !store.previewSessionStorage || !pool)
    throw new Error("session_storage_unavailable");
  const release = pool.acquireStorageMaintenance();
  try {
    const preview = await previewSessionStorage(context, {
      sessionId: params.sessionId,
      workspaceKey: params.workspaceKey,
    });
    if (preview.blockers.length)
      throw new Error(`session_purge_blocked:${preview.blockers.join(",")}`);
    if (preview.revision !== params.expectedRevision)
      throw new Error("session_purge_stale_preview");
    await pool.deactivateForStorage(params.sessionId);
    const result = await store.purgeSessionStorage(params);
    context.logger?.info("Session storage purge committed", {
      event: "ycode_protocol.session.purged",
      sessionId: params.sessionId,
      state: result.state,
      deletedRecords: result.deletedRecords,
      pendingFileCount: result.pendingFileCount,
    });
    return result;
  } finally {
    release();
  }
}
