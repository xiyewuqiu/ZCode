// 清理清单与正文删除同事务提交；墓碑保留最小身份，防止旧进程 upsert 复活历史。
export const SESSION_PURGE_MIGRATION_SQL =
  `
  create table if not exists session_purge (
    session_id text primary key,
    workspace_key text not null,
    revision text not null,
    files_json text not null,
    deleted_records integer not null,
    logical_bytes integer not null,
    removed_file_bytes integer not null default 0,
    time_created integer not null
  );
  create trigger if not exists session_purge_no_recreate
    before insert on session
    when exists(select 1 from session_purge where session_id = new.id)
    begin select raise(abort, 'session_permanently_deleted'); end;
  create trigger if not exists session_purge_no_child
    before insert on session
    when exists(select 1 from session_purge where session_id = new.parent_id)
    begin select raise(abort, 'parent_session_permanently_deleted'); end;
` +
  [
    ["session", "id"],
    ["session", "parent_id"],
    ["message", "session_id"],
    ["part", "session_id"],
    ["todo", "session_id"],
    ["session_entry", "session_id"],
    ["session_target", "session_id"],
    ["session_input", "session_id"],
    ["model_usage", "session_id"],
    ["turn_usage", "session_id"],
    ["tool_usage", "session_id"],
    ["input_history", "session_id"],
    ["dwf_run", "parent_session_id"],
    ["dwf_actor", "session_id"],
    ["workflow_run", "parent_session_id"],
    ["workflow_activity", "child_session_id"],
    ["session_task_link", "parent_session_id"],
    ["session_task_link", "child_session_id"],
    ["local_setting", "scope_id"],
  ]
    .flatMap(([table, column]) =>
      ["insert", "update"].map(
        (operation) => `
  create trigger if not exists purge_guard_${table}_${column}_${operation}
    before ${operation} on ${table}
    when ${table === "local_setting" ? "new.scope = 'session' and" : ""}
      exists(select 1 from session_purge where session_id = new.${column})
    begin select raise(abort, 'session_permanently_deleted'); end;
`,
      ),
    )
    .join("\n");
