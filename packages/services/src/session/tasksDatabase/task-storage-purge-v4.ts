export const TASK_STORAGE_PURGE_MIGRATION_SQL = `
  CREATE TABLE task_storage_purge (
    workspace_key TEXT NOT NULL,
    task_id TEXT NOT NULL,
    PRIMARY KEY (workspace_key, task_id)
  );
  CREATE TRIGGER task_storage_purge_no_refill_insert BEFORE INSERT ON tasks
    WHEN EXISTS(SELECT 1 FROM task_storage_purge WHERE workspace_key=new.workspace_key AND task_id=new.task_id)
    BEGIN SELECT RAISE(IGNORE); END;
  CREATE TRIGGER task_storage_purge_no_refill_update BEFORE UPDATE ON tasks
    WHEN EXISTS(SELECT 1 FROM task_storage_purge WHERE workspace_key=old.workspace_key AND task_id=old.task_id)
      AND (new.title != '' OR new.searchable_text != '' OR new.meta_json != old.meta_json
        OR new.deleted < old.deleted OR new.archived != 1 OR new.pinned != 0)
    BEGIN SELECT RAISE(IGNORE); END;
`;
