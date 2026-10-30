import assert from "node:assert/strict";
import test from "node:test";
import type { SourceServerManagementSnapshot } from "@ycode/shared";
import { buildRemoteWorkspaceProjection } from "../src/remote/remoteWorkspaceProjection.js";

function assertPartial<T extends object>(actual: unknown, expected: Partial<T>): void {
  assert.ok(actual && typeof actual === "object", "expected an object");
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual((actual as Record<string, unknown>)[key], value, `property ${key} mismatch`);
  }
}

function createSnapshot(): SourceServerManagementSnapshot {
  return {
    generation: 3,
    servers: [
      {
        sourceServerId: "11111111-1111-4111-8111-111111111111",
        displayName: "Dev Linux",
        osUser: "dev",
        installState: "installed",
        declaredWorkspaces: [],
      },
    ],
    profiles: [
      {
        profileId: "22222222-2222-4222-8222-222222222222",
        sourceServerId: "11111111-1111-4111-8111-111111111111",
        transport: "ssh",
        target: { kind: "ssh", host: "linux-amd64-dev", username: "dev" },
        createdAt: 1,
        lifecycleState: "active",
      },
    ],
    states: [
      {
        profileId: "22222222-2222-4222-8222-222222222222",
        sourceServerId: "11111111-1111-4111-8111-111111111111",
        state: "online",
        updatedAt: 3,
      },
    ],
    workspaceHistory: [
      {
        sourceServerId: "11111111-1111-4111-8111-111111111111",
        profileId: "22222222-2222-4222-8222-222222222222",
        workspacePath: "/workspace/project",
        workspaceIdentity: "remote:server:11111111-1111-4111-8111-111111111111:/workspace/project",
        lastOpenedAt: 2,
      },
    ],
    failedPathCount: 0,
    abandonedPathCount: 0,
    migrationCounts: [],
  } as SourceServerManagementSnapshot;
}

test("joins device status, project history and open attachments without treating online as ready", () => {
  const projection = buildRemoteWorkspaceProjection({
    managementSnapshot: createSnapshot(),
    tabs: [
      {
        id: "conversation",
        kind: "workspace",
        workspacePath: "/workspace/conversation",
        workspaceIdentity:
          "remote:server:11111111-1111-4111-8111-111111111111:/workspace/conversation",
        workspacePurpose: "conversation",
        label: "conversation",
        remoteSessionId: "session-conversation",
      },
      {
        id: "project",
        kind: "workspace",
        workspacePath: "/workspace/project",
        workspaceIdentity: "remote:server:11111111-1111-4111-8111-111111111111:/workspace/project",
        workspacePurpose: "project",
        label: "project",
      },
    ],
    attachments: [
      {
        remoteSessionId: "session-conversation",
        workspaceKey: "remote:server:11111111-1111-4111-8111-111111111111:/workspace/conversation",
        sourceServerId: "11111111-1111-4111-8111-111111111111",
        state: "ready",
      },
    ],
  });

  assert.equal(projection.devices.length, 1);
  assertPartial(projection.devices[0], {
    sourceServerId: "11111111-1111-4111-8111-111111111111",
    aggregatedStatus: "online",
  });
  assert.equal(projection.openWorkspaces.length, 2);
  assertPartial(projection.openWorkspaces[0], {
    workspacePath: "/workspace/conversation",
    purpose: "conversation",
    attachmentState: "ready",
    sourceServerId: "11111111-1111-4111-8111-111111111111",
  });
  assertPartial(projection.openWorkspaces[1], {
    workspacePath: "/workspace/project",
    purpose: "project",
    attachmentState: "disconnected",
  });
  assert.equal(projection.projectHistory.length, 1);
  assertPartial(projection.projectHistory[0], { workspacePath: "/workspace/project" });
});

test("keeps the same path with different identities isolated", () => {
  const snapshot = createSnapshot();
  snapshot.workspaceHistory = [
    ...snapshot.workspaceHistory,
    {
      sourceServerId: "11111111-1111-4111-8111-111111111111",
      profileId: "22222222-2222-4222-8222-222222222222",
      workspacePath: "/workspace/shared",
      workspaceIdentity: "remote:server:other:/workspace/shared",
      lastOpenedAt: 4,
    },
  ];
  const projection = buildRemoteWorkspaceProjection({
    managementSnapshot: snapshot,
    tabs: [
      {
        id: "remote-a",
        kind: "workspace",
        workspacePath: "/workspace/shared",
        workspaceIdentity: "remote:server:source-a:/workspace/shared",
        workspacePurpose: "project",
        label: "shared-a",
      },
      {
        id: "remote-b",
        kind: "workspace",
        workspacePath: "/workspace/shared",
        workspaceIdentity: "remote:server:source-b:/workspace/shared",
        workspacePurpose: "conversation",
        label: "shared-b",
      },
    ],
    attachments: [],
  });

  assert.equal(projection.openWorkspaces.length, 2);
  assert.deepEqual(
    new Set(projection.openWorkspaces.map((item) => item.workspaceKey)),
    new Set([
      "remote:server:source-a:/workspace/shared",
      "remote:server:source-b:/workspace/shared",
    ]),
  );
  assert.equal(projection.projectHistory.length, 2);
});

test("keeps local tabs in execution contexts without projecting them as remote workspaces", () => {
  const projection = buildRemoteWorkspaceProjection({
    tabs: [
      {
        id: "local",
        kind: "workspace",
        workspacePath: "/local/project",
        workspacePurpose: "project",
        label: "project",
      },
      {
        id: "remote",
        kind: "workspace",
        workspacePath: "/remote/project",
        workspaceIdentity: "remote:server:11111111-1111-4111-8111-111111111111:/remote/project",
        workspacePurpose: "project",
        label: "project",
      },
    ],
  });

  assert.deepEqual(
    projection.openWorkspaces.map((item) => item.workspacePath),
    ["/remote/project"],
  );
  assert.equal(projection.executionContexts.length, 2);
  assertPartial(projection.executionContexts[0], {
    kind: "local",
    workspacePath: "/local/project",
  });
  assertPartial(projection.executionContexts[1], {
    kind: "remote",
    workspacePath: "/remote/project",
  });
  assert.ok(!("attachmentState" in projection.executionContexts[0]!));
});

test("没有可信 attachment fact 时不会把在线 remote session 冒充成 ready", () => {
  const projection = buildRemoteWorkspaceProjection({
    managementSnapshot: createSnapshot(),
    tabs: [
      {
        id: "remote-session",
        kind: "workspace",
        workspacePath: "/workspace/project",
        workspaceIdentity: "remote:server:11111111-1111-4111-8111-111111111111:/workspace/project",
        remoteSessionId: "session-without-attachment-fact",
        label: "project",
      },
    ],
  });

  assertPartial(projection.openWorkspaces[0], { attachmentState: "attaching" });
});
