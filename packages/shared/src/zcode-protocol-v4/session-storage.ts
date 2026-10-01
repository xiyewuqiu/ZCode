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
