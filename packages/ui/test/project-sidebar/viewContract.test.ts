import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectTask, ProjectTree } from "../../src/project-sidebar/contract.js";
import {
  selectProjectRows,
  mergeProjectTrees,
  projectKey,
  resolveEntryProject,
} from "../../src/project-sidebar/view.js";
const task = (id: string, projectId: string | null, updatedAt: number): ProjectTask => ({
  taskId: id,
  projectId,
  hostId: "local",
  pinned: false,
  archived: false,
  workspacePath: "/same",
  title: id,
  mode: "build",
  traceId: id,
  createdAt: 1,
  updatedAt,
});
describe("project-sidebar read contract", () => {
  it("leaves an old cwd entry unresolved when two projects share that root", () => {
    const project = {
      id: "one",
      hostId: "remote:server:s",
      name: "One",
      roots: [{ rootPath: "/same", position: 0, isPrimary: true }],
      nameOverridden: false,
      pinned: false,
      position: 1,
      deleted: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const entry = {
      id: "legacy",
      hostId: project.hostId,
      projectId: null,
      name: "old",
      roots: [],
      lastSyncedAt: null,
      legacyWorkspace: { workspacePath: "/same" } as never,
    };
    assert.equal(resolveEntryProject(entry, { projects: [project], tasks: [] })?.id, "one");
    const oldServerEntry = {
      ...entry,
      projectId: "legacy-single-root:root",
      roots: project.roots,
      legacyWorkspace: null,
    };
    assert.equal(
      resolveEntryProject(oldServerEntry, { projects: [project], tasks: [] })?.id,
      "one",
    );
    assert.equal(
      resolveEntryProject(oldServerEntry, {
        projects: [project, { ...project, id: "two" }],
        tasks: [],
      }),
      undefined,
    );
    assert.equal(
      resolveEntryProject(entry, { projects: [project, { ...project, id: "two" }], tasks: [] }),
      undefined,
    );
  });
  it("joins only retained remote projects and does not retain offline task facts", () => {
    const local: ProjectTree = { projects: [], tasks: [task("local", null, 1)] };
    const remoteTask = { ...task("remote", "p", 9), hostId: "remote:server:s" };
    const directory = {
      hosts: [
        {
          id: remoteTask.hostId,
          membershipId: "m",
          kind: "docker" as const,
          target: { kind: "docker" as const, container: "s" },
          position: 1,
        },
      ],
      entries: [
        {
          id: "entry",
          hostId: remoteTask.hostId,
          projectId: "p",
          name: "cached",
          roots: [],
          lastSyncedAt: 1,
          legacyWorkspace: null,
        },
      ],
    };
    const remote: ProjectTree = {
      projects: [
        {
          id: "p",
          hostId: remoteTask.hostId,
          name: "online",
          roots: [],
          nameOverridden: true,
          pinned: true,
          position: 1,
          deleted: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      tasks: [
        remoteTask,
        { ...remoteTask, taskId: "unadded", projectId: "other" },
        { ...remoteTask, taskId: "unclassified", projectId: null },
      ],
    };
    const online = mergeProjectTrees(local, directory, new Map([[remoteTask.hostId, remote]]));
    assert.deepEqual(
      online.tree.tasks.map((row) => row.taskId),
      ["local", "remote", "unclassified"],
    );
    assert.equal(online.tree.projects[0]?.name, "online");
    assert.deepEqual(online.availability.get(projectKey(remote.projects[0]!)), {
      entryId: "entry",
      online: true,
    });
    const offline = mergeProjectTrees(local, directory, new Map());
    assert.equal(offline.tree.projects[0]?.name, "cached");
    assert.deepEqual(offline.tree.tasks, local.tasks);
    assert.equal(offline.availability.get(projectKey(remote.projects[0]!))?.online, false);
  });
  it("does not conflate project IDs from different physical Hosts", () => {
    const tree: ProjectTree = {
      projects: [],
      tasks: [task("local", "p", 1), { ...task("remote", "p", 2), hostId: "remote:server:s" }],
    };
    assert.deepEqual(
      selectProjectRows(tree, { kind: "project", projectId: "p", hostId: "local" }).map(
        (row) => row.taskId,
      ),
      ["local"],
    );
  });
  it("retains missing-summary rows, NULL ownership and deleted project history", () => {
    const tree: ProjectTree = {
      projects: [],
      tasks: [
        task("orphan", null, 9),
        task("deleted-project", "gone", 5),
        task("same-cwd", "other", 7),
      ],
    };
    assert.deepEqual(
      selectProjectRows(tree, { kind: "project", projectId: null }).map((row) => row.taskId),
      ["orphan"],
    );
    assert.deepEqual(
      selectProjectRows(tree, { kind: "timeline" }).map((row) => row.taskId),
      ["orphan", "same-cwd", "deleted-project"],
    );
  });
  it("pin/archive organization cannot change activity ordering", () => {
    const tree: ProjectTree = {
      projects: [],
      tasks: [
        { ...task("pinned", "p", 1), pinned: true },
        task("new", "p", 10),
        { ...task("archived", "p", 11), archived: true },
      ],
    };
    assert.deepEqual(
      selectProjectRows(tree, { kind: "project", projectId: "p" }).map((row) => row.taskId),
      ["new"],
    );
    assert.deepEqual(
      selectProjectRows(tree, { kind: "pinned" }).map((row) => row.taskId),
      ["pinned"],
    );
    assert.deepEqual(
      selectProjectRows(tree, { kind: "timeline" }).map((row) => row.taskId),
      ["new", "pinned"],
    );
  });
});
