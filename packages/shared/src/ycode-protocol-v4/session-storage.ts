import { z } from "zod";

export const sessionStorageTargetSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    workspaceKey: z.string().trim().min(1),
  })
  .strict();
export const sessionStoragePreviewSchema = z
  .object({
    sessionId: z.string(),
    revision: z.string(),
    state: z.enum(["present", "cleanup-pending", "purged", "missing"]),
    logicalBytes: z.number().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    ownedFileBytes: z.number().nonnegative(),
    ownedFileCount: z.number().int().nonnegative(),
    blockers: z.array(
      z.enum([
        "session-active",
        "pending-input",
        "dependent-session",
        "workflow-reference",
        "workspace-mismatch",
        "unsafe-file",
        "shared-file",
        "missing-session",
      ]),
    ),
  })
  .strict();
export const sessionPurgeParamsSchema = sessionStorageTargetSchema
  .extend({
    expectedRevision: z.string().min(1),
    confirmPermanent: z.literal(true),
  })
  .strict();
export const sessionPurgeResultSchema = z
  .object({
    sessionId: z.string(),
    state: z.enum(["purged", "cleanup-pending"]),
    deletedRecords: z.number().int().nonnegative(),
    deletedLogicalBytes: z.number().nonnegative(),
    removedFileBytes: z.number().nonnegative(),
    pendingFileCount: z.number().int().nonnegative(),
    databaseFreeBytes: z.number().nonnegative(),
  })
  .strict();
export type SessionStorageTarget = z.infer<typeof sessionStorageTargetSchema>;
export type SessionStoragePreview = z.infer<typeof sessionStoragePreviewSchema>;
export type SessionPurgeParams = z.infer<typeof sessionPurgeParamsSchema>;
export type SessionPurgeResult = z.infer<typeof sessionPurgeResultSchema>;

/**
 * 共享会话库的只读统计。页面字节只来自 PRAGMA；文件字节来自实际文件，
 * 两者允许有并发写入造成的微小偏差，不能把差额解释成回收成功。
 */
export const sessionDatabaseStatsSchema = z
  .object({
    databaseBytes: z.number().nonnegative(),
    walBytes: z.number().nonnegative(),
    pageSize: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    freelistCount: z.number().int().nonnegative(),
    freelistBytes: z.number().nonnegative(),
    /** 0 = none, 1 = full, 2 = incremental（PRAGMA auto_vacuum 的原始值）。 */
    autoVacuum: z.number().int().min(0).max(2),
    journalMode: z.string().min(1),
  })
  .strict();

export const SESSION_DATABASE_MAINTENANCE_ACTIONS = [
  "vacuum",
  "incremental-vacuum",
  "optimize-only",
  "none",
] as const;
export const sessionDatabaseMaintenanceActionSchema = z.enum(SESSION_DATABASE_MAINTENANCE_ACTIONS);

export const SESSION_DATABASE_MAINTENANCE_STATUSES = ["optimized", "refused"] as const;
export const sessionDatabaseMaintenanceStatusSchema = z.enum(SESSION_DATABASE_MAINTENANCE_STATUSES);

export const SESSION_DATABASE_MAINTENANCE_REASONS = [
  "freelist-low",
  "sessions-active",
  "database-busy",
  "insufficient-disk-space",
] as const;
export const sessionDatabaseMaintenanceReasonSchema = z.enum(SESSION_DATABASE_MAINTENANCE_REASONS);

export const sessionDatabaseOptimizeParamsSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();

export const sessionDatabaseOptimizeResultSchema = z
  .object({
    status: sessionDatabaseMaintenanceStatusSchema,
    action: sessionDatabaseMaintenanceActionSchema,
    reason: sessionDatabaseMaintenanceReasonSchema.optional(),
    before: sessionDatabaseStatsSchema,
    after: sessionDatabaseStatsSchema,
    reclaimedBytes: z.number().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

export type SessionDatabaseStats = z.infer<typeof sessionDatabaseStatsSchema>;
export type SessionDatabaseMaintenanceAction = z.infer<
  typeof sessionDatabaseMaintenanceActionSchema
>;
export type SessionDatabaseMaintenanceStatus = z.infer<
  typeof sessionDatabaseMaintenanceStatusSchema
>;
export type SessionDatabaseMaintenanceReason = z.infer<
  typeof sessionDatabaseMaintenanceReasonSchema
>;
export type SessionDatabaseOptimizeParams = z.infer<typeof sessionDatabaseOptimizeParamsSchema>;
export type SessionDatabaseOptimizeResult = z.infer<typeof sessionDatabaseOptimizeResultSchema>;
