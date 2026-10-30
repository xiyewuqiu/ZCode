import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile, RemoteTarget } from "@ycode/shared";
import { connectSourceServerTarget } from "../src/host/connectSourceServerTarget.js";
import type {
  ConnectSourceServerOptions,
  ManagedSourceServerConnection,
} from "../src/host/sourceServerConnectionManager.js";
import type { IServiceAccessor } from "@ycode/services";

const profile: ConnectionProfile = {
  profileId: "11111111-1111-4111-8111-111111111111",
  transport: "ssh",
  target: { kind: "ssh", host: "example.com", port: 22, username: "dev" },
  createdAt: 1,
  lifecycleState: "active",
};

const target: Exclude<RemoteTarget, { kind: "server" }> = {
  kind: "ssh",
  host: "example.com",
  port: 22,
  username: "dev",
  password: "secret",
};

function managed(
  overrides: Partial<ManagedSourceServerConnection> = {},
): ManagedSourceServerConnection {
  return {
    sourceServerId: "22222222-2222-4222-8222-222222222222",
    profileId: profile.profileId,
    serverInfo: {
      serverId: "22222222-2222-4222-8222-222222222222",
      version: "9.9.9",
      protocolVersion: 1,
      authRequired: false,
      workspaces: [],
      capabilities: {},
    },
    services: {} as IServiceAccessor,
    ...overrides,
  };
}

function directoryStub() {
  const calls: Array<{ deferCredentials?: boolean }> = [];
  let index = 0;
  return {
    calls,
    ensureProfile: async (_target: unknown, options?: { deferCredentials?: boolean }) => {
      calls.push(options ?? {});
      index += 1;
      return index === 1 ? profile : { ...profile };
    },
  };
}

test("manager connect receives membership intent, install permission and progress context", async () => {
  const directory = directoryStub();
  let captured: ConnectSourceServerOptions | undefined;
  const connection = await connectSourceServerTarget(
    directory,
    {
      connect: async (options) => {
        captured = options;
        return managed();
      },
    },
    {
      target,
      membershipIntent: "retain",
      allowInstall: true,
      context: { signal: new AbortController().signal },
    },
  );
  assert.ok(captured);
  assert.equal(captured.target, target);
  assert.equal(captured.profile, profile);
  assert.equal(captured.membershipIntent, "retain");
  assert.equal(captured.allowInstall, true);
  assert.ok(captured.context?.signal);
  // 非复用路径必须在认证成功后提交凭据（第二次 ensureProfile 不带 defer）。
  assert.deepEqual(directory.calls, [{ deferCredentials: true }, {}]);
  assert.equal(connection.profile.profileId, profile.profileId);
});

test("reused physical connection keeps the original profile credential refs", async () => {
  const directory = directoryStub();
  const reusedTarget: RemoteTarget = {
    kind: "ssh",
    host: "example.com",
    port: 22,
    username: "dev",
  };
  const connection = await connectSourceServerTarget(
    directory,
    {
      connect: async () => managed({ reusedConnectionTarget: reusedTarget }),
    },
    { target },
  );
  assert.deepEqual(directory.calls, [{ deferCredentials: true }]);
  assert.equal(connection.profile, profile);
  assert.deepEqual(connection.connection.reusedConnectionTarget, reusedTarget);
  // 复用目标必须是脱敏后的实际线路；密码不进入 profile/registry 投影。
  assert.equal("password" in connection.connection.reusedConnectionTarget!, false);
});
