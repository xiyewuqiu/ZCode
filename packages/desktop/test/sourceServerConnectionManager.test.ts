import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile, ServerRemoteInfo } from "@ycode/shared";
import { createCompatibilityManifest } from "@ycode/shared";
import type { SourceServerTransportAdapter } from "@ycode/server/source-server";
import { SourceServerConnectionManager } from "../src/host/sourceServerConnectionManager.js";
import type { ServerRemoteConnection } from "../src/host/serverRemoteConnection.js";
import type { IServiceAccessor } from "@ycode/services";

const profile: ConnectionProfile = {
  profileId: "11111111-1111-4111-8111-111111111111",
  transport: "ssh",
  target: { kind: "ssh", host: "example.com", port: 22, username: "dev" },
  createdAt: 1,
  lifecycleState: "active",
};

const target = { kind: "ssh", host: "example.com", port: 22, username: "dev" } as const;

test("connection manager publishes online after probe, daemon and handshake", async () => {
  const manifest = createCompatibilityManifest("9.9.9", "9.0.0");
  const serverInfo: ServerRemoteInfo = {
    serverId: "22222222-2222-4222-8222-222222222222",
    version: "9.9.9",
    protocolVersion: 1,
    authRequired: false,
    workspaces: [],
    compatibility: manifest,
    identity: { osUser: "dev", hostname: "host" },
    capabilities: { desktopContinuous: true, websocketRpc: true },
  };
  const adapter: SourceServerTransportAdapter = {
    kind: "ssh",
    createFileTransfer: () => ({}) as never,
    probe: async () => ({
      platform: "linux",
      arch: "x64",
      installed: true,
      installedVersion: "9.9.9",
    }),
    installOrUpdate: async () => {},
    ensureDaemon: async () => ({ port: 1234, ingressToken: "token" }),
    openChannel: async () => {
      throw new Error("not used");
    },
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  };
  const connection: ServerRemoteConnection = {
    serverInfo,
    services: {} as IServiceAccessor,
    dispose: () => {},
  };
  const recorded: string[] = [];
  const manager = new SourceServerConnectionManager({
    directory: {
      recordHandshake: async (profileId) => {
        recorded.push(profileId);
        return { identityChanged: false, effectiveProfile: profile };
      },
    },
    createAdapter: () => adapter,
    connectServer: async () => connection,
    compatibilityManifest: manifest,
    now: () => 100,
  });

  const result = await manager.connect({ profile, target, membershipIntent: "retain" });
  assert.equal(result.sourceServerId, serverInfo.serverId);
  assert.deepEqual(recorded, [profile.profileId]);
  assert.equal(
    manager.listStates().find((state) => state.profileId === profile.profileId)?.state,
    "online",
  );
  assert.equal(manager.getOnlineConnection(serverInfo.serverId)?.services, connection.services);

  manager.disconnect(serverInfo.serverId);
  assert.equal(manager.getOnlineConnection(serverInfo.serverId), undefined);
  assert.equal(
    manager.listStates().find((state) => state.profileId === profile.profileId)?.state,
    "offline",
  );
  manager.dispose();
});

test("connection manager publishes ssh, wsl and docker Source transports", async () => {
  for (const transport of ["ssh", "wsl", "docker"] as const) {
    const manifest = createCompatibilityManifest("9.9.9", "9.0.0");
    const serverInfo: ServerRemoteInfo = {
      serverId: "22222222-2222-4222-8222-222222222222",
      version: "9.9.9",
      protocolVersion: 1,
      authRequired: false,
      workspaces: [],
      compatibility: manifest,
      capabilities: { desktopContinuous: true, websocketRpc: true },
    };
    const transportTarget =
      transport === "ssh"
        ? ({ kind: "ssh", host: "example.com", port: 22, username: "dev" } as const)
        : transport === "wsl"
          ? ({ kind: "wsl", distro: "Ubuntu", user: "dev" } as const)
          : ({ kind: "docker", container: "dev-container" } as const);
    const transportProfile: ConnectionProfile = {
      ...profile,
      transport,
      target: transportTarget,
    };
    const adapter = {
      kind: transport,
      createFileTransfer: () => ({}) as never,
      probe: async () => ({
        platform: "linux" as const,
        arch: "x64",
        installed: true,
        installedVersion: "9.9.9",
      }),
      installOrUpdate: async () => {},
      ensureDaemon: async () => ({ port: 1234, ingressToken: "token" }),
      openChannel: async () => {
        throw new Error("not used");
      },
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    } satisfies SourceServerTransportAdapter;
    const manager = new SourceServerConnectionManager({
      directory: {
        recordHandshake: async () => ({
          identityChanged: false,
          effectiveProfile: transportProfile,
        }),
      },
      createAdapter: () => adapter,
      connectServer: async () => ({
        serverInfo,
        services: {} as IServiceAccessor,
        dispose: () => {},
      }),
      compatibilityManifest: manifest,
      now: () => 100,
    });

    const result = await manager.connect({
      profile: transportProfile,
      target: transportTarget,
      membershipIntent: "add",
    });
    assert.equal(result.sourceServerId, serverInfo.serverId);
    assert.equal(
      manager.listStates().find((state) => state.profileId === transportProfile.profileId)?.state,
      "online",
    );

    // 同一 Source 的第二个 Profile 复用物理连接时返回脱敏的实际 target。
    const reused = await manager.connect({
      profile: {
        ...transportProfile,
        profileId: "33333333-3333-4333-8333-333333333333",
        sourceServerId: serverInfo.serverId,
      },
      target: transportTarget,
      membershipIntent: "retain",
    });
    assert.equal(reused.sourceServerId, serverInfo.serverId);
    assert.deepEqual(reused.reusedConnectionTarget, transportTarget);
    manager.dispose();
  }
});
