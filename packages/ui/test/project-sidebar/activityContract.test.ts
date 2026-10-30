import assert from "node:assert/strict";
import { it } from "node:test";
import type { ProjectTask } from "../../src/project-sidebar/contract.js";
import { applyProjectTaskActivities } from "../../src/project-sidebar/view.js";
import { getTaskListRowActivity } from "../../src/v4/taskListRowActivity.js";

it("远端 phase 只叠加完整身份匹配的现有行，不改标题/排序时间/归属或增加行", () => {
  const local: ProjectTask = {
    taskId: "same",
    workspacePath: "/repo",
    hostId: "local",
    projectId: null,
    title: "Local",
    traceId: "t",
    createdAt: 1,
    updatedAt: 2,
    mode: "build",
    pinned: false,
    archived: false,
  };
  const remote = {
    ...local,
    title: "Remote custom",
    hostId: "remote:server:s",
    workspaceIdentity: "remote:server:s:/repo",
    projectId: "project",
  };
  const tree = { projects: [], tasks: [local, remote] };
  const activity = { phase: "running" as const, lastActivityAt: 99, hasBackgroundWork: false };
  const result = applyProjectTaskActivities(tree, [
    {
      address: {
        taskId: "same",
        workspacePath: "/repo",
        workspaceIdentity: remote.workspaceIdentity,
      },
      activity,
    },
    {
      address: {
        taskId: "unknown",
        workspacePath: "/repo",
        workspaceIdentity: remote.workspaceIdentity,
      },
      activity,
    },
  ]);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0], local);
  assert.equal(result.tasks[1]!.title, "Remote custom");
  assert.equal(result.tasks[1]!.updatedAt, 2);
  assert.equal(result.tasks[1]!.projectId, "project");
  assert.deepEqual(getTaskListRowActivity(result.tasks[1]!), activity);
  assert.equal(getTaskListRowActivity(applyProjectTaskActivities(tree, []).tasks[1]!), null);
});
