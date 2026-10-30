import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings, ConnectionProfile, ServerRemoteInfo } from "@ycode/shared";
import { YCODE_COMPATIBILITY_MANIFEST } from "@ycode/shared";
import { ServiceCollection, ISourceServerManagementService } from "@ycode/services";
import type { IServiceAccessor } from "@ycode/services";
import type { SourceServerTransportAdapter } from "@ycode/server/source-server";
import { createSourceServerHostRuntime } from "../src/host/sourceServerHostRuntime.js";
import type { ServerRemoteConnection } from "../src/host/serverRemoteConnection.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";

function fakeServices(initial?: Partial<AppSettings>) {
  let settings: AppSettings = {
    recentProjects: [],
    locale: "zh-CN",
    sourceServerDirectoryMigrationVersion: 1,
    sourceServers: [],
    connectionProfiles: [],
    sourceServerWorkspaceHistory: [],
    ...initial,
  };
  const credentials = new Map<string, string>();
  return {
    settings: () => settings,
    settingService: {
      get: async () => settings,
      update: async (patch: Partial<AppSettings>) => {
        settings = { ...settings, ...patch };
      },
      updateDataBaseDir: async () => {},
      ensureDefaultProject: async () => ({ path: "/tmp/default", created: false }),
    },
    credentialService: {
      load: async (key: string) => credentials.get(key) ?? null,
      save: async (key: string, value: string) => {
        credentials.set(key, value);
      },
      delete: async (key: string) => {
        credentials.delete(key);
      },
    },
  };
}

function seededSettings(enabled: boolean, lastOnlineAt = 1): Partial<AppSettings> {
  const profile: ConnectionProfile = {
    profileId: PROFILE_ID,
    sourceServerId: SERVER_ID,
    transport: "wsl",
    target: { kind: "wsl", distro: "Ubuntu", user: "dev" },
    createdAt: 1,
    lifecycleState: "active",
  };
  return {
    remoteStartupAutoReconnectEnabled: enabled,
    sourceServers: [
      {
        sourceServerId: SERVER_ID,
        displayName: "dev box",
        installState: "installed",
        declaredWorkspaces: [],
        lastOnlineAt,
        preferredProfileId: PROFILE_ID,
      },
    ],
    connectionProfiles: [profile],
  };
}

function createFakeSource(connectCalls: { count: number }): {
  adapter: SourceServerTransportAdapter;
  connectServer: () => Promise<ServerRemoteConnection>;
} {
  const compatibility = YCODE_COMPATIBILITY_MANIFEST;
  const serverInfo: ServerRemoteInfo = {
    serverId: SERVER_ID,
    version: compatibility.productVersion,
    protocolVersion: 1,
    authRequired: false,
    workspaces: [],
    compatibility,
    identity: { osUser: "dev", hostname: "dev-box" },
    capabilities: { desktopContinuous: true, websocketRpc: true },
  };
  const adapter: SourceServerTransportAdapter = {
    kind: "wsl",
    createFileTransfer: () => ({}) as never,
    probe: async () => ({
      platform: "linux",
      arch: "x64",
      installed: true,
      installedVersion: compatibility.productVersion,
    }),
    installOrUpdate: async () => {},
    ensureDaemon: async () => ({ port: 1234, ingressToken: "token" }),
    openChannel: async () => {
      throw new Error("not used");
    },
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  };
  return {
    adapter,
    connectServer: async () => {
      connectCalls.count += 1;
      return {
        serverInfo,
        services: {} as IServiceAccessor,
        dispose: () => {},
      };
    },
  };
}

test("runtime registers management service and disposes idempotently", async () => {
  const fake = fakeServices();
  const runtime = createSourceServerHostRuntime({
    settingService: fake.settingService as never,
    credentialService: fake.credentialService as never,
    logger: { info: () => {}, warn: () => {} },
  });

  await runtime.initialize();
  const snapshot = await runtime.management.getSnapshot();
  assert.equal(snapshot.profiles.length, 0);
  assert.equal(snapshot.servers.length, 0);

  const services = new ServiceCollection().register(
    ISourceServerManagementService,
    runtime.management,
  );
  assert.equal(services.get(ISourceServerManagementService), runtime.management);

  runtime.dispose();
  runtime.dispose();
});

test("startup reconnect is gated by remoteStartupAutoReconnectEnabled", async () => {
  const connectCalls = { count: 0 };
  const fake = fakeServices(seededSettings(false));
  const source = createFakeSource(connectCalls);
  const runtime = createSourceServerHostRuntime({
    settingService: fake.settingService as never,
    credentialService: fake.credentialService as never,
    logger: { info: () => {}, warn: () => {} },
    createAdapter: () => source.adapter,
    connectServer: source.connectServer,
  });

  const results = await runtime.startStartupReconnect();
  assert.deepEqual(results, []);
  assert.equal(connectCalls.count, 0);
  runtime.dispose();
});

test("startup reconnect publishes a saved Source online and records failure per profile", async () => {
  const connectCalls = { count: 0 };
  const fake = fakeServices(seededSettings(true));
  const source = createFakeSource(connectCalls);
  const runtime = createSourceServerHostRuntime({
    settingService: fake.settingService as never,
    credentialService: fake.credentialService as never,
    logger: { info: () => {}, warn: () => {} },
    createAdapter: () => source.adapter,
    connectServer: source.connectServer,
  });

  const results = await runtime.startStartupReconnect();
  assert.deepEqual(results, [{ profileId: PROFILE_ID, status: "online" }]);
  assert.equal(connectCalls.count, 1);
  assert.equal(runtime.manager.getOnlineConnection(SERVER_ID)?.sourceServerId, SERVER_ID);
  // 启动批次完成后再进入管理快照也能看到 online 状态。
  const snapshot = await runtime.management.getSnapshot();
  assert.equal(snapshot.states.find((state) => state.profileId === PROFILE_ID)?.state, "online");

  // dispose 后物理连接必须回收，后续请求不能再访问该 Source。
  runtime.dispose();
  assert.equal(runtime.manager.getOnlineConnection(SERVER_ID), undefined);
});
