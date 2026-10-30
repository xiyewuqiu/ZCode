/* eslint-disable max-lines -- 远程 workspace 服务注册需集中维护，以保持依赖注入顺序 */
import {
  ServiceCollection,
  IFileService,
  IMediaPreviewService,
  IGitService,
  IGitCheckpointService,
  ISystemService,
  ITerminalService,
  ISettingService,
  ICredentialService,
  IBroadcastService,
  IOnboardingRecordService,
  IYCodeTaskService,
  IYCodeAgentService,
  IYCodeSessionService,
  IFileWatcherService,
  IModelSelectionService,
  IProviderSettingsService,
  IUsageStatsService,
  IClientConfigService,
  IClientScenesService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginSyncService,
  IPluginsService,
  IPluginManagementService,
  ISubagentsService,
  ICommandsService,
  IHooksService,
  IMemoryService,
  ISettingsSyncService,
  IFeedbackService,
  IPromptAttachmentTransferService,
  IProjectService,
  IRemoteProjectService,
  ISourceServerWorkspaceService,
  IWindowProjectService,
  IWindowRemoteProjectService,
  IWindowProjectChangesService,
  createWindowProjectChangesService,
  type IServiceAccessor,
} from "@ycode/services";

import {
  createSettingService,
  createCredentialService,
  createBroadcastService,
  createNodeApiClient,
  createHostApiNetworkTransport,
  registerHostApiNetworkTransportForDispose,
  createSettingsSyncService,
  createUsageStatsService,
  createClientScenesService,
  createServiceLogger,
  createSubagentsService,
  createMemoryService,
} from "@ycode/services/node";

import {
  DEFAULT_YCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  type RemoteTarget,
  type YCodeSessionRuntimePreferencesResult,
} from "@ycode/shared";
import { assertLegacyRemoteWorkspaceRpcContract } from "./legacyRemoteWorkspaceRpcContract.js";

const runtimePreferencesLogger = createServiceLogger("remote-runtime-preferences");

export function createRemoteWorkspaceServiceCollection(params: {
  clientConfigService: IClientConfigService;
  connectionServices: IServiceAccessor;
  sourceServices?: ServiceCollection;
  parentPort: Parameters<typeof createBroadcastService>[0];
  createReportingRemoteYCodeTaskService: <T extends object>(service: T) => T;
  createRemotePromptAttachmentTaskService: <T extends object>(service: T) => T;
  createRemotePromptAttachmentSessionService: <T extends object>(service: T) => T;
  promptAttachmentTransferService: IPromptAttachmentTransferService;
  runtimePreferencesBridge: {
    onError: (error: unknown) => void;
  };
}): ServiceCollection {
  assertLegacyRemoteWorkspaceRpcContract(params.connectionServices);
  const localSettingService = createSettingService();
  const localCredentialService = createCredentialService();
  const hostApiNetworkTransport = createHostApiNetworkTransport(async () => {
    const settings = await localSettingService.get();
    return {
      httpProxy: settings.httpProxy,
      noProxy: settings.httpProxyNoProxy,
      caCertPath: settings.httpProxyCaCertPath,
    };
  });
  const localApiClient = createNodeApiClient({
    fetchImpl: hostApiNetworkTransport.fetch,
  });
  const localBroadcastService = createBroadcastService(params.parentPort);
  const reportingRemoteYCodeTaskService = params.createReportingRemoteYCodeTaskService(
    params.connectionServices.ycodeTaskService,
  );
  // 手机 remote 的 replayable mirror 在 reporting wrapper 中发布用户消息；
  // 附件物化必须包在 reporting 外层，确保 mirror 和真正发给远端 agent 的 prompt 使用同一份远端路径。
  const remoteYCodeTaskService = params.createRemotePromptAttachmentTaskService(
    reportingRemoteYCodeTaskService,
  );
  const remoteYCodeSessionService = params.createRemotePromptAttachmentSessionService(
    params.connectionServices.ycodeSessionService,
  );

  // desktop-attached remote 的 Agent 运行在远端，但 app-global 设置权威仍在
  // desktop shared Host。通过窄化的 runtime-preferences 请求原路返回，避免远端读取自己的 setting。
  const { onError } = params.runtimePreferencesBridge;
  params.connectionServices.ycodeAgentService.onDynamicSessionRuntimePreferencesRequest()(
    (request) => {
      const startedAt = Date.now();
      const requestContext = {
        event: "ycode_protocol.runtime_preferences.host_request_received",
        module: "desktop.host.remote_workspace",
        requestId: request.requestId,
        scope: request.scope,
        sessionId: request.sessionId,
      };
      // 诊断：Agent 侧超时只能说明没有拿到响应；这里记录 Host 是否收到请求，
      // 用“收到但无 response”区分 transport 丢包和设置读取卡住。
      runtimePreferencesLogger.info(
        undefined,
        "runtime preferences host request received",
        requestContext,
      );
      void (async () => {
        const trackStage = <T>(stage: string, promise: Promise<T>): Promise<T> => {
          const stageStartedAt = Date.now();
          return promise.then(
            (value) => {
              runtimePreferencesLogger.debug(
                undefined,
                "runtime preferences host stage completed",
                {
                  ...requestContext,
                  durationMs: Math.max(0, Date.now() - stageStartedAt),
                  stage,
                },
              );
              return value;
            },
            (error: unknown) => {
              runtimePreferencesLogger.warn(undefined, "runtime preferences host stage failed", {
                ...requestContext,
                durationMs: Math.max(0, Date.now() - stageStartedAt),
                error: error instanceof Error ? error.message : String(error),
                stage,
              });
              throw error;
            },
          );
        };
        let resolution:
          | { status: "resolved"; preferences: YCodeSessionRuntimePreferencesResult }
          | { status: "failed"; message: string };
        try {
          // 与本地 Host 同源：固定预算不依赖配置网关，远程/手机偏好响应不再串行等待网络。
          const settings = await trackStage("settings", localSettingService.get());
          const modelContextBudgetStrategy = DEFAULT_YCODE_MODEL_CONTEXT_BUDGET_STRATEGY;
          resolution = {
            status: "resolved",
            preferences: {
              askUserQuestionAutoResolutionEnabled:
                settings.askUserQuestionAutoResolutionEnabled !== false,
              nativeSearchEnhancementsEnabled: settings.nativeSearchEnhancementsEnabled !== false,
              // 远端会话也读取桌面 Host 的权威设置；模式仅在远端 create/resume 时读取一次。
              toolSearchMode: settings.toolSearchMode ?? "off",
              memoryEnabled: settings.memoryEnabled === true,
              modelContextBudgetStrategy,
              // remote workspace 与本地 Host 保持同一 scope 边界，首次执行不得再次等待 client config。
              ...(request.scope === "user-execution" && settings.integratedTerminalShell
                ? { integratedTerminalShell: settings.integratedTerminalShell }
                : {}),
            },
          };
        } catch (error) {
          resolution = {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          };
          runtimePreferencesLogger.warn(undefined, "runtime preferences host resolution failed", {
            ...requestContext,
            durationMs: Math.max(0, Date.now() - startedAt),
            error: resolution.message,
          });
        }
        // 只把设置读取失败编码为 -32603；发送失败交给最终 onError 记录，不能重试同一请求。
        await params.connectionServices.ycodeAgentService.respondSessionRuntimePreferences({
          requestId: request.requestId,
          resolution,
        });
        runtimePreferencesLogger.info(undefined, "runtime preferences host response sent", {
          ...requestContext,
          durationMs: Math.max(0, Date.now() - startedAt),
          resolutionStatus: resolution.status,
        });
      })().catch((error: unknown) => {
        runtimePreferencesLogger.warn(undefined, "runtime preferences host response failed", {
          ...requestContext,
          durationMs: Math.max(0, Date.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        });
        onError(error);
      });
    },
  );

  // Web 手机远控进入 SSH task 时只连到 remote workspace host，
  // 没有桌面 renderer 那层 `baseServices + remoteServices` 合并。
  // 因此这里为 remote workspace host 补齐本地全局 channel；文件、终端、YCode Agent 仍来自远端，
  // 设置、凭据、模型供应商和 settings-sync 继续读写本机配置。
  const services = new ServiceCollection()
    .register(IFileService, params.connectionServices.fileService)
    .register(IGitService, params.connectionServices.gitService)
    .register(IGitCheckpointService, params.connectionServices.gitCheckpointService)
    .register(ISystemService, params.connectionServices.systemService)
    .register(ITerminalService, params.connectionServices.terminalService)
    .register(ISettingService, localSettingService)
    .register(ICredentialService, localCredentialService)
    .register(IBroadcastService, localBroadcastService)
    .register(IYCodeTaskService, remoteYCodeTaskService)
    .register(IYCodeAgentService, params.connectionServices.ycodeAgentService)
    .register(IYCodeSessionService, remoteYCodeSessionService)
    .register(IFileWatcherService, params.connectionServices.fileWatcherService)
    // Provider/Model 事实属于目标 Environment。远端 workspace 的选择和设置视图
    // 必须直接读取远端 Registry，不能继续显示 Desktop 本地 Provider。
    .register(IModelSelectionService, params.connectionServices.modelSelectionService)
    .register(IProviderSettingsService, params.connectionServices.providerSettingsService)
    .register(
      IUsageStatsService,
      // BigModel 用量 monitor / entitlement 链路已随官方供应商下线移除；
      // usage-stats 仅保留 App Usage（agent 数据库统计）。
      createUsageStatsService({
        ycodeAgentService: params.connectionServices.ycodeAgentService,
      }),
    )
    .register(IClientConfigService, params.clientConfigService)
    .register(IClientScenesService, createClientScenesService({ apiClient: localApiClient }))
    // 远端 workspace 的项目级 skills/plugins/commands 位于 SSH/Docker 文件系统。
    // 这里必须透出远端服务，避免本机服务拿远端 workspacePath 去本机目录扫描。
    .register(ISkillsService, params.connectionServices.skillsService)
    .register(ISkillSyncService, params.connectionServices.skillSyncService)
    .register(IMcpSyncService, params.connectionServices.mcpSyncService)
    .register(IPluginSyncService, params.connectionServices.pluginSyncService)
    .register(IPluginsService, params.connectionServices.pluginsService)
    // 远端设置页插件管理也必须打到远端 agent（插件目录在远端文件系统）。
    .register(IPluginManagementService, params.connectionServices.pluginManagementService)
    .register(ICommandsService, params.connectionServices.commandsService)
    .register(ISubagentsService, createSubagentsService({ isDesktopRuntime: true }))
    .register(IHooksService, params.connectionServices.hooksService)
    .register(IMemoryService, createMemoryService())
    .register(
      ISettingsSyncService,
      createSettingsSyncService({ settingService: localSettingService }),
    )
    .register(IPromptAttachmentTransferService, params.promptAttachmentTransferService);
  // 项目 RPC 属于目标 Environment。旧远端可能没有这两个 channel；注册代理后调用会显式
  // reject unknown channel，而不是回落到本机项目库。
  if (params.connectionServices.projectService) {
    services.register(IProjectService, params.connectionServices.projectService);
  }
  if (params.connectionServices.remoteProjectService) {
    services.register(IRemoteProjectService, params.connectionServices.remoteProjectService);
  }
  // Source 身份解析属于目标 Environment；窗口 Host 打开项目前必须经该连接解析 canonical key。
  if (params.connectionServices.sourceServerWorkspaceService) {
    services.register(
      ISourceServerWorkspaceService,
      params.connectionServices.sourceServerWorkspaceService,
    );
  }
  // 手机 replayable 使用窗口 owner 的项目目录，而不是把 Source 内部 project channel 当窗口目录。
  // 旧 Host 未提供 sourceServices 时保持不发布，避免部分频道或回落到远端服务。
  if (params.sourceServices) {
    const windowProject = params.sourceServices.getOptional(IProjectService);
    const windowRemoteProject = params.sourceServices.getOptional(IRemoteProjectService);
    const windowBroadcast = params.sourceServices.getOptional(IBroadcastService);
    if (windowProject && windowRemoteProject && windowBroadcast) {
      services
        .register(IWindowProjectService, windowProject)
        .register(IWindowRemoteProjectService, windowRemoteProject)
        .register(IWindowProjectChangesService, createWindowProjectChangesService(windowBroadcast));
    }
  }
  registerHostApiNetworkTransportForDispose(services, hostApiNetworkTransport);
  return services;
}

/**
 * 受管 Source 的远端集合：目标是一个已经运行的完整 ycode-server，
 * Host 只做 RPC 转接，不替 server 决定 workspace/runtime/provider 归属。
 * `ssh` / `wsl` / `docker` 隧道 Source 与直连 `kind=server` 共用同一集合：
 * 设置、凭据、广播、Provider 视图全部来自远端，不注入本机配置，
 * 避免把桌面设置伪装成远端事实。
 */
export function createServerRemoteWorkspaceServiceCollection(params: {
  clientConfigService: IClientConfigService;
  connectionServices: IServiceAccessor;
  virtualProjects?: boolean;
  targetKind: RemoteTarget["kind"];
  /**
   * 本机 Local Host 服务；手机 `web-remote-replayable` 进入 SSH/WSL/Docker 任务时
   * 仍用窗口 owner 的项目目录（`IWindow*ProjectService`），不能把远端项目 channel
   * 当成窗口目录。桌面 `desktop-continuous` 仍以目标 Environment 为准。
   */
  sourceServices?: ServiceCollection;
}): ServiceCollection {
  assertLegacyRemoteWorkspaceRpcContract(params.connectionServices);
  const services = new ServiceCollection()
    .register(IFileService, params.connectionServices.fileService)
    .register(IGitService, params.connectionServices.gitService)
    .register(IGitCheckpointService, params.connectionServices.gitCheckpointService)
    .register(ISystemService, params.connectionServices.systemService)
    .register(ITerminalService, params.connectionServices.terminalService)
    .register(ISettingService, params.connectionServices.settingService)
    .register(ICredentialService, params.connectionServices.credentialService)
    .register(IBroadcastService, params.connectionServices.broadcastService)
    .register(IYCodeTaskService, params.connectionServices.ycodeTaskService)
    .register(IYCodeAgentService, params.connectionServices.ycodeAgentService)
    .register(IYCodeSessionService, params.connectionServices.ycodeSessionService)
    .register(IFileWatcherService, params.connectionServices.fileWatcherService)
    .register(IProviderSettingsService, params.connectionServices.providerSettingsService)
    .register(IModelSelectionService, params.connectionServices.modelSelectionService)
    .register(IUsageStatsService, params.connectionServices.usageStatsService)
    .register(IClientConfigService, params.clientConfigService)
    .register(IClientScenesService, params.connectionServices.clientScenesService)
    .register(ISkillsService, params.connectionServices.skillsService)
    .register(ISkillSyncService, params.connectionServices.skillSyncService)
    .register(IMcpSyncService, params.connectionServices.mcpSyncService)
    .register(IPluginSyncService, params.connectionServices.pluginSyncService)
    .register(IPluginsService, params.connectionServices.pluginsService)
    .register(IPluginManagementService, params.connectionServices.pluginManagementService)
    .register(ISubagentsService, params.connectionServices.subagentsService)
    .register(ICommandsService, params.connectionServices.commandsService)
    .register(IHooksService, params.connectionServices.hooksService)
    .register(IMemoryService, params.connectionServices.memoryService)
    .register(ISettingsSyncService, params.connectionServices.settingsSyncService)
    .register(IFeedbackService, params.connectionServices.feedbackService)
    .register(
      IPromptAttachmentTransferService,
      params.connectionServices.promptAttachmentTransferService,
    );
  if (params.connectionServices.mediaPreviewService) {
    services.register(IMediaPreviewService, params.connectionServices.mediaPreviewService);
  }
  if (params.connectionServices.onboardingRecordService) {
    services.register(IOnboardingRecordService, params.connectionServices.onboardingRecordService);
  }
  if (params.connectionServices.sourceServerWorkspaceService) {
    services.register(
      ISourceServerWorkspaceService,
      params.connectionServices.sourceServerWorkspaceService,
    );
  }
  // 项目 RPC 属于目标 Environment；旧 Server 未声明 virtualProjects 时注册代理会 unknown channel，
  // 因此只在握手能力显式支持时转发。
  if (params.virtualProjects) {
    if (!params.connectionServices.projectService) {
      throw new Error("Remote virtual-project RPC registration incomplete");
    }
    services.register(IProjectService, params.connectionServices.projectService);
    if (params.connectionServices.remoteProjectService) {
      services.register(IRemoteProjectService, params.connectionServices.remoteProjectService);
    }
  }
  // 手机 replayable 使用窗口 owner 的项目目录，而不是把 Source 内部 project channel 当窗口目录。
  // 旧 Host 未提供 sourceServices 时保持不发布，避免部分频道或回落到远端服务。
  if (params.sourceServices) {
    const windowProject = params.sourceServices.getOptional(IProjectService);
    const windowRemoteProject = params.sourceServices.getOptional(IRemoteProjectService);
    const windowBroadcast = params.sourceServices.getOptional(IBroadcastService);
    if (windowProject && windowRemoteProject && windowBroadcast) {
      services
        .register(IWindowProjectService, windowProject)
        .register(IWindowRemoteProjectService, windowRemoteProject)
        .register(IWindowProjectChangesService, createWindowProjectChangesService(windowBroadcast));
    }
  }
  return services;
}
