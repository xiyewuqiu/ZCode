import assert from "node:assert/strict";
import test from "node:test";
import { createRemoteWorkspaceController } from "../src/remote/remoteWorkspaceController.js";

test("RemoteWorkspaceController dispatches all explicit intents to the corresponding owner", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const controller = createRemoteWorkspaceController({
    connectDevice: async (profileId, effect) => {
      calls.push(["connectDevice", profileId, effect]);
    },
    disconnectDevice: async (sourceServerId) => {
      calls.push(["disconnectDevice", sourceServerId]);
    },
    openConversation: async () => {
      calls.push(["openConversation"]);
    },
    openProject: async (input) => {
      calls.push(["openProject", input]);
    },
    reconnectWorkspace: async (workspaceKey, options) => {
      calls.push(["reconnectWorkspace", workspaceKey, options]);
    },
    closeWorkspace: async (workspaceKey) => {
      calls.push(["closeWorkspace", workspaceKey]);
    },
  });

  await controller.dispatch({
    type: "connect-device",
    profileId: "profile-1",
    effect: "select-project",
  });
  await controller.dispatch({
    type: "disconnect-device",
    sourceServerId: "server-1",
  });
  await assert.rejects(
    controller.dispatch({
      type: "open-conversation",
      sourceServerId: "server-1",
      remoteSessionId: "session-1",
    }),
    /project\.remote-project-required/,
  );
  const openProjectIntent = {
    type: "open-project" as const,
    sourceServerId: "server-1",
    path: "/workspace/project",
    profileId: "profile-1",
  };
  await controller.dispatch(openProjectIntent);
  await controller.dispatch({
    type: "reconnect-workspace",
    workspaceKey: "remote:server:server-1:/workspace/project",
  });
  await controller.dispatch({
    type: "close-workspace",
    workspaceKey: "remote:server:server-1:/workspace/project",
    origin: "user-close",
  });

  assert.deepEqual(calls, [
    ["connectDevice", "profile-1", "select-project"],
    ["disconnectDevice", "server-1"],
    ["openProject", openProjectIntent],
    ["reconnectWorkspace", "remote:server:server-1:/workspace/project", undefined],
    ["closeWorkspace", "remote:server:server-1:/workspace/project"],
  ]);
});

test("RemoteWorkspaceController rejects non-user close origins", async () => {
  const controller = createRemoteWorkspaceController({
    connectDevice: async () => undefined,
    disconnectDevice: async () => undefined,
    openConversation: async () => undefined,
    openProject: async () => undefined,
    reconnectWorkspace: async () => undefined,
    closeWorkspace: async () => undefined,
  });

  await assert.rejects(
    controller.dispatch({
      type: "close-workspace",
      workspaceKey: "remote:server:server-1:/workspace/project",
      origin: "restore" as never,
    }),
    /user-close/,
  );
});
