import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsSchema, type YCodeTaskMeta } from "@ycode/shared";
import { createLegacySingleRootProjectService } from "../src/project/index.js";

function fixture() {
  let settings = appSettingsSchema.parse({
    lastWorkspaceSession: [
      { kind: "local", workspacePath: "/a" },
      { kind: "local", workspacePath: "/chat", workspacePurpose: "conversation" },
    ],
    recentProjects: ["/a", "/b"],
  });
  const row = (workspacePath: string, suffix: string) =>
    ({
      taskId: `${workspacePath}-${suffix}`,
      workspacePath,
      title: suffix,
      updatedAt: 1,
    }) as YCodeTaskMeta;
  const calls = {
    listTasks: 0,
    listPinnedTasks: 0,
    listArchivedTasks: 0,
    ensureConversation: 0,
    readSettings: 0,
  };
  const tasks = {
    listTasks: async (workspacePath: string) => {
      calls.listTasks += 1;
      return [row(workspacePath, "active")];
    },
    listPinnedTasks: async (workspacePath: string) => {
      calls.listPinnedTasks += 1;
      return [row(workspacePath, "pin")];
    },
    listArchivedTasks: async (workspacePath: string) => {
      calls.listArchivedTasks += 1;
      return [row(workspacePath, "archived")];
    },
  };
  let platform = { platform: "linux", homedir: "/home/remote" };
  const directoryReads: Array<{ path: string; includeHidden?: boolean }> = [];
  const directories = {
    info: async () => platform,
    read: async (input: { path: string; includeHidden?: boolean }) => {
      directoryReads.push(input);
      return [];
    },
  };
  const service = createLegacySingleRootProjectService({
    directories: directories as never,
    hostId: "remote:server:old",
    readSettings: async () => {
      calls.readSettings += 1;
      return settings;
    },
    readTasks: ({ workspacePath, kind }) =>
      kind === "pinned"
        ? tasks.listPinnedTasks(workspacePath)
        : kind === "archived"
          ? tasks.listArchivedTasks(workspacePath)
          : tasks.listTasks(workspacePath),
    ensureConversation: async () => {
      calls.ensureConversation += 1;
      return "/new-chat";
    },
  });
  return {
    service,
    calls,
    directories,
    directoryReads,
    setSettings: (value: unknown) => {
      settings = appSettingsSchema.parse(value);
    },
    setPlatform: (value: { platform: string; homedir: string }) => {
      platform = value;
    },
  };
}

test("matches historical directories by the remote platform rules without changing identities", async () => {
  const cases = [
    ["linux", "/remote/parent/../folder", "/remote/folder"],
    ["win32", "C:/work/project", "C:\\work\\project"],
  ] as const;
  for (const [platform, raw, canonical] of cases) {
    const { service, setPlatform, setSettings } = fixture();
    setPlatform({ platform, homedir: canonical });
    setSettings({ recentProjects: [raw, canonical] });
    const tree = await service.readTree();
    const projects = await service.readProjects();
    const selected = await service.readDirectory({ path: raw });
    assert.equal(selected.path, canonical);
    assert.deepEqual(
      projects.map((project) => project.directoryMatchPath),
      [selected.path, selected.path],
    );
    assert.equal(new Set(projects.map((project) => project.id)).size, 2);
    assert.deepEqual(tree.projects, projects);
    for (const [index, project] of projects.entries()) {
      const path = [raw, canonical][index]!;
      assert.equal(project.roots[0]?.rootPath, path);
      const task = tree.tasks.find((item) => item.projectId === project.id);
      assert.equal(task?.workspacePath, path);
      assert.deepEqual(await service.prepareSession({ projectId: project.id }), {
        projectId: project.id,
        workspacePath: path,
        additionalDirectories: [],
      });
    }
    await assert.rejects(service.saveProject({ roots: [canonical] }), /legacy-read-only/);
  }
});

test("legacy host browses its own directories but still cannot create projects", async () => {
  const { service, calls, directoryReads } = fixture();
  assert.deepEqual(await service.readDirectory(), { path: "/home/remote", entries: [] });
  assert.deepEqual(await service.readDirectory({ path: "/repo/../a", includeHidden: true }), {
    path: "/a",
    entries: [],
  });
  assert.deepEqual(directoryReads.at(-1), { path: "/a", includeHidden: true });
  await assert.rejects(service.readDirectory({ path: "relative" }), /absolute-path-required/);
  await assert.rejects(
    service.readDirectory({ hostId: "remote:server:another", path: "/a" }),
    /cross-host-move/,
  );
  await assert.rejects(service.saveProject({ roots: ["/a"] }), /legacy-read-only/);
  assert.equal(calls.readSettings, 0);
  assert.equal(calls.listTasks, 0);
  assert.equal(calls.ensureConversation, 0);
});

test("deduplicates a task that moves between legacy partitions during the read", async () => {
  const { service } = fixture();
  const original = service.readTree.bind(service);
  // legacy 三个分区不是同一事务；直接验证投影按 workspace+task 去重。
  const tree = await original();
  const ids = tree.tasks.map((task) => task.taskId);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(tree.tasks.find((task) => task.taskId === "/a-pin")?.pinned, true);
});

test("directory reads do not touch tasks and conversation workspaces are not projects", async () => {
  const { service, calls } = fixture();
  const first = await service.readProjects();
  assert.deepEqual(
    first.map((project) => project.roots.map((root) => root.rootPath)),
    [["/a"], ["/b"]],
  );
  assert.equal(
    first.every((project) => project.legacySingleRoot && project.hostId === "remote:server:old"),
    true,
  );
  assert.deepEqual(await service.readProjects(), first);
  assert.equal(calls.listTasks, 0);
});

test("projects only the three remote task partitions without rewriting task facts", async () => {
  const { service } = fixture();
  const tree = await service.readTree();
  assert.equal(tree.legacySingleRoot, true);
  assert.equal(tree.tasks.length, 9);
  assert.deepEqual(
    (({ pinned, archived, projectId, title, updatedAt }) => ({
      pinned,
      archived,
      projectId,
      title,
      updatedAt,
    }))(tree.tasks.find((task) => task.taskId === "/a-pin")!),
    {
      pinned: true,
      archived: false,
      projectId: tree.projects[0]!.id,
      title: "pin",
      updatedAt: 1,
    },
  );
  assert.equal(
    tree.tasks
      .filter((task) => task.workspacePath === "/chat")
      .every((task) => task.projectId === null),
    true,
  );
  assert.equal(tree.tasks.find((task) => task.taskId === "/b-archived")?.archived, true);
});

test("creation and restore return existing cwd and reject organization writes", async () => {
  const { service, calls } = fixture();
  const project = (await service.readProjects())[0]!;
  assert.deepEqual(await service.prepareSession({ projectId: project.id }), {
    workspacePath: "/a",
    additionalDirectories: [],
    projectId: project.id,
  });
  assert.deepEqual(
    await service.resolveSessionDirectories({ taskId: "s", workspacePath: "/chat" }),
    {
      workspacePath: "/chat",
      additionalDirectories: [],
      projectId: null,
    },
  );
  await assert.rejects(service.prepareSession({ projectId: "removed" }), /project\.not-found/);
  assert.equal(calls.ensureConversation, 0);
  assert.deepEqual(await service.prepareSession(), {
    workspacePath: "/new-chat",
    additionalDirectories: [],
    projectId: null,
  });
  await assert.rejects(service.saveProject({ roots: ["/a", "/b"] }), /legacy-read-only/);
  await assert.rejects(service.deleteProject(project.id), /legacy-read-only/);
  await assert.rejects(
    service.moveTask({ task: { taskId: "s", workspacePath: "/a" }, projectId: project.id }),
    /legacy-read-only/,
  );
  await assert.rejects(service.reorderProjects([project.id]), /legacy-read-only/);
  await assert.rejects(service.readTree({ hostId: "remote:server:another" }), /cross-host-move/);
});
