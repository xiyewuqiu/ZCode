import type { ICredentialService, ISettingService } from "@ycode/services";
import type { AppSettings, SourceServerArtifactPolicy } from "@ycode/shared";
import {
  SourceServerDirectory,
  type SourceServerDirectorySnapshot,
} from "./sourceServerDirectory.js";
import {
  SourceServerConnectionManager,
  type SourceServerConnectionManagerOptions,
  type StartupReconnectResult,
} from "./sourceServerConnectionManager.js";
import {
  createSourceServerManagementService,
  type SourceServerManagementService,
} from "./sourceServerManagementService.js";
import { connectDesktopSourceServer } from "./connectDesktopSourceServer.js";
import { resolveSourceServerReleaseAsset } from "./sourceServerReleaseResolver.js";
import { runStartupReconnectBatch } from "./sourceServerStartupReconnect.js";
import type {
  ServerRemoteConnection,
  ServerRemoteDuplexConnectionOptions,
} from "./serverRemoteConnection.js";
import type { WindowRemoteAssetDirs } from "./windowRemoteConnectionRegistry.js";

export interface SourceServerHostLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface SourceServerHostRuntimeOptions {
  settingService: ISettingService;
  credentialService: ICredentialService;
  logger: SourceServerHostLogger;
  /** Main 在 InitLocal 下发的 remote assets 目录；决定 release 缓存与开发态 mock-cdn。 */
  remoteAssets?: WindowRemoteAssetDirs;
  /** 缺省 release-versioned；开发内容寻址只在未打包 Electron 显式授权。 */
  artifactPolicy?: SourceServerArtifactPolicy;
  /** Host 网络策略（设置页代理）；缺省时 release 下载使用 global fetch。 */
  fetch?: typeof fetch;
  /** Host 已进入释放流程时，启动重连不得再发起新 probe。 */
  isDisposed?: () => boolean;
  /** 项目成员 admission：Manager 只调用，不承担持久化。 */
  admitConnection?: SourceServerConnectionManagerOptions["admitConnection"];
  /** Source 发布后订阅 state:projects，仅通知读取，不携带项目数据。 */
  onProjectChange?: (sourceServerId: string) => void;
  onBeforeSourceServerRemoved?: (sourceServerId: string) => Promise<void>;
  onDirectorySnapshot?: (snapshot: SourceServerDirectorySnapshot) => void;
  onConnectionLog?: (event: { phase: string; message: string; progress?: number }) => void;
  /** 测试注入：不改变生产默认的 transport adapter / duplex 连接实现。 */
  createAdapter?: SourceServerConnectionManagerOptions["createAdapter"];
  connectServer?: (options: ServerRemoteDuplexConnectionOptions) => Promise<ServerRemoteConnection>;
  createProfileId?: () => string;
  directoryNow?: () => number;
  managerNow?: () => number;
}

export interface SourceServerHostRuntime {
  readonly directory: SourceServerDirectory;
  readonly manager: SourceServerConnectionManager;
  readonly management: SourceServerManagementService;
  initialize(): Promise<void>;
  /** 启动静默重连；开关关闭时连候选枚举都不执行。 */
  startStartupReconnect(): Promise<StartupReconnectResult[]>;
  dispose(): void;
}

type ResolveRelease = NonNullable<SourceServerConnectionManagerOptions["resolveRelease"]>;

/**
 * 每个 Window Host 唯一的 Source Server 运行时：
 * - Directory 持久化 Profile/Source/workspace 历史；
 * - Manager 持有物理连接（sourceServerId 为 owner，remoteSessionId 不参与）；
 * - Management 是对 Renderer 暴露的唯一管理面。
 *
 * 本模块不创建 logical workspace / attachment，也不向手机 replayable 路径发布状态。
 */
export function createSourceServerHostRuntime(
  options: SourceServerHostRuntimeOptions,
): SourceServerHostRuntime {
  const logger = options.logger;
  const directory = new SourceServerDirectory({
    settingService: options.settingService,
    credentialService: options.credentialService,
    ...(options.createProfileId ? { createProfileId: options.createProfileId } : {}),
    ...(options.directoryNow ? { now: options.directoryNow } : {}),
    // Host 域没有独立 debug channel；按 debug 语义仅在非生产输出。
    logDebug: (message) => {
      if (process.env.NODE_ENV !== "production") logger.info(message);
    },
  });

  const resolveRelease: ResolveRelease = async (probe, target, resolveOptions) =>
    await resolveSourceServerReleaseAsset(
      probe,
      options.remoteAssets ?? {},
      target,
      options.fetch ? { fetch: options.fetch } : undefined,
      resolveOptions,
    );

  const manager = new SourceServerConnectionManager({
    directory,
    ...(options.createAdapter ? { createAdapter: options.createAdapter } : {}),
    ...(options.admitConnection ? { admitConnection: options.admitConnection } : {}),
    ...(options.onProjectChange ? { onProjectChange: options.onProjectChange } : {}),
    connectServer:
      options.connectServer ??
      ((connectionOptions) => connectDesktopSourceServer(connectionOptions)),
    logWarn: (message, error) => logger.warn(message, error),
    ...(options.artifactPolicy ? { sourceServerArtifactPolicy: options.artifactPolicy } : {}),
    ...(options.managerNow ? { now: options.managerNow } : {}),
    resolveRelease,
  });

  const management = createSourceServerManagementService({
    directory,
    manager,
    resolveRelease,
    ...(options.onDirectorySnapshot ? { onDirectorySnapshot: options.onDirectorySnapshot } : {}),
    ...(options.onConnectionLog ? { onConnectionLog: options.onConnectionLog } : {}),
    onBeforeSourceServerRemoved:
      options.onBeforeSourceServerRemoved ??
      (async () => {
        // 本仓库没有 remote-project 缓存；删除本地目录前排空运行态即可。
      }),
  });

  let initializeFlight: Promise<void> | null = null;
  let startupReconnectFlight: Promise<StartupReconnectResult[]> | null = null;
  let disposed = false;

  const initialize = async (): Promise<void> => {
    if (!initializeFlight) {
      const flight = directory.initialize();
      initializeFlight = flight;
      // 失败 flight 不缓存，用户显式连接或下一次启动重连仍可重试。
      void flight.catch(() => {
        if (initializeFlight === flight) initializeFlight = null;
      });
    }
    await initializeFlight;
  };

  return {
    directory,
    manager,
    management,
    initialize,
    async startStartupReconnect() {
      if (startupReconnectFlight) return await startupReconnectFlight;
      let flight!: Promise<StartupReconnectResult[]>;
      flight = (async () => {
        await initialize();
        if (disposed || options.isDisposed?.()) return [];
        return await runStartupReconnectBatch({
          getSettings: () =>
            options.settingService.get() as Promise<
              Pick<AppSettings, "remoteStartupAutoReconnectEnabled">
            >,
          listCandidates: () => directory.listStartupReconnectCandidates(),
          reconnect: (candidates) => manager.reconnectOnStartup(candidates),
        });
      })().finally(() => {
        if (startupReconnectFlight === flight) startupReconnectFlight = null;
      });
      startupReconnectFlight = flight;
      return await flight;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      management.dispose();
      manager.dispose();
    },
  };
}
