// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IYCodeAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 ycode-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@ycode/rpc";
import type {
  YCodePluginOperationProgressNotification,
  YCodePluginsConfigureResult,
  YCodePluginsCancelOperationResult,
  YCodePluginsDescribeResult,
  YCodePluginsInstallResult,
  YCodePluginsListResult,
  YCodePluginsMarketplaceMutationResult,
  YCodePluginsOverviewResult,
  YCodePluginsReferenceCatalogResult,
  YCodePluginsRestoreBuiltinResult,
  YCodePluginsSetEnabledResult,
  YCodePluginsUninstallResult,
  YCodePluginsValidateResult,
} from "@ycode/shared";
import { ServiceChannels } from "@ycode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  YCodeAgentAddPluginMarketplaceParams,
  YCodeAgentConfigurePluginParams,
  YCodeAgentCancelPluginOperationParams,
  YCodeAgentDescribePluginParams,
  YCodeAgentInstallPluginParams,
  YCodeAgentPluginReferenceCatalogParams,
  YCodeAgentResolveSuggestedPluginReferenceParams,
  YCodeAgentResetPluginConfigParams,
  YCodeAgentPluginViewParams,
  YCodeAgentRemovePluginMarketplaceParams,
  YCodeAgentRestoreBuiltinPluginParams,
  YCodeAgentSetPluginEnabledParams,
  YCodeAgentUninstallPluginParams,
  YCodeAgentUpdatePluginMarketplaceParams,
  YCodeAgentUpdatePluginParams,
  YCodeAgentValidatePluginParams,
} from "../ycode-agent/ycodeAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: YCodeAgentPluginViewParams): Promise<YCodePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: YCodeAgentPluginReferenceCatalogParams,
  ): Promise<YCodePluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: YCodeAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@ycode/shared").YCodePluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<YCodePluginOperationProgressNotification>;
  getPluginsOverview(params: YCodeAgentPluginViewParams): Promise<YCodePluginsOverviewResult>;
  addPluginMarketplace(
    params: YCodeAgentAddPluginMarketplaceParams,
  ): Promise<YCodePluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: YCodeAgentRemovePluginMarketplaceParams,
  ): Promise<YCodePluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: YCodeAgentUpdatePluginMarketplaceParams,
  ): Promise<YCodePluginsMarketplaceMutationResult>;
  installPlugin(params: YCodeAgentInstallPluginParams): Promise<YCodePluginsInstallResult>;
  cancelPluginOperation(
    params: YCodeAgentCancelPluginOperationParams,
  ): Promise<YCodePluginsCancelOperationResult>;
  uninstallPlugin(params: YCodeAgentUninstallPluginParams): Promise<YCodePluginsUninstallResult>;
  updatePlugin(params: YCodeAgentUpdatePluginParams): Promise<YCodePluginsInstallResult>;
  restoreBuiltinPlugin(
    params: YCodeAgentRestoreBuiltinPluginParams,
  ): Promise<YCodePluginsRestoreBuiltinResult>;
  configurePlugin(params: YCodeAgentConfigurePluginParams): Promise<YCodePluginsConfigureResult>;
  resetPluginConfig(
    params: YCodeAgentResetPluginConfigParams,
  ): Promise<YCodePluginsConfigureResult>;
  validatePlugin(params: YCodeAgentValidatePluginParams): Promise<YCodePluginsValidateResult>;
  describePlugin(params: YCodeAgentDescribePluginParams): Promise<YCodePluginsDescribeResult>;
  setPluginEnabled(params: YCodeAgentSetPluginEnabledParams): Promise<YCodePluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
