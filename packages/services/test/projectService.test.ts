import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import type { ProjectRepositoryContract, VirtualProject } from "../src/project-storage/contract.js";
import type { IProjectService } from "../src/project/contract.js";
import { bindRemoteProjectIdentities, createProjectService } from "../src/project/index.js";

test("projects live primary directory status without changing roots, and rejects stale create requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-primary-"));
  const primary = join(root, "primary");
  const extra = join(root, "extra");
  const moved = join(root, "moved");
  const project: VirtualProject = {
    id: "project",
    hostId: "local",
    name: "Project",
    nameOverridden: true,
    roots: [
      { rootPath: extra, position: 0, isPrimary: false },
      { rootPath: primary, position: 1, isPrimary: true },
    ],
    pinned: false,
    deleted: false,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const readTreeCalls: unknown[] = [];
  const readTree = (options: unknown) => {
    readTreeCalls.push(options);
    return { projects: [project], tasks: [] };
  };
  let initializeCalls = 0;
  let afterChangeCalls = 0;
  const service = createProjectService({
    repository: async () =>
      ({
        readTree,
        initializeProjectRoot: () => {
          initializeCalls += 1;
        },
      }) as unknown as ProjectRepositoryContract,
    workspaceDirectory: root,
    afterChange: async () => {
      afterChangeCalls += 1;
    },
  });
  try {
    await Promise.all([mkdir(primary), mkdir(extra)]);
    assert.equal((await service.readTree()).projects[0]?.primaryRootStatus, "available");
    await rename(primary, moved);
    assert.equal((await service.readTree()).projects[0]?.primaryRootStatus, "missing");
    assert.equal((await service.readProjects())[0]?.primaryRootStatus, "missing");
    await assert.rejects(
      service.prepareSession({ projectId: project.id }),
      /project\.primaryRootMissing/,
    );
    assert.equal(initializeCalls, 0);
    assert.equal(afterChangeCalls, 0);
    assert.equal(project.primaryRootStatus, undefined);
    assert.equal(project.roots[1]?.rootPath, primary);
    await rename(moved, primary);
    // 附加目录失效不代表主目录失效；不能选择数组首项替代 isPrimary。
    await rm(extra, { recursive: true });
    assert.equal((await service.readTree()).projects[0]?.primaryRootStatus, "available");
    readTreeCalls.length = 0;
    assert.deepEqual(await service.prepareSession({ projectId: project.id }), {
      workspacePath: primary,
      additionalDirectories: [extra],
      projectId: project.id,
    });
    // 新建只依赖项目和目录；无关历史任务不能进入准备与删除复检的读路径。
    assert.deepEqual(readTreeCalls, [{ includeTasks: false }, { includeTasks: false }]);
    await rm(primary, { recursive: true });
    await writeFile(primary, "not a directory");
    assert.equal((await service.readTree()).projects[0]?.primaryRootStatus, "missing");
    await assert.rejects(
      service.prepareSession({ projectId: project.id }),
      /project\.primaryRootMissing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not classify an empty project as missing and keeps its normal first-root initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-empty-"));
  const project = { id: "empty", roots: [] } as unknown as VirtualProject;
  let initializeCalls = 0;
  const service = createProjectService({
    repository: async () =>
      ({
        readTree: () => ({ projects: [project], tasks: [] }),
        initializeProjectRoot: (id: string, rootPath: string) => {
          initializeCalls += 1;
          return {
            ...project,
            id,
            roots: [{ rootPath, position: 0, isPrimary: true }],
          };
        },
      }) as unknown as ProjectRepositoryContract,
    workspaceDirectory: root,
  });
  try {
    assert.equal((await service.readProjects())[0]?.primaryRootStatus, undefined);
    assert.deepEqual(await service.prepareSession({ projectId: project.id }), {
      projectId: project.id,
      workspacePath: join(root, project.id),
      additionalDirectories: [],
    });
    assert.equal(initializeCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves remote primary status without checking foreign paths on this Host", async () => {
  const remoteProject = {
    id: "remote",
    roots: [{ rootPath: "/not-on-this-host", isPrimary: true }],
    primaryRootStatus: "available",
  };
  const remote = {
    readTree: async () => ({ projects: [remoteProject], tasks: [] }),
    readProjects: async () => [remoteProject],
  } as unknown as IProjectService;
  const repository = () => {
    throw new Error("must not read local storage");
  };
  const service = createProjectService({
    repository: async () => repository() as never,
    workspaceDirectory: tmpdir(),
    resolveHost: async () => remote,
  });
  assert.equal((await service.readTree({ hostId: "remote-owner" })).projects[0], remoteProject);
  assert.equal((await service.readProjects({ hostId: "remote-owner" }))[0], remoteProject);
});

test("returns attachment identity with prepared remote directories", async () => {
  let resolvedPath: string | undefined;
  const service = bindRemoteProjectIdentities(
    {
      prepareSession: async () => ({
        projectId: "p",
        workspacePath: "/remote",
        additionalDirectories: ["/extra"],
      }),
    } as unknown as IProjectService,
    async (path) => {
      resolvedPath = path;
      return "remote:server:s:/remote";
    },
  );
  assert.deepEqual(await service.prepareSession({ projectId: "p" }), {
    workspacePath: "/remote",
    additionalDirectories: ["/extra"],
    projectId: "p",
    workspaceIdentity: "remote:server:s:/remote",
  });
  assert.equal(resolvedPath, "/remote");
});

test("validates every root before mutating storage and deduplicates normalized paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-service-"));
  try {
    await mkdir(join(root, "present"));
    const saved: unknown[] = [];
    const repository = {
      saveProject: (input: unknown) => {
        saved.push(input);
        return input as VirtualProject;
      },
    } as unknown as ProjectRepositoryContract;
    const port: IProjectService = createProjectService({
      repository: async () => repository,
      workspaceDirectory: root,
    });
    await assert.rejects(
      port.saveProject({ roots: [join(root, "present"), join(root, "missing")] }),
    );
    assert.equal(saved.length, 0);
    await port.saveProject({ roots: [join(root, "present"), join(root, "present", ".")] });
    assert.deepEqual((saved[0] as { roots: string[] }).roots, [join(root, "present")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not convert a database failure into an unclassified task", async () => {
  const port = createProjectService({
    repository: async () => {
      throw new Error("disk failed");
    },
    workspaceDirectory: tmpdir(),
  });
  await assert.rejects(
    port.resolveSessionDirectories({ workspacePath: "/cwd", taskId: "s" }),
    /disk failed/,
  );
});

test("readTree only reads the snapshot and never archives or broadcasts", async () => {
  let reads = 0;
  let changes = 0;
  const repository = {
    readTree: () => {
      reads += 1;
      return { projects: [], tasks: [] };
    },
  } as unknown as ProjectRepositoryContract;
  const service = createProjectService({
    repository: async () => repository,
    workspaceDirectory: tmpdir(),
    afterChange: async () => {
      changes += 1;
    },
  });
  assert.deepEqual(await service.readTree(), { projects: [], tasks: [] });
  assert.equal(reads, 1);
  assert.equal(changes, 0);
});

test("routes every foreign project operation to its existing owner and never falls back to the local repository", async () => {
  let localReads = 0;
  const repository = async () => {
    localReads += 1;
    throw new Error("must not read local storage");
  };
  const calls: string[] = [];
  const remote = {
    readDirectory: async () => {
      calls.push("readDirectory");
      return { path: "/remote-home", entries: [] };
    },
    readProjects: async () => {
      calls.push("readProjects");
      return [] as VirtualProject[];
    },
    readTree: async () => {
      calls.push("readTree");
      return { projects: [], tasks: [] };
    },
    saveProject: async () => {
      calls.push("saveProject");
      return { id: "remote-p" } as VirtualProject;
    },
    deleteProject: async () => {
      calls.push("deleteProject");
    },
    moveTask: async () => {
      calls.push("moveTask");
    },
    reorderProjects: async () => {
      calls.push("reorderProjects");
    },
    prepareSession: async () => {
      calls.push("prepareSession");
      return {
        projectId: "remote-p",
        workspacePath: "/remote",
        additionalDirectories: ["/extra"],
      };
    },
    resolveSessionDirectories: async () => {
      calls.push("resolveSessionDirectories");
      return {
        projectId: "remote-p",
        workspacePath: "/remote",
        additionalDirectories: ["/extra"],
      };
    },
  } satisfies IProjectService;
  const service = createProjectService({
    repository,
    workspaceDirectory: tmpdir(),
    resolveHost: async (hostId) => {
      if (hostId === "offline") throw new Error("project.host-offline");
      return remote;
    },
  });
  await service.readTree({ hostId: "source" });
  await service.readProjects({ hostId: "source" });
  await service.readDirectory({ hostId: "source", path: "/remote" });
  await service.saveProject({ hostId: "source", roots: ["/missing-local-path"] });
  await service.deleteProject("remote-p", "source");
  await service.moveTask({
    hostId: "source",
    projectId: "remote-p",
    task: { workspacePath: "/remote", taskId: "s" },
    addMissingRoot: true,
  });
  await service.reorderProjects(["remote-p"], "source");
  assert.equal(
    (await service.prepareSession({ hostId: "source", projectId: "remote-p" })).workspacePath,
    "/remote",
  );
  await service.resolveSessionDirectories({ workspacePath: "/remote", taskId: "s" }, "source");
  assert.deepEqual(calls.sort(), [
    "deleteProject",
    "moveTask",
    "prepareSession",
    "readDirectory",
    "readProjects",
    "readTree",
    "reorderProjects",
    "resolveSessionDirectories",
    "saveProject",
  ]);
  assert.equal(localReads, 0);
  await assert.rejects(service.readTree({ hostId: "offline" }), /project\.host-offline/);
  assert.equal(localReads, 0);
});

test("browses owner directories without touching project storage or admitting a session", async () => {
  let repositoryReads = 0;
  const reads: Array<{ path: string; includeHidden?: boolean }> = [];
  const service = createProjectService({
    repository: async () => {
      repositoryReads += 1;
      return {} as ProjectRepositoryContract;
    },
    workspaceDirectory: "/workspace",
    directories: {
      home: async () => "/owner",
      read: async (params) => {
        reads.push(params);
        return [];
      },
    },
  });
  assert.deepEqual(await service.readDirectory(), { path: normalize("/owner"), entries: [] });
  assert.deepEqual(reads[0], { path: normalize("/owner") });
  await service.readDirectory({ path: "/another", includeHidden: true });
  assert.deepEqual(reads[1], { path: normalize("/another"), includeHidden: true });
  await assert.rejects(service.readDirectory({ path: "relative" }), /absolute-path-required/);
  assert.deepEqual(await service.readDirectory({ path: "/owner/child/../folder" }), {
    path: normalize("/owner/folder"),
    entries: [],
  });
  assert.deepEqual(reads[2], { path: normalize("/owner/folder") });
  assert.equal(repositoryReads, 0);
});

test("binds every remote task directory through the existing workspace identity resolver", async () => {
  let resolves = 0;
  const service = bindRemoteProjectIdentities(
    {
      readTree: async () => ({
        projects: [],
        tasks: [
          { taskId: "one", workspacePath: "/repo", workspaceIdentity: "remote:ssh:old:22:u:/repo" },
          { taskId: "two", workspacePath: "/repo", workspaceIdentity: "remote:ssh:old:22:u:/repo" },
        ],
      }),
    } as unknown as IProjectService,
    async (path) => {
      resolves += 1;
      return `stable:${path}`;
    },
  );
  const result = await service.readTree();
  assert.equal(resolves, 1);
  assert.deepEqual(
    result.tasks.map((task) => task.workspaceIdentity),
    ["stable:/repo", "stable:/repo"],
  );
});
