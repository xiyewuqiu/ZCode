import type {
  YCodeAgentMcpServer,
  YCodeAutomationScheduleRule,
  YCodeMcpListMode,
  ModelSelection,
} from "@ycode/shared";

export interface YCodeAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface YCodeAgentPluginViewParams extends YCodeAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface YCodeAgentListMcpServerStatusesParams extends YCodeAgentWorkspaceTarget {
  mcpServers?: YCodeAgentMcpServer[];
  mode?: YCodeMcpListMode;
}

export interface YCodeAgentAddPluginMarketplaceParams extends YCodeAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface YCodeAgentRemovePluginMarketplaceParams extends YCodeAgentWorkspaceTarget {
  marketplace: string;
}

export interface YCodeAgentUpdatePluginMarketplaceParams extends YCodeAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface YCodeAgentInstallPluginParams extends YCodeAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface YCodeAgentCancelPluginOperationParams {
  operationId: string;
}

export interface YCodeAgentUninstallPluginParams extends YCodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface YCodeAgentUpdatePluginParams extends YCodeAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface YCodeAgentRestoreBuiltinPluginParams extends YCodeAgentWorkspaceTarget {
  pluginId: string;
}

export interface YCodeAgentConfigurePluginParams extends YCodeAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface YCodeAgentResetPluginConfigParams extends YCodeAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface YCodeAgentValidatePluginParams extends YCodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface YCodeAgentDescribePluginParams extends YCodeAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface YCodeAgentSetPluginEnabledParams extends YCodeAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface YCodeAgentPluginReferenceCatalogParams extends YCodeAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface YCodeAgentSkillReferenceCatalogParams extends YCodeAgentWorkspaceTarget {
  sessionId?: string;
}
export interface YCodeAgentResolveSuggestedPluginReferenceParams extends YCodeAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface YCodeAgentCreateAutomationParams extends YCodeAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: YCodeAutomationScheduleRule;
}

export interface YCodeAgentUpdateAutomationParams extends YCodeAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: YCodeAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface YCodeAgentAutomationIdParams extends YCodeAgentWorkspaceTarget {
  automationId: string;
}

export interface YCodeAgentSetAutomationEnabledParams extends YCodeAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface YCodeAgentDeleteAutomationRunParams extends YCodeAgentWorkspaceTarget {
  runId: string;
}
