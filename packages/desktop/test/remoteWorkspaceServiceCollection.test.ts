import assert from "node:assert/strict";
import test from "node:test";
import {
  IBroadcastService,
  IClientConfigService,
  ICredentialService,
  IFileService,
  IProjectService,
  IRemoteProjectService,
  ISettingService,
  IWindowProjectChangesService,
  IWindowProjectService,
  IWindowRemoteProjectService,
  IYCodeAgentService,
  IYCodeTaskService,
  ServiceCollection,
  type IServiceAccessor,
} from "@ycode/services";
import type { RemoteTarget } from "@ycode/shared";
import { createServerRemoteWorkspaceServiceCollection } from "../src/host/remoteWorkspaceServiceCollection.js";

/**
 * 受管 Source 与直连 server 共用同一集合：所有业务服务都来自远端 accessor。
 * Stub 只提供 channel 形状，避免测试伪造远端 RPC 行为。
 */
function createRemoteAccessor(): IServiceAccessor {
  const values = new Map<string, unknown>();
  return new Proxy({} as IServiceAccessor, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      let value = values.get(property);
      if (value === undefined) {
        value = { channelName: property };
        values.set(property, value);
      }
      return value;
    },
  });
}

const clientConfigService = { channelName: "client-config" } as unknown as IClientConfigService;

test("managed ssh/wsl/docker and direct server expose the same remote-authoritative collection", () => {
  const accessor = createRemoteAccessor();
  const collections = (
    ["ssh", "wsl", "docker", "server"] as const satisfies readonly RemoteTarget["kind"][]
  ).map((targetKind) =>
    createServerRemoteWorkspaceServiceCollection({
      clientConfigService,
      connectionServices: accessor,
      targetKind,
    }),
  );

  for (const services of collections) {
    assert.equal(services.get(IFileService), accessor.fileService);
    assert.equal(services.get(IYCodeTaskService), accessor.ycodeTaskService);
    assert.equal(services.get(IYCodeAgentService), accessor.ycodeAgentService);
    // 设置/凭据属于目标 Environment；不能注入桌面本机事实。
    assert.equal(services.get(ISettingService), accessor.settingService);
    assert.equal(services.get(ICredentialService), accessor.credentialService);
    assert.equal(services.get(IClientConfigService), clientConfigService);
    assert.equal(services.getOptional(IProjectService), undefined);
  }
});

test("virtual-project capability forwards project channels for every managed transport", () => {
  for (const targetKind of ["ssh", "wsl", "docker", "server"] as const) {
    const accessor = createRemoteAccessor();
    const services = createServerRemoteWorkspaceServiceCollection({
      clientConfigService,
      connectionServices: accessor,
      virtualProjects: true,
      targetKind,
    });
    assert.equal(services.get(IProjectService), accessor.projectService);
    assert.equal(services.get(IRemoteProjectService), accessor.remoteProjectService);
  }
});

test("virtual-project registration fails closed when the remote contract is incomplete", () => {
  const accessor = createRemoteAccessor();
  const incomplete = new Proxy(accessor, {
    get(target, property, receiver) {
      if (property === "projectService" || property === "remoteProjectService") return undefined;
      return Reflect.get(target, property, receiver);
    },
  }) as IServiceAccessor;
  assert.throws(
    () =>
      createServerRemoteWorkspaceServiceCollection({
        clientConfigService,
        connectionServices: incomplete,
        virtualProjects: true,
        targetKind: "ssh",
      }),
    /Remote virtual-project RPC registration incomplete/u,
  );
});

test("sourceServices publishes window-owner project channels for mobile replayable", () => {
  const accessor = createRemoteAccessor();
  const windowProject = { channelName: "window-project" } as never;
  const windowRemoteProject = { channelName: "window-remote-project" } as never;
  const broadcast = {
    onMessage: () => ({ dispose: () => undefined }),
  } as never;
  const sourceServices = new ServiceCollection()
    .register(IProjectService, windowProject)
    .register(IRemoteProjectService, windowRemoteProject)
    .register(IBroadcastService, broadcast);
  const services = createServerRemoteWorkspaceServiceCollection({
    clientConfigService,
    connectionServices: accessor,
    targetKind: "ssh",
    sourceServices,
  });
  assert.equal(services.get(IWindowProjectService), windowProject);
  assert.equal(services.get(IWindowRemoteProjectService), windowRemoteProject);
  assert.ok(services.get(IWindowProjectChangesService));
});
