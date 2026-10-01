import { sessionPurgeParamsSchema, sessionStorageTargetSchema } from "@zcode/shared";
import type { ZCodeProtocolAgentServerContext } from "./server-types.js";

export async function previewSessionStorage(
  context: ZCodeProtocolAgentServerContext,
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
  context: ZCodeProtocolAgentServerContext,
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
      event: "zcode_protocol.session.purged",
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
