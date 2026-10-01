import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  sessionPurgeParamsSchema,
  sessionStorageTargetSchema,
  type SessionPurgeParams,
  type SessionPurgeResult,
  type SessionStoragePreview,
  type SessionStorageTarget,
} from "@zcode/shared";
import { PURGE_ROWS, hasSharedSessionFiles, readPurgeData } from "./session-purge-data.js";
import { removeOwnedFile, scanOwnedFiles, type PurgeFile } from "./session-purge-files.js";

interface PurgeLedger {
  workspace_key: string;
  revision: string;
  files_json: string;
  deleted_records: number;
  logical_bytes: number;
  removed_file_bytes: number;
}

/** SQLite 是永久删除事实的唯一所有者；文件清单与正文删除必须在同一事务落盘。 */
export class SessionPurgeStorage {
  private readonly pending = new Map<string, Promise<SessionPurgeResult>>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly storageRoot: string,
  ) {}

  private ledger(sessionId: string): PurgeLedger | undefined {
    return this.db
      .prepare("select * from session_purge where session_id = ?")
      .get(sessionId) as unknown as PurgeLedger | undefined;
  }

  private async inspect(target: SessionStorageTarget) {
    const ledger = this.ledger(target.sessionId);
    if (ledger) {
      const files = JSON.parse(ledger.files_json) as PurgeFile[];
      return {
        files,
        preview: {
          sessionId: target.sessionId,
          revision: ledger.revision,
          state: files.length ? "cleanup-pending" : "purged",
          logicalBytes: 0,
          recordCount: 0,
          ownedFileBytes: files.reduce((sum, file) => sum + file.size, 0),
          ownedFileCount: files.length,
          blockers: ledger.workspace_key === target.workspaceKey ? [] : ["workspace-mismatch"],
        } satisfies SessionStoragePreview,
      };
    }
    let files: PurgeFile[] = [];
    const fileBlockers: SessionStoragePreview["blockers"] = [];
    try {
      files = await scanOwnedFiles(this.storageRoot, target.sessionId);
    } catch {
      fileBlockers.push("unsafe-file");
    }
    const data = readPurgeData(this.db, target);
    if (files.length && hasSharedSessionFiles(this.db, target.sessionId))
      fileBlockers.push("shared-file");
    return {
      files,
      dataRevision: data.dataRevision,
      preview: {
        sessionId: target.sessionId,
        revision: createHash("sha256")
          .update(data.dataRevision)
          .update(JSON.stringify(files))
          .digest("hex"),
        state: data.present ? "present" : "missing",
        logicalBytes: data.logicalBytes,
        recordCount: data.recordCount,
        ownedFileBytes: files.reduce((sum, file) => sum + file.size, 0),
        ownedFileCount: files.length,
        blockers: [...data.blockers, ...fileBlockers],
      } satisfies SessionStoragePreview,
    };
  }

  async preview(input: SessionStorageTarget): Promise<SessionStoragePreview> {
    return (await this.inspect(sessionStorageTargetSchema.parse(input))).preview;
  }

  async purge(input: SessionPurgeParams): Promise<SessionPurgeResult> {
    const params = sessionPurgeParamsSchema.parse(input);
    // 不合并不同身份/版本的调用，避免越权复用另一个请求的成功结果。
    if (this.pending.has(params.sessionId)) throw new Error("session_storage_busy");
    const operation = this.execute(params);
    this.pending.set(params.sessionId, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(params.sessionId);
    }
  }

  private async execute(params: SessionPurgeParams): Promise<SessionPurgeResult> {
    const inspection = await this.inspect(params);
    if (inspection.preview.blockers.length)
      throw new Error(`session_purge_blocked:${inspection.preview.blockers.join(",")}`);
    if (inspection.preview.revision !== params.expectedRevision)
      throw new Error("session_purge_stale_preview");
    this.db.exec("begin immediate");
    try {
      const previous = this.ledger(params.sessionId);
      if (previous) {
        if (
          previous.workspace_key !== params.workspaceKey ||
          previous.revision !== params.expectedRevision
        )
          throw new Error("session_purge_stale_preview");
      } else {
        const fresh = readPurgeData(this.db, params);
        if (fresh.blockers.length)
          throw new Error(`session_purge_blocked:${fresh.blockers.join(",")}`);
        if (fresh.dataRevision !== inspection.dataRevision)
          throw new Error("session_purge_stale_preview");
        if (inspection.files.length && hasSharedSessionFiles(this.db, params.sessionId))
          throw new Error("session_purge_blocked:shared-file");
        this.db
          .prepare(
            "insert into session_purge(session_id,workspace_key,revision,files_json,deleted_records,logical_bytes,time_created) values(?,?,?,?,?,?,?)",
          )
          .run(
            params.sessionId,
            params.workspaceKey,
            params.expectedRevision,
            JSON.stringify(inspection.files),
            fresh.recordCount,
            fresh.logicalBytes,
            Date.now(),
          );
        for (const [table, predicate] of PURGE_ROWS)
          this.db.prepare(`delete from ${table} where ${predicate}`).run(params.sessionId);
      }
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }

    const ledger = this.ledger(params.sessionId)!;
    for (const file of JSON.parse(ledger.files_json) as PurgeFile[]) {
      let removed: boolean;
      try {
        removed = await removeOwnedFile(this.storageRoot, params.sessionId, file);
      } catch {
        continue;
      } // 文件错误由持久待清理数反馈，不伪报成功；后续请求可重试。
      // 跨进程重试只移除一次清单项；崩溃于 unlink 后时不虚报已确认回收字节。
      this.db
        .prepare(`update session_purge set files_json = (
        select coalesce(json_group_array(json(value)), '[]') from json_each(files_json) where json_extract(value, '$.path') != ?
      ), removed_file_bytes = removed_file_bytes + ? where session_id = ?
        and exists(select 1 from json_each(files_json) where json_extract(value, '$.path') = ?)`)
        .run(file.path, removed ? file.size : 0, params.sessionId, file.path);
    }
    const completed = this.ledger(params.sessionId)!;
    const remaining = (JSON.parse(completed.files_json) as PurgeFile[]).length;
    const freePages = Number(this.db.prepare("pragma freelist_count").get()?.freelist_count ?? 0);
    const pageSize = Number(this.db.prepare("pragma page_size").get()?.page_size ?? 0);
    return {
      sessionId: params.sessionId,
      state: remaining ? "cleanup-pending" : "purged",
      deletedRecords: completed.deleted_records,
      deletedLogicalBytes: completed.logical_bytes,
      removedFileBytes: completed.removed_file_bytes,
      pendingFileCount: remaining,
      databaseFreeBytes: freePages * pageSize,
    };
  }
}
