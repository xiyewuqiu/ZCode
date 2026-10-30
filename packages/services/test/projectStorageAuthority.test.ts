import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectStorage } from "../src/project-storage/index.js";

const serverHost = "remote:server:shared-mac";

function fixture() {
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
  const add = (id: string, path: string, identity?: string) =>
    db
      .prepare(
        "INSERT INTO tasks(workspace_key,workspace_path,workspace_identity,task_id,title) VALUES(?,?,?,?,?)",
      )
      .run(identity ?? path, path, identity ?? null, id, `title ${id}`);
  return { db, add };
}

async function context() {
  const directory = await mkdtemp(join(tmpdir(), "ycode-project-authority-"));
  return {
    context: {
      backupDirectories: [directory],
      now: () => 10,
      settings: { recentProjects: [], lastWorkspaceSession: [] },
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

const owners = (db: DatabaseSync) =>
  db
    .prepare("SELECT task_id,host_id,project_id FROM tasks ORDER BY task_id")
    .all()
    .map((row) => Object.fromEntries(Object.entries(row)));

for (const order of ["local-first", "server-first"] as const) {
  test(`shared tasks-index admits both owners when ${order}`, async () => {
    const { db, add } = fixture();
    const { context: base, cleanup } = await context();
    try {
      db.exec("PRAGMA foreign_keys = ON");
      add("local-old", "/a");
      add("ssh-old", "/a", "remote:ssh:shared-mac:22:user:/a");
      if (order === "local-first") {
        await projectStorage.migrate(db, base);
        const before = owners(db);
        await projectStorage.migrate(db, { ...base, hostId: serverHost });
        assert.equal(owners(db).length, before.length);
        assert.equal(
          projectStorage.repository(db, serverHost).saveProject({ roots: ["/a"] }).hostId,
          serverHost,
        );
      } else {
        await projectStorage.migrate(db, { ...base, hostId: serverHost });
        const before = owners(db);
        await projectStorage.migrate(db, base);
        assert.equal(owners(db).length, before.length);
        assert.equal(projectStorage.repository(db).saveProject({ roots: ["/b"] }).hostId, "local");
      }
    } finally {
      db.close();
      await cleanup();
    }
  });
}

test("remote project authority requires one immutable root and rejects extra directories", async () => {
  const { db } = fixture();
  const { context: base, cleanup } = await context();
  try {
    await projectStorage.migrate(db, { ...base, hostId: serverHost });
    const repo = projectStorage.repository(db, serverHost);
    assert.throws(() => repo.saveProject({ roots: ["/a", "/b"] }), /remote-single-root-required/);
    const project = repo.saveProject({ roots: ["/a"] });
    assert.throws(
      () => repo.saveProject({ id: project.id, roots: ["/b"] }),
      /remote-root-immutable/,
    );
    assert.deepEqual(repo.readTree().projects[0]?.roots, project.roots);

    const task = { taskId: "new", workspacePath: "/a", workspaceIdentity: `${serverHost}:/a` };
    assert.throws(
      () => repo.reserveCreatedTask({ task, projectId: null }),
      /remote-project-required/,
    );
    assert.throws(
      () =>
        repo.reserveCreatedTask({
          task,
          projectId: project.id,
          additionalDirectories: ["/b"],
        }),
      /remote-single-root-required/,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count,
      0,
    );
    assert.deepEqual(repo.reserveCreatedTask({ task, projectId: project.id }), {
      projectId: project.id,
      workspacePath: "/a",
      additionalDirectories: [],
    });
  } finally {
    db.close();
    await cleanup();
  }
});

test("new projects prepend while manual reorder is preserved", async () => {
  const { db } = fixture();
  const { context: base, cleanup } = await context();
  try {
    await projectStorage.migrate(db, base);
    const repo = projectStorage.repository(db);
    const first = repo.saveProject({ name: "First" });
    const second = repo.saveProject({ roots: ["/second"] });
    assert.equal(first.position, 0);
    assert.deepEqual(
      repo.readTree().projects.map((project) => project.id),
      [second.id, first.id],
    );
    repo.reorderProjects([first.id, second.id]);
    const before = repo.readTree().projects;
    const third = repo.saveProject({ name: "Third" });
    assert.deepEqual(
      repo.readTree().projects.map((project) => project.id),
      [third.id, first.id, second.id],
    );
    assert.deepEqual(repo.readTree().projects.slice(1), before);
  } finally {
    db.close();
    await cleanup();
  }
});
