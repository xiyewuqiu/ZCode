import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectStorage } from "../src/project-storage/index.js";

const mixedSettings = {
  recentProjects: [],
  lastWorkspaceSession: [
    { kind: "local" as const, workspacePath: "/a" },
    {
      kind: "remote" as const,
      workspacePath: "/a",
      target: { kind: "ssh" as const, host: "example.test", username: "dev", port: 22 },
      lastOpenedAt: 1,
      lastConnectionStatus: "failed" as const,
    },
    { kind: "local" as const, workspacePath: "/b" },
  ],
};

function fixture(root: string) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks (
    workspace_key TEXT, workspace_path TEXT, workspace_identity TEXT, task_id TEXT,
    title TEXT DEFAULT '', provider TEXT DEFAULT 'glm', title_overridden INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, unread_at INTEGER,
    task_status TEXT DEFAULT 'completed', created_at INTEGER DEFAULT 1, updated_at INTEGER DEFAULT 2,
    PRIMARY KEY(workspace_key,task_id));
    CREATE TABLE task_groups(group_id TEXT PRIMARY KEY,title TEXT,color TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE task_group_members(group_id TEXT,workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,sort_order INTEGER);
    CREATE TABLE task_group_workspace_bootstraps(workspace_key TEXT PRIMARY KEY,group_id TEXT);
    CREATE TABLE task_group_view_node_orders(node_type TEXT,node_key TEXT,sort_order INTEGER);
    CREATE TABLE automations(automation_id TEXT PRIMARY KEY,workspace_key TEXT,workspace_path TEXT);
    CREATE TABLE off_peak_tasks(off_peak_task_id TEXT PRIMARY KEY,workspace_key TEXT,workspace_path TEXT);
    CREATE TABLE untouched(id TEXT PRIMARY KEY,value TEXT);
    INSERT INTO untouched VALUES ('keep','unchanged');`);
  return {
    db,
    context: {
      backupDirectories: [root],
      now: () => 10,
      settings: mixedSettings,
    },
  };
}

const plain = (row: object) => Object.fromEntries(Object.entries(row));

test("first upgrade preserves mixed local/remote order and restart does not rewrite it", async () => {
  const root = await mkdtemp(join(tmpdir(), "ycode-project-order-"));
  const { db, context } = fixture(root);
  try {
    await projectStorage.migrate(db, context);
    assert.deepEqual(
      projectStorage
        .repository(db)
        .readTree()
        .projects.map((project) => [project.name, project.position]),
      [
        ["a", 0],
        ["b", 2],
      ],
    );
    assert.deepEqual(
      plain(db.prepare("SELECT initial_position FROM remote_project_entries").get()!),
      {
        initial_position: 1,
      },
    );

    db.exec("UPDATE projects SET position=10-position");
    const before = db
      .prepare("SELECT * FROM projects ORDER BY project_id")
      .all()
      .map((row) => plain(row));
    const migrated = await projectStorage.migrate(db, {
      ...context,
      settings: {
        ...mixedSettings,
        lastWorkspaceSession: [...mixedSettings.lastWorkspaceSession].reverse(),
      },
    });
    assert.deepEqual(migrated.applied, []);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM projects ORDER BY project_id")
        .all()
        .map((row) => plain(row)),
      before,
    );
    assert.deepEqual(
      plain(db.prepare("SELECT initial_position FROM remote_project_entries").get()!),
      {
        initial_position: 1,
      },
    );
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an already upgraded project ledger does not seed mixed order again", async () => {
  const root = await mkdtemp(join(tmpdir(), "ycode-project-order-ledger-"));
  const { db, context } = fixture(root);
  try {
    // 提前写入 0005 ledger 模拟已升级库，再跑完整迁移。
    db.exec(
      "CREATE TABLE schema_migration(id TEXT PRIMARY KEY,checksum TEXT,app_version TEXT,applied_at INTEGER)",
    );
    const { migrateProjects } = await import("../src/project-storage/migrate-projects.js");
    migrateProjects(db, context);
    db.prepare("INSERT INTO schema_migration VALUES(?,?,?,?)").run(
      "0005_projects",
      "ac00a61c7c45a5ceb3814b1487901372c5580eb6eb8d31bde5bcdfbd1ed0f0da",
      "3.16.1",
      10,
    );
    db.exec("UPDATE projects SET position=10-position,name='edited-'||name");
    const before = db
      .prepare("SELECT * FROM projects ORDER BY project_id")
      .all()
      .map((row) => plain(row));
    await projectStorage.migrate(db, context);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM projects ORDER BY project_id")
        .all()
        .map((row) => plain(row)),
      before,
    );
    assert.deepEqual(
      plain(db.prepare("SELECT initial_position FROM remote_project_entries").get()!),
      {
        initial_position: null,
      },
    );
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
