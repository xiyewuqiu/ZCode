import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SessionStoragePreview, SessionStorageTarget } from "@zcode/shared";

// 固定表/谓词来自存储 schema，不能接受协议提供的 SQL 标识符。
export const PURGE_ROWS = [
  ["part", "session_id = ?"],
  ["message", "session_id = ?"],
  ["todo", "session_id = ?"],
  ["session_entry", "session_id = ?"],
  ["session_target", "session_id = ?"],
  ["model_usage", "session_id = ?"],
  ["turn_usage", "session_id = ?"],
  ["tool_usage", "session_id = ?"],
  ["session_input", "session_id = ?"],
  ["input_history", "session_id = ?"],
  ["local_setting", "scope = 'session' and scope_id = ?"],
  ["session", "id = ?"],
] as const;

export function readPurgeData(db: DatabaseSync, target: SessionStorageTarget) {
  const { sessionId, workspaceKey } = target;
  const blockers: SessionStoragePreview["blockers"] = [];
  const session = db
    .prepare("select workspace_id, directory from session where id = ?")
    .get(sessionId);
  if (!session) blockers.push("missing-session");
  else if ((String(session.workspace_id ?? "").trim() || session.directory) !== workspaceKey)
    blockers.push("workspace-mismatch");
  const exists = (sql: string) => Boolean(db.prepare(sql).get(sessionId));
  if (exists("select 1 from session where parent_id = ? limit 1"))
    blockers.push("dependent-session");
  if (
    [
      "select 1 from workflow_run where parent_session_id = ? limit 1",
      "select 1 from workflow_activity where child_session_id = ? limit 1",
      "select 1 from dwf_run where parent_session_id = ? limit 1",
      "select 1 from dwf_actor where session_id = ? limit 1",
      "select 1 from session_task_link where parent_session_id = ? limit 1",
      "select 1 from session_task_link where child_session_id = ? limit 1",
    ].some(exists)
  )
    blockers.push("workflow-reference");
  if (exists("select 1 from session_input where session_id = ? and status = 'admitted' limit 1"))
    blockers.push("pending-input");
  if (
    [
      "select 1 from session_target where session_id = ? and (status = 'active' or active_input_id is not null) limit 1",
      ...["model_usage", "turn_usage", "tool_usage"].map(
        (table) => `select 1 from ${table} where session_id = ? and status = 'running' limit 1`,
      ),
    ].some(exists)
  )
    blockers.push("session-active");
  const hash = createHash("sha256");
  let logicalBytes = 0,
    recordCount = 0;
  // 流式遍历单会话的记录，避免将长会话正文复制成大数组或 RPC 响应。
  for (const [table, predicate] of PURGE_ROWS) {
    hash.update(table);
    for (const row of db
      .prepare(`select * from ${table} where ${predicate} order by rowid`)
      .iterate(sessionId)) {
      const data = JSON.stringify(row);
      hash.update(data);
      logicalBytes += Buffer.byteLength(data);
      recordCount++;
    }
  }
  return {
    blockers,
    logicalBytes,
    recordCount,
    dataRevision: hash.digest("hex"),
    present: Boolean(session),
  };
}

export function hasSharedSessionFiles(db: DatabaseSync, sessionId: string): boolean {
  // 分叉/导入可以复用源会话产物。无法证明独占时阻止文件删除，避免断开其它会话附件。
  return [
    ["message", "data"],
    ["part", "data"],
    ["session_entry", "data"],
    ["input_history", "text"],
    ["session_input", "payload"],
  ].some(([table, column]) =>
    Boolean(
      db
        .prepare(
          `select 1 from ${table} where session_id is not ? and instr(${column}, ?) > 0 limit 1`,
        )
        .get(sessionId, sessionId),
    ),
  );
}
