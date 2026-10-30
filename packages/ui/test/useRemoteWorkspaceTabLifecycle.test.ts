import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceTabState } from "../src/store/tabStore.js";
import {
  collectClosedRemoteWorkspaceKeys,
  collectClosedRemoteWorkspaceSessionIds,
} from "../src/root/useRemoteWorkspaceTabLifecycle.js";

function createWorkspaceTab(
  id: string,
  workspacePath: string,
  options?: Partial<WorkspaceTabState>,
): WorkspaceTabState {
  return {
    id,
    kind: "workspace",
    workspacePath,
    label: workspacePath,
    ...options,
  };
}

test("includes disconnected remote workspace identity when the workspace is no longer open", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-1", "/workspace/demo", {
      workspaceIdentity: "remote:docker:demo:/workspace/demo",
    }),
  ];

  assert.deepEqual(collectClosedRemoteWorkspaceKeys(previousTabs, []), [
    "remote:docker:demo:/workspace/demo",
  ]);
});

test("does not include workspace identity when the same tab still exists", () => {
  const tab = createWorkspaceTab("remote-1", "/workspace/demo", {
    workspaceIdentity: "remote:docker:demo:/workspace/demo",
  });

  assert.deepEqual(collectClosedRemoteWorkspaceKeys([tab], [tab]), []);
});

test("does not include workspace identity when the same remote survives under a new tab id", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-old", "/workspace/demo", {
      workspaceIdentity: "remote:docker:demo:/workspace/demo",
    }),
  ];
  const nextTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-new", "/workspace/demo", {
      workspaceIdentity: "remote:docker:demo:/workspace/demo",
    }),
  ];

  assert.deepEqual(collectClosedRemoteWorkspaceKeys(previousTabs, nextTabs), []);
});

test("falls back to workspacePath for legacy remote tabs without identity", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-legacy", "/workspace/demo", {
      remoteTarget: { kind: "docker", container: "demo" },
    }),
  ];

  assert.deepEqual(collectClosedRemoteWorkspaceKeys(previousTabs, []), ["/workspace/demo"]);
});

test("does not interpret same-tab identity rekey as an explicit close", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-1", "/workspace/demo", {
      workspaceIdentity: "remote:ssh:linux-amd64-dev:dev:/workspace/demo",
    }),
  ];
  const nextTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-1", "/workspace/demo", {
      workspaceIdentity: "remote:server:server-1:/workspace/demo",
      previousWorkspaceIdentity: "remote:ssh:linux-amd64-dev:dev:/workspace/demo",
    }),
  ];

  assert.deepEqual(collectClosedRemoteWorkspaceKeys(previousTabs, nextTabs), []);
});

test("returns the remembered session for a tab that was disconnected before removal", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-1", "/workspace/demo", {
      workspaceIdentity: "remote:docker:demo:/workspace/demo",
    }),
  ];

  assert.deepEqual(
    collectClosedRemoteWorkspaceSessionIds(
      previousTabs,
      [],
      new Map([["remote:docker:demo:/workspace/demo", "session-closed"]]),
    ),
    ["session-closed"],
  );
});

test("returns the remembered session by workspacePath for a legacy remote tab", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-legacy", "/workspace/demo", {
      remoteTarget: { kind: "docker", container: "demo" },
    }),
  ];

  assert.deepEqual(
    collectClosedRemoteWorkspaceSessionIds(
      previousTabs,
      [],
      new Map([["/workspace/demo", "session-legacy"]]),
    ),
    ["session-legacy"],
  );
});

test("does not duplicate a session that is still present on the removed tab", () => {
  const previousTabs: WorkspaceTabState[] = [
    createWorkspaceTab("remote-1", "/workspace/demo", {
      workspaceIdentity: "remote:docker:demo:/workspace/demo",
      remoteSessionId: "session-live",
    }),
  ];

  assert.deepEqual(
    collectClosedRemoteWorkspaceSessionIds(
      previousTabs,
      [],
      new Map([["remote:docker:demo:/workspace/demo", "session-live"]]),
    ),
    [],
  );
});
