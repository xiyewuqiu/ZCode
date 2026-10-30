import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectStorage } from "../src/project-storage/index.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { setDataBaseDir } from "../src/paths.js";

test("project-storage migration is additive and creates projects from legacy sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "ycode-project-storage-"));
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE tasks (
      workspace_key TEXT NOT NULL, workspace_path TEXT NOT NULL, task_id TEXT NOT NULL,
      project_id TEXT, title TEXT NOT NULL DEFAULT '', title_overridden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
      task_status TEXT, deleted INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      handoff_pending INTEGER NOT NULL DEFAULT 0);
      INSERT INTO tasks(workspace_key,workspace_path,task_id,title,created_at,updated_at,task_status)
      VALUES('/work/a','/work/a','t1','hello',1,2,'completed');`);

    const result = await projectStorage.migrate(db, {
      hostId: "local",
      backupDirectories: [root],
      now: () => 1_700_000_000_000,
      settings: {
        recentProjects: [],
        lastWorkspaceSession: [{ kind: "local", workspacePath: "/work/a" }],
        sourceServers: [],
        connectionProfiles: [],
      },
    });

    assert.equal(result.applied.length > 0, true);
    const projects = db
      .prepare("SELECT p.name, r.root_path FROM projects p JOIN project_roots r USING(project_id)")
      .all() as { name: string; root_path: string }[];
    assert.deepEqual(
      projects.map((row) => row.root_path),
      ["/work/a"],
    );
    const task = db.prepare("SELECT host_id, root_path FROM tasks WHERE task_id='t1'").get() as {
      host_id: string;
      root_path: string;
    };
    assert.equal(task.host_id, "local");
    assert.equal(task.root_path, "/work/a");

    // Idempotent: re-running must not duplicate projects or fail on existing schema.
    await projectStorage.migrate(db, {
      hostId: "local",
      backupDirectories: [root],
      now: () => 1_700_000_000_001,
      settings: {
        recentProjects: [],
        lastWorkspaceSession: [{ kind: "local", workspacePath: "/work/a" }],
        sourceServers: [],
        connectionProfiles: [],
      },
    });
    const count = db.prepare("SELECT count(*) AS c FROM projects").get() as { c: number };
    assert.equal(count.c, 1);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("host startup migration is idempotent and surfaces a structured failure report", async () => {
  const root = await mkdtemp(join(tmpdir(), "ycode-project-startup-"));
  const previousDataDir = process.env["YCODE_DATA_DIR"];
  setDataBaseDir(root);
  const databasePath = join(root, "tasks-index.sqlite");
  const settings = {
    lastWorkspaceSession: [{ kind: "local" as const, workspacePath: join(root, "workspace") }],
    recentProjects: [],
    sourceServers: [],
    connectionProfiles: [],
  };
  try {
    const first = new TaskIndexRepo(databasePath, 5000, settings);
    await first.ensureReady();
    assert.equal(first.getProjectMigrationReport().status, "ready");
    assert.equal(first.getProjectMigrationReport().applied.includes("0005_projects"), true);
    const repository = await first.getProjectRepository();
    assert.deepEqual(
      repository.readTree({ includeTasks: false }).projects.map((project) => project.name),
      ["workspace"],
    );
    first.close();

    // 第二次启动不重复导入，也不因既有项目而失败。
    const second = new TaskIndexRepo(databasePath, 5000, settings);
    await second.ensureReady();
    assert.deepEqual(second.getProjectMigrationReport().applied, []);
    assert.equal(
      (await second.getProjectRepository()).readTree({ includeTasks: false }).projects.length,
      1,
    );
    second.close();

    // 篡改已记账 checksum 时迁移必须拒绝启动，并把失败事实留在报告里。
    const tamper = new DatabaseSync(databasePath);
    tamper
      .prepare("UPDATE schema_migration SET checksum='tampered' WHERE id='0005_projects'")
      .run();
    tamper.close();
    const failed = new TaskIndexRepo(databasePath, 5000, settings);
    await assert.rejects(failed.ensureReady());
    assert.equal(failed.getProjectMigrationReport().status, "failed");
    assert.equal(
      failed.getProjectMigrationReport().error?.includes("checksum") ||
        failed.getProjectMigrationReport().error?.includes("Migration"),
      true,
    );
    failed.close();
  } finally {
    if (previousDataDir === undefined) setDataBaseDir(null);
    else setDataBaseDir(previousDataDir);
    await rm(root, { recursive: true, force: true });
  }
});
