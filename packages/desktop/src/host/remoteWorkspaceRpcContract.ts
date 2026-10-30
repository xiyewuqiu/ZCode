import type { IServiceAccessor } from "@ycode/services";

export const REMOTE_WORKSPACE_RPC_CONTRACT_VERSION = 1 as const;

/**
 * 当前仓库实际装配到远端 workspace Host 的 channel。
 * 上游合同的 OAuth / CodingPlan / GenUI / Bots / OutputStyle 在本仓库未提供，
 * 不能为了“合同完整”注册空实现；缺失能力继续由对应 UI 回退。
 */
export const REMOTE_WORKSPACE_RPC_CHANNELS = [
  "fileService",
  "gitService",
  "gitCheckpointService",
  "systemService",
  "terminalService",
  "settingService",
  "onboardingRecordService",
  "credentialService",
  "broadcastService",
  "ycodeTaskService",
  "ycodeAgentService",
  "ycodeSessionService",
  "fileWatcherService",
  "providerSettingsService",
  "modelSelectionService",
  "mediaPreviewService",
  "usageStatsService",
  "clientScenesService",
  "skillsService",
  "skillSyncService",
  "mcpSyncService",
  "pluginSyncService",
  "pluginsService",
  "pluginManagementService",
  "subagentsService",
  "commandsService",
  "hooksService",
  "memoryService",
  "settingsSyncService",
  "promptAttachmentTransferService",
] as const satisfies readonly (keyof IServiceAccessor)[];

/**
 * 合同内的 channel 一律按“远端必须提供”收口：IServiceAccessor 上可选的 mediaPreviewService
 * 经 assertRemoteWorkspaceRpcContract 校验后也是必有的，类型上同步去掉可选性。
 */
export type RemoteWorkspaceRpcContract = {
  readonly [K in (typeof REMOTE_WORKSPACE_RPC_CHANNELS)[number]]: NonNullable<IServiceAccessor[K]>;
};

export function assertRemoteWorkspaceRpcContract(
  value: Partial<IServiceAccessor>,
): asserts value is Partial<IServiceAccessor> & RemoteWorkspaceRpcContract {
  const missing = REMOTE_WORKSPACE_RPC_CHANNELS.filter((channel) => {
    const service = value[channel];
    return (typeof service !== "object" || service === null) && typeof service !== "function";
  });
  if (missing.length > 0) {
    throw new Error(
      `Remote workspace RPC v${REMOTE_WORKSPACE_RPC_CONTRACT_VERSION} channel 不完整: ${missing.join(", ")}`,
    );
  }
}
