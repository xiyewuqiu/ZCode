import assert from "node:assert/strict";
import test from "node:test";
import { createProjectWorkspaceNavigation } from "../src/project-workspace-navigation/index.js";
import type { ProjectNavigationPort } from "../src/project-workspace-navigation/contract.js";

function fixture() {
  let member = "one";
  let entryId = "entry";
  let owner: object | undefined = {};
  const hostId = "remote:server:source";
  const project = {
    id: "p",
    hostId,
    name: "P",
    roots: [{ rootPath: "/same", position: 0, isPrimary: true }],
    nameOverridden: false,
    pinned: false,
    deleted: false,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const calls = { prepareSession: 0, openRemoteWorkspace: 0 };
  const port = {
    projectService: {
      readTree: async () => ({ projects: [], tasks: [] }),
      resolveSessionDirectories: async () => {
        throw new Error("unexpected task resolution");
      },
      readProjects: async (input?: { hostId?: string }) =>
        input?.hostId === hostId ? [project] : [],
      prepareSession: async (input?: { projectId?: string; hostId?: string }) => {
        calls.prepareSession += 1;
        return {
          projectId: input?.projectId ?? null,
          workspacePath: "/same",
          additionalDirectories: ["/extra"],
          ...(input?.hostId === hostId ? { workspaceIdentity: "remote:server:source:/same" } : {}),
        };
      },
    },
    remoteProjectService: {
      readDirectory: async () => ({
        hosts: member
          ? [
              {
                id: hostId,
                membershipId: member,
                kind: "server" as const,
                target: { kind: "server" as const, serverId: "source", url: "http://source" },
                position: 0,
                connectionStatus: owner ? ("online" as const) : ("offline" as const),
              },
            ]
          : [],
        entries: [
          {
            id: entryId,
            hostId,
            projectId: "p",
            name: "P",
            roots: project.roots,
            legacyWorkspace: null,
            lastSyncedAt: 1,
          },
        ],
      }),
    },
    readConnectionOwner: () => owner,
    openRemoteWorkspace: async ({
      directories,
      assertCurrent,
    }: {
      directories: { workspacePath: string; workspaceIdentity?: string };
      assertCurrent: () => Promise<void>;
    }) => {
      calls.openRemoteWorkspace += 1;
      await assertCurrent();
      return {
        remoteSessionId: "scope",
        generation: 1,
        target: { kind: "server" as const, serverId: "source", url: "http://source" },
        workspacePath: directories.workspacePath,
        workspaceIdentity: directories.workspaceIdentity,
      };
    },
  } as unknown as ProjectNavigationPort;
  return {
    port,
    calls,
    service: createProjectWorkspaceNavigation(port),
    hostId,
    member: (value: string) => {
      member = value;
    },
    entry: (value: string) => {
      entryId = value;
    },
    owner: (value?: object) => {
      owner = value;
    },
  };
}

test("local prepares once; remote only opens a retained source scope", async () => {
  const f = fixture();
  assert.equal((await f.service.prepare({ projectId: null })).hostId, "local");
  assert.equal(f.calls.openRemoteWorkspace, 0);
  const remote = await f.service.prepare({ hostId: f.hostId, projectId: "p" });
  assert.equal(remote.projectId, "p");
  assert.equal(remote.workspacePath, "/same");
  assert.deepEqual(remote.additionalDirectories, ["/extra"]);
  assert.equal(remote.remote?.remoteSessionId, "scope");
  assert.equal(f.calls.prepareSession, 2);
});

test("offline and removed hosts reject before preparing directories", async () => {
  const f = fixture();
  f.owner(undefined);
  await assert.rejects(f.service.prepare({ hostId: f.hostId, projectId: "p" }), /host-offline/);
  assert.equal(f.calls.prepareSession, 0);

  f.owner({});
  f.member("");
  await assert.rejects(f.service.prepare({ hostId: f.hostId, projectId: "p" }), /host-offline/);
  assert.equal(f.calls.openRemoteWorkspace, 0);
});

test("removed entry during directory preparation invalidates the navigation", async () => {
  const f = fixture();
  f.port.projectService.prepareSession = async () => {
    f.entry("readded");
    return {
      projectId: "p",
      workspacePath: "/same",
      workspaceIdentity: "remote:server:source:/same",
      additionalDirectories: [],
    };
  };
  await assert.rejects(f.service.prepare({ hostId: f.hostId, projectId: "p" }));
  assert.equal(f.calls.openRemoteWorkspace, 0);
});

test("owner or membership change during admission rejects with navigation-stale", async () => {
  for (const change of ["owner", "member"] as const) {
    const f = fixture();
    f.port.openRemoteWorkspace = async ({ assertCurrent }) => {
      if (change === "owner") f.owner(undefined);
      else f.member("readded");
      await assertCurrent();
      throw new Error("unexpected commit");
    };
    await assert.rejects(
      f.service.prepare({ hostId: f.hostId, projectId: "p" }),
      /project.navigation-stale/,
    );
  }
});

test("existing task opens its authoritative immutable cwd without preparing a draft", async () => {
  const f = fixture();
  const workspaceIdentity = "remote:server:source:/original";
  const task = {
    hostId: f.hostId,
    taskId: "existing",
    workspacePath: "/original",
    workspaceIdentity,
    projectId: "p",
  };
  f.port.projectService.readTree = async () => ({
    projects: await f.port.projectService.readProjects({ hostId: f.hostId }),
    tasks: [task],
  });
  f.port.projectService.resolveSessionDirectories = async () => ({
    projectId: "p",
    workspacePath: "/original",
    workspaceIdentity,
    additionalDirectories: ["/same"],
  });
  const result = await f.service.prepare({
    hostId: f.hostId,
    task: { taskId: "existing", workspaceKey: workspaceIdentity },
  });
  assert.equal(result.workspacePath, "/original");
  assert.deepEqual(result.additionalDirectories, ["/same"]);
  assert.equal(f.calls.prepareSession, 0);
});

test("forged task workspace key is rejected without allocating directories", async () => {
  const f = fixture();
  f.port.projectService.readTree = async () => ({
    projects: [],
    tasks: [
      {
        hostId: f.hostId,
        taskId: "existing",
        workspacePath: "/same",
        workspaceIdentity: "remote:server:source:/same",
        projectId: null,
      },
    ],
  });
  f.port.projectService.resolveSessionDirectories = async () => {
    throw new Error("unexpected");
  };
  await assert.rejects(
    f.service.prepare({
      hostId: f.hostId,
      task: { taskId: "existing", workspaceKey: "remote:server:another:/same" },
    }),
    /project.task-not-found/,
  );
  assert.equal(f.calls.prepareSession, 0);
  assert.equal(f.calls.openRemoteWorkspace, 0);
});

test("directory resolution mismatch still rejects opening the task", async () => {
  for (const field of ["workspacePath", "workspaceIdentity"] as const) {
    const f = fixture();
    const task = {
      taskId: "existing",
      hostId: f.hostId,
      workspacePath: "/same",
      workspaceIdentity: "remote:server:source:/same",
      projectId: "p",
    };
    f.port.projectService.readTree = async () => ({
      tasks: [task],
      projects: await f.port.projectService.readProjects({ hostId: f.hostId }),
    });
    f.port.projectService.resolveSessionDirectories = async () => ({
      projectId: "p",
      workspacePath: field === "workspacePath" ? "/other" : "/same",
      workspaceIdentity:
        field === "workspaceIdentity" ? "remote:server:another:/same" : task.workspaceIdentity,
      additionalDirectories: [],
    });
    await assert.rejects(
      f.service.prepare({
        hostId: f.hostId,
        task: { taskId: task.taskId, workspaceKey: task.workspaceIdentity },
      }),
      /project.task-directory-mismatch/,
    );
    assert.equal(f.calls.openRemoteWorkspace, 0);
  }
});
