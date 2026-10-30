import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RemoteTarget } from "@ycode/shared";
import {
  createWindowRemoteConnectionRegistry,
  type WindowRemoteConnectionCloseEvent,
  type WindowRemoteConnectionHandle,
  type WindowRemoteLogicalSessionSnapshot,
} from "../src/host/windowRemoteConnectionRegistry.js";

const sshTarget: RemoteTarget = {
  kind: "ssh",
  host: "dev.internal",
  port: 22,
  username: "developer",
};

function createHandle(
  services: string,
  options: {
    sourceServerId?: string;
    reusedConnectionTarget?: RemoteTarget;
    persistent?: boolean;
  } = {},
) {
  const closeListeners = new Set<(event: WindowRemoteConnectionCloseEvent) => void>();
  const reconnectListeners = new Set<() => void>();
  let currentServices = services;
  const handle: WindowRemoteConnectionHandle<
    string,
    { sourceServerId?: string; persistentSourceConnection?: boolean }
  > = {
    get services() {
      return currentServices;
    },
    ...(options.reusedConnectionTarget
      ? { reusedConnectionTarget: options.reusedConnectionTarget }
      : {}),
    capabilities: {
      ...(options.sourceServerId ? { sourceServerId: options.sourceServerId } : {}),
      ...(options.persistent ? { persistentSourceConnection: true } : {}),
    },
    dispose() {},
    onDidClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => closeListeners.delete(listener) };
    },
    onDidReconnect(listener) {
      reconnectListeners.add(listener);
      return { dispose: () => reconnectListeners.delete(listener) };
    },
  };
  return {
    handle,
    close(event: WindowRemoteConnectionCloseEvent) {
      for (const listener of closeListeners) listener(event);
    },
    reconnect(nextServices: string) {
      currentServices = nextServices;
      for (const listener of reconnectListeners) listener();
    },
  };
}

function createRegistry(
  handles: Array<ReturnType<typeof createHandle>>,
  overrides: {
    onSessionClosed?: (
      event: WindowRemoteConnectionCloseEvent & { remoteSessionId: string },
    ) => void;
    onSessionReconnected?: (event: {
      previous: WindowRemoteLogicalSessionSnapshot;
      current: WindowRemoteLogicalSessionSnapshot;
      services: string;
      isCurrent: () => boolean;
      commit: () => boolean;
    }) => void | Promise<void>;
  } = {},
) {
  let index = 0;
  let id = 0;
  return createWindowRemoteConnectionRegistry<
    string,
    { sourceServerId?: string; persistentSourceConnection?: boolean }
  >({
    connect: async () => {
      const handle = handles[index];
      if (!handle) throw new Error("missing handle");
      index += 1;
      return handle.handle;
    },
    createId: () => `session-${++id}`,
    resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
    shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistentSourceConnection === true,
    ...overrides,
  });
}

test("SSH/WSL/Docker window connections share one managed Source handle", async () => {
  for (const target of [
    sshTarget,
    { kind: "wsl", distro: "Ubuntu", user: "dev" } as const,
    { kind: "docker", container: "dev-container" } as const,
  ]) {
    const source = createHandle("services-managed", {
      sourceServerId: "source-1",
      persistent: true,
    });
    const registry = createRegistry([source]);
    const first = await registry.connect({
      requestId: "request-1",
      target,
      remoteAssets: {},
      workspacePath: "/work",
      workspaceIdentity: `remote:${target.kind}:dev:/work`,
    });
    const second = await registry.connect({
      requestId: "request-2",
      target,
      remoteAssets: {},
      workspacePath: "/work-2",
      workspaceIdentity: `remote:${target.kind}:dev:/work-2`,
    });
    assert.notEqual(first.remoteSessionId, second.remoteSessionId);
    assert.equal(first.sourceServerId, "source-1");
    assert.equal(registry.getStats().connectionCount, 1);
    assert.equal(registry.getStats().logicalSessionCount, 2);
    assert.ok(first.workspaceIdentity?.startsWith("remote:server:source-1:"));
    assert.equal(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: second.remoteSessionId,
        workspacePath: "/work-2",
        workspaceIdentity: second.workspaceIdentity!,
      }),
      "services-managed",
    );
  }
});

test("reusedConnectionTarget is projected without secrets", async () => {
  const secretTarget: RemoteTarget = {
    kind: "ssh",
    host: sshTarget.kind === "ssh" ? sshTarget.host : "dev.internal",
    port: 22,
    username: "developer",
    password: "super-secret",
    privateKeyPassphrase: "passphrase",
  };
  const source = createHandle("services-1", {
    sourceServerId: "source-1",
    persistent: true,
  });
  const registry = createRegistry([source]);
  const first = await registry.connect({
    requestId: "request-1",
    target: secretTarget,
    remoteAssets: {},
    workspacePath: "/work",
  });
  assert.equal(first.reusedConnectionTarget, undefined, "fresh connect must not claim reuse");
  const second = await registry.connect({
    requestId: "request-2",
    target: secretTarget,
    remoteAssets: {},
    workspacePath: "/work",
    workspaceIdentity: first.workspaceIdentity,
  });
  assert.ok(second.reusedConnectionTarget);
  assert.equal(second.reusedConnectionTarget.kind, "ssh");
  assert.equal(
    (second.reusedConnectionTarget as Extract<RemoteTarget, { kind: "ssh" }>).password,
    undefined,
  );
  assert.equal(
    (second.reusedConnectionTarget as Extract<RemoteTarget, { kind: "ssh" }>).privateKeyPassphrase,
    undefined,
  );
});

test("manager reconnect replaces the logical session and keeps workspace identity", async () => {
  const source = createHandle("services-1", {
    sourceServerId: "source-1",
    persistent: true,
  });
  const closedSessions: string[] = [];
  let commitResult: boolean | undefined;
  let reconnected:
    | {
        previousId: string;
        currentId: string;
        workspaceIdentity?: string;
        services: string;
      }
    | undefined;
  const registry = createRegistry([source], {
    onSessionClosed: (event) => {
      closedSessions.push(event.remoteSessionId);
      assert.equal(event.recoverable, true);
    },
    onSessionReconnected: async (event) => {
      reconnected = {
        previousId: event.previous.remoteSessionId,
        currentId: event.current.remoteSessionId,
        workspaceIdentity: event.current.workspaceIdentity,
        services: event.services,
      };
      commitResult = event.commit();
    },
  });
  const connected = await registry.connect({
    requestId: "request-1",
    target: sshTarget,
    remoteAssets: {},
    workspacePath: "/work",
  });
  assert.ok(connected.workspaceIdentity);
  source.close({
    exitCode: null,
    signal: null,
    recoverable: true,
    recoveryAttempt: 1,
    recoveryLimit: 3,
  });
  assert.deepEqual(closedSessions, [connected.remoteSessionId]);
  assert.equal(registry.getSession(connected.remoteSessionId)?.state, "disconnected");

  source.reconnect("services-2");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(reconnected);
  assert.notEqual(reconnected.currentId, connected.remoteSessionId);
  assert.equal(reconnected.workspaceIdentity, connected.workspaceIdentity);
  assert.equal(reconnected.services, "services-2");
  assert.equal(commitResult, true);
  assert.equal(registry.getSession(connected.remoteSessionId), null);
  const replacement = registry.getSession(reconnected.currentId);
  assert.equal(replacement?.state, "online");
  assert.equal(replacement?.workspaceIdentity, connected.workspaceIdentity);
  assert.equal(
    registry.resolveScopedServices({
      kind: "remote",
      remoteSessionId: reconnected.currentId,
      workspacePath: "/work",
      workspaceIdentity: connected.workspaceIdentity!,
    }),
    "services-2",
  );
});

test("terminal Source close is forwarded without claiming recoverability", async () => {
  const source = createHandle("services-1", {
    sourceServerId: "source-1",
    persistent: true,
  });
  const closed: WindowRemoteConnectionCloseEvent[] = [];
  const registry = createRegistry([source], {
    onSessionClosed: (event) => closed.push(event),
  });
  const connected = await registry.connect({
    requestId: "request-1",
    target: sshTarget,
    remoteAssets: {},
    workspacePath: "/work",
  });
  source.close({
    exitCode: null,
    signal: null,
    recoverable: false,
    error: "profile removed",
    reasonCode: "source-server-profile-removed",
  });
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.remoteSessionId, connected.remoteSessionId);
  assert.equal(closed[0]?.recoverable, false);
  assert.equal(closed[0]?.reasonCode, "source-server-profile-removed");
});

test("window host no longer falls back to the legacy setupRemoteConnection path", async () => {
  const hostIndex = await readFile(
    fileURLToPath(new URL("../src/host/index.ts", import.meta.url)),
    "utf8",
  );
  assert.equal(/\bsetupRemoteConnection\s*\(/u.test(hostIndex), false);
  assert.equal(/\bresolveDesktopRemoteRuntimeNetwork\b/u.test(hostIndex), false);
});
