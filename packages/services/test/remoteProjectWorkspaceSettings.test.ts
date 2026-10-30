import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appSettingsSchema } from "@ycode/shared";
import { projectStorage } from "#src/project-storage/index.js";
import {
  createRemoteProjectService,
  projectWorkspaceSettings,
} from "#src/remote-projects/index.js";
import type { RemoteProjectCache } from "#src/remote-projects/contract.js";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const directory = await mkdtemp(join(tmpdir(), "remote-project-settings-test-"));
  await projectStorage.migrate(db, { backupDirectories: [directory] });
  let changes = 0;
  const service = createRemoteProjectService({
    database: async () => db,
    afterChange: () => {
      changes += 1;
    },
    now: () => 100,
  });
  const target = { kind: "ssh" as const, host: "example.test", username: "user" };
  await service.saveHost({ id: "source", target });
  const project: RemoteProjectCache = {
    projectId: "p",
    name: "Remote",
    roots: [{ rootPath: "/repo", position: 0, isPrimary: true }],
  };
  return {
    db,
    service,
    target,
    project,
    dispose: async () => {
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("只从本机保留入口派生兼容集合；删除入口不因活动目录或旧快照复活", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  await f.service.saveHost({ id: "remote:server:retained", target: f.target });
  const saved = await f.service.addEntry({ hostId: "remote:server:retained", project: f.project });
  const repository = projectStorage.repository(f.db);
  const local = repository.saveProject({ roots: ["/local", "/shared"], name: "local" });
  repository.saveProject({ roots: ["/shared"], name: "other" });
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: [{ kind: "local", workspacePath: "/old-removed" }],
    recentProjects: ["/old-removed"],
    lastActiveWorkspace: {
      kind: "remote",
      target: f.target,
      workspacePath: "/repo",
      workspaceIdentity: "remote:server:retained:/repo",
      lastOpenedAt: 1,
      lastConnectionStatus: "connected",
    },
  });
  const result = projectWorkspaceSettings(
    repository.readTree({ includeTasks: false }).projects,
    await f.service.readDirectory(),
    settings,
  );
  assert.deepEqual(result.recentProjects, ["/shared", "/local"]);
  assert.equal(result.lastWorkspaceSession?.length, 3);
  assert.equal(result.lastActiveTabIndex, 2);
  assert.equal(
    result.lastActiveWorkspace && "workspaceIdentity" in result.lastActiveWorkspace
      ? result.lastActiveWorkspace.workspaceIdentity
      : undefined,
    "remote:server:retained:/repo",
  );
  const lastSession = result.lastWorkspaceSession?.at(-1);
  assert.equal(
    lastSession && lastSession.kind === "remote" ? lastSession.workspaceIdentity : undefined,
    "remote:ssh:example.test:22:user:/repo",
  );
  assert.deepEqual(
    lastSession && lastSession.kind === "remote" ? lastSession.target : null,
    f.target,
  );
  await f.service.removeEntry(saved.id);
  repository.deleteProject(local.id);
  const removed = projectWorkspaceSettings(
    repository.readTree({ includeTasks: false }).projects,
    await f.service.readDirectory(),
    { ...settings, ...result },
  );
  assert.deepEqual(removed.recentProjects, ["/shared"]);
  assert.deepEqual(removed.lastWorkspaceSession, [
    { kind: "local", workspacePath: "/shared", workspacePurpose: "project" },
  ]);
  assert.equal(removed.lastActiveWorkspace, null);
});

test("活动 conversation 只保留选择不写兼容项目集合，移除连接后清空且 null 不回读旧值", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  await f.service.removeHost("source");
  const settings = appSettingsSchema.parse({
    lastActiveWorkspace: {
      kind: "remote",
      workspacePath: "/chat",
      workspacePurpose: "conversation",
      workspaceIdentity: "remote:ssh:example.test:22:user:/chat",
      target: f.target,
      lastOpenedAt: 1,
      lastConnectionStatus: "connected",
    },
  });
  await f.service.saveHost({ id: "remote:ssh:example.test:22:user", target: f.target });
  const first = projectWorkspaceSettings([], await f.service.readDirectory(), settings);
  assert.deepEqual(first.lastWorkspaceSession, []);
  assert.equal(
    first.lastActiveWorkspace && "workspacePath" in first.lastActiveWorkspace
      ? first.lastActiveWorkspace.workspacePath
      : undefined,
    "/chat",
  );
  await f.service.removeHost("remote:ssh:example.test:22:user");
  assert.equal(
    projectWorkspaceSettings([], await f.service.readDirectory(), settings).lastActiveWorkspace,
    null,
  );
  assert.equal(
    projectWorkspaceSettings([], await f.service.readDirectory(), {
      ...settings,
      lastActiveWorkspace: null,
      lastWorkspaceSession: [{ kind: "local", workspacePath: "/old" }],
    }).lastActiveWorkspace,
    null,
  );
});
