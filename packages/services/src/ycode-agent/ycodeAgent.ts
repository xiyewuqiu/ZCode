import type {
  AppToolSearchMode,
  BackgroundBashOutputResult,
  SessionDebugSnapshot,
} from "@ycode/shared";
import type {
  SessionDatabaseOptimizeResult,
  SessionDatabaseStats,
  SessionStoragePreview,
  SessionPurgeResult,
} from "@ycode/shared";
/* eslint-disable max-lines -- YCode agent service 接口集中声明 protocol/session/workspace 方法，拆分会增加 service descriptor 迁移成本。 */
import type { Event, IDisposable } from "@ycode/rpc";
import type {
  McpUiAppToolCallNotification,
  McpUiHostRequestBody,
  McpUiHostResponse,
} from "@ycode/shared/mcp-apps";
import { ServiceChannels } from "@ycode/shared";
import type { AppUsageRange, AppUsageSnapshot, YCodeTaskTokenUsageResult } from "@ycode/shared";
import type { YCodeAutomation, YCodeAutomationRun } from "@ycode/shared";
import type {
  YCodeStorageStartupState,
  YCodeDeliveryKind,
  YCodeAgentMcpServer,
  YCodeBackgroundTurnAttribution,
  TraceId,
  YCodeSessionCompactResult,
  YCodeSessionGoalAction,
  YCodeSessionGoalResult,
  YCodeMessageWithParts,
  ModelSelection,
  YCodeSessionImportHistory,
  YCodePermissionRequestParams,
  AgentLaneResourceSample,
  YCodeMcpTelemetryEvent,
  YCodeMcpResourceSample,
  YCodeToolExecResource,
  YCodeProcessChildProcess,
  YCodeMcpListResult,
  YCodePluginsListResult,
  YCodePluginsOverviewResult,
  YCodePluginsMarketplaceMutationResult,
  YCodePluginsInstallResult,
  YCodePluginsReferenceCatalogResult,
  YCodeSkillsReferenceCatalogResult,
  YCodeWorkflowsDeleteResult,
  YCodeWorkflowsGetResult,
  YCodeWorkflowsListResult,
  YCodeWorkflowsMoveResult,
  YCodeWorkflowsRunsResult,
  YCodeWorkflowsUpdateMetaResult,
  YCodePluginsUninstallResult,
  YCodePluginsRestoreBuiltinResult,
  YCodePluginsConfigureResult,
  YCodePluginsDescribeResult,
  YCodePluginsValidateResult,
  YCodePluginsSetEnabledResult,
  YCodePluginsCancelOperationResult,
  YCodePluginOperationProgressNotification,
  YCodeProviderTestModelConnectivityParams,
  YCodeProviderTestModelConnectivityResult,
  YCodeUserInputRequestParams,
  YCodeUserInputResponse,
  YCodeSessionEvent,
  YCodeSessionInfo,
  YCodeSessionMode,
  YCodeSessionPersistence,
  YCodeSessionSendResult,
  YCodeSessionRequestRuntimePreferencesParams,
  YCodeSessionRuntimePreferencesResult,
  YCodeSessionStateSnapshot,
  YCodeSessionSubagentsResult,
  YCodeStateUpdatedNotification,
  YCodeTaskClientMode,
  YCodeBrowserAmbientContext,
  YCodeWorkspacePresentation,
  YCodeWorkspaceGenerateTextResult,
  YCodeWorkspaceGenerateTextParams,
  YCodeWorkspaceHookTrustGrantResult,
} from "@ycode/shared";
import type {
  ClientHello,
  CommandAck,
  CommandEnvelope,
  CommandKey,
  CommandsQueryResult,
  ConversationTopicWireCandidate,
  ConversationTelemetryFact,
  CuaPermissionObservation,
  ConversationRowTarget,
  HelloMessage,
  SessionsIndexTopicWireCandidate,
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentCommitResult,
  V4AttachmentPreviewSourceResult,
  V4AttachmentReadResult,
  V4ConversationAttachmentReadResult,
  V4ConversationAttachmentStatResult,
  V4ConnectionFlowState,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
  V4ConversationPlansResult,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunsResult,
  V4ConversationRowsRangeResult,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
  SessionsIndexReconcileResult,
  V4SessionsIndexSubscribeResult,
  V4WorkspaceConfigSubscribeResult,
  WorkspaceConfigTopicWireCandidate,
} from "@ycode/shared/ycode-protocol-v4";
import { createServiceDescriptor } from "../descriptors.js";

export * from "./ycodeAgentPluginParams.js";
export * from "./ycodeAgentWorkflowParams.js";
import type {
  YCodeAgentAddPluginMarketplaceParams,
  YCodeAgentAutomationIdParams,
  YCodeAgentCancelPluginOperationParams,
  YCodeAgentConfigurePluginParams,
  YCodeAgentResetPluginConfigParams,
  YCodeAgentCreateAutomationParams,
  YCodeAgentDeleteAutomationRunParams,
  YCodeAgentDescribePluginParams,
  YCodeAgentInstallPluginParams,
  YCodeAgentListMcpServerStatusesParams,
  YCodeAgentPluginViewParams,
  YCodeAgentPluginReferenceCatalogParams,
  YCodeAgentSkillReferenceCatalogParams,
  YCodeAgentResolveSuggestedPluginReferenceParams,
  YCodeAgentRemovePluginMarketplaceParams,
  YCodeAgentRestoreBuiltinPluginParams,
  YCodeAgentSetPluginEnabledParams,
  YCodeAgentSetAutomationEnabledParams,
  YCodeAgentUninstallPluginParams,
  YCodeAgentUpdatePluginMarketplaceParams,
  YCodeAgentUpdatePluginParams,
  YCodeAgentUpdateAutomationParams,
  YCodeAgentValidatePluginParams,
  YCodeAgentWorkspaceTarget,
} from "./ycodeAgentPluginParams.js";
import type {
  YCodeAgentDeleteSavedWorkflowParams,
  YCodeAgentGetSavedWorkflowParams,
  YCodeAgentListSavedWorkflowRunsParams,
  YCodeAgentListSavedWorkflowsParams,
  YCodeAgentMoveSavedWorkflowParams,
  YCodeAgentUpdateSavedWorkflowMetaParams,
} from "./ycodeAgentWorkflowParams.js";

export interface YCodeAgentSessionTarget extends YCodeAgentWorkspaceTarget {
  sessionId: string;
}

/**
 * MCP Apps 宿主 RPC：`request` 是 CLI 协议里的 `mcp/ui` 参数体，
 * `workspace` 由 services 按目标连接补齐，renderer 不自行拼 identity / remoteSessionId。
 */
export interface YCodeAgentMcpUiParams extends YCodeAgentSessionTarget {
  request: McpUiHostRequestBody;
}

export interface YCodeAgentResumeSessionParams extends YCodeAgentSessionTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: YCodeAgentMcpServer[];
  // 冷恢复会重建 runtime，工具面隔离必须和 create 保持同一安全边界（CUA 只放行 ycode-cua 工具、
  // 禁 Bash 等）。否则 resume 后模型可见工具面/执行权限会比创建时更宽。
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export interface YCodeAgentInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface YCodeAgentRunAutomationNowResult {
  status: "queued" | "duplicate";
}

export interface YCodeAgentWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export const YCODE_AGENT_RUNTIME_UNAVAILABLE_CODE = "YCODE_AGENT_RUNTIME_UNAVAILABLE";

export type YCodeAgentRuntimePolicy = "start-if-needed" | "existing-only";

export interface YCodeAgentRuntimeLifecycleEvent extends YCodeAgentWorkspaceTarget {
  workspaceKey: string;
  runtimeIdentity: YCodeAgentWorkspaceRuntimeIdentity;
  state: "available" | "unavailable";
}

export type YCodeAgentCuaPermissionObservation = CuaPermissionObservation &
  YCodeAgentWorkspaceTarget;

export interface YCodeAgentCreateSessionParams extends YCodeAgentWorkspaceTarget {
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: YCodeSessionMode;
  model?: ModelSelection;
  persistence?: YCodeSessionPersistence;
  thoughtLevel?: string;
  /** automation 执行会话关闭模型二次命名，保持首条用户 query 作为稳定标题。 */
  titleGenerationEnabled?: boolean;
  mcpServers?: YCodeAgentMcpServer[];
  toolAllowlist?: string[];
  toolDenylist?: string[];
  importedHistory?: YCodeSessionImportHistory;
}

export interface YCodeAgentListSessionsParams extends YCodeAgentWorkspaceTarget {
  sessionIds?: string[];
  runtimePolicy?: YCodeAgentRuntimePolicy;
  includeArchived?: boolean;
  limit?: number;
}

export interface YCodeAgentListSessionSubagentsParams extends YCodeAgentSessionTarget {
  endedCursor?: string;
  endedLimit?: number;
  /** 远程 workspace 的宿主连接身份；只用于选择现有 Host，不进入 CLI wire query。 */
  remoteSessionId?: string;
}

export interface YCodeAgentAppUsageParams {
  range: AppUsageRange;
  timeZone?: string;
}

export interface YCodeAgentTaskTokenUsageParams extends YCodeAgentSessionTarget {}

export interface YCodeAgentReadSessionParams extends YCodeAgentSessionTarget {
  deliveryKind?: YCodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
  /** 被动索引/观察者只能读取现有 runtime，禁止为了读快照拉起 session。 */
  runtimePolicy?: YCodeAgentRuntimePolicy;
}

export interface YCodeAgentReadSessionMessagesParams extends YCodeAgentSessionTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface YCodeAgentReadSessionEventsParams extends YCodeAgentSessionTarget {
  afterSeq?: number;
  limit?: number;
}

export type YCodeAgentReadWorkspacePresentationParams = YCodeAgentWorkspaceTarget;

export interface YCodeAgentGrantWorkspaceHookTrustParams extends YCodeAgentWorkspaceTarget {
  bundleDigest: string;
  hookDeclarationDigest: string;
}

export interface YCodeAgentSendPromptParamsBase extends YCodeAgentSessionTarget {
  modelSelection?: ModelSelection;
  modelExecution?: import("@ycode/shared/ycode-protocol-v4").CommandPayloadMap["sendText"]["modelExecution"];
  inputId?: string;
  queryId?: string;
  messageId?: string;
  sessionTraceId?: TraceId;
  content: string;
  attachments?: Record<string, unknown>[];
  /** provider-only 的当前 IAB 状态；UI/session persistence 仍使用 content 原文。 */
  browserAmbientContext?: YCodeBrowserAmbientContext;
  clientMode?: YCodeTaskClientMode;
  expectedRevision?: number;
  expectedProviderRevision?: string;
  runtimeProviderHeaders?: Record<string, string>;
  toolDenylist?: string[];
}

export type YCodeAgentSendPromptParams = YCodeAgentSendPromptParamsBase &
  YCodeBackgroundTurnAttribution;

export interface YCodeAgentCompactParams extends YCodeAgentSessionTarget {
  inputId?: string;
  instructions?: string;
  expectedRevision?: number;
}

export interface YCodeAgentGoalParams extends YCodeAgentSessionTarget {
  inputId?: string;
  action: YCodeSessionGoalAction;
  objective?: string;
  expectedRevision?: number;
}

export interface YCodeAgentSetModelParams extends YCodeAgentSessionTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface YCodeAgentSetThoughtLevelParams extends YCodeAgentSessionTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface YCodeAgentSetModeParams extends YCodeAgentSessionTarget {
  mode: YCodeSessionMode;
  expectedRevision?: number;
}

export interface YCodeAgentGenerateWorkspaceTextParams extends YCodeAgentWorkspaceTarget {
  selection: YCodeWorkspaceGenerateTextParams["selection"];
  prompt?: string;
  messages?: YCodeWorkspaceGenerateTextParams["messages"];
  tools?: YCodeWorkspaceGenerateTextParams["tools"];
  querySource: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /**
   * 协议层 RPC 超时。thinking 模型的长请求会超过协议 client 默认的
   * 3 分钟；调用方必须把自身 deadline 透传到这里，否则默认超时先触发、
   * 还会被 onRequestTimeout 误判 stale 杀进程。
   */
  requestTimeoutMs?: number;
}

export interface YCodeAgentTestModelConnectivityParams extends YCodeAgentWorkspaceTarget {
  selection: YCodeProviderTestModelConnectivityParams["selection"];
  signal?: AbortSignal;
}

export interface YCodeAgentSessionRuntimePreferencesRequest extends YCodeSessionRequestRuntimePreferencesParams {
  requestId: string;
}

export interface YCodeAgentRespondSessionRuntimePreferencesParams {
  requestId: string;
  resolution:
    | { status: "resolved"; preferences: YCodeSessionRuntimePreferencesResult }
    | { status: "failed"; message: string };
}

export interface YCodeAgentSessionSubscribeParams extends YCodeAgentSessionTarget {
  deliveryKind: YCodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

// ── v4 conversation 通道（竖切）──
// host 只做转发：subscribe/unsubscribe/command 透传给 CLI v4 gateway，
// v4/conversation/frame 通知按 workspace fan-out 给 renderer。

export interface YCodeAgentConversationSubscribeParams extends YCodeAgentSessionTarget {
  /** 水位不变量：仅当客户端真持有该时刻一致状态才允许带。 */
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
}

export interface YCodeAgentConversationUnsubscribeParams extends YCodeAgentWorkspaceTarget {
  subscriptionId: string;
  runtimePolicy?: YCodeAgentRuntimePolicy;
}

export interface YCodeAgentConversationResyncParams extends YCodeAgentWorkspaceTarget {
  subscriptionId: string;
  base: { logEpoch: string; seq: number } | null;
  forceSnapshot?: boolean;
  runtimePolicy?: YCodeAgentRuntimePolicy;
}

/** 行分页 query（rows/range）：按游标向上取一窗历史行。 */
export interface YCodeAgentConversationRowsRangeParams extends YCodeAgentSessionTarget {
  /** 取 rowId < beforeRowId 的行；缺省 = 从当前尾部向前。 */
  beforeRowId?: number;
  /** 1..rowsRangeMaxLimit（200）。 */
  limit: number;
}

/** 当前有效分支里的终态 ExitPlanMode 目录。 */
export type YCodeAgentConversationPlansParams = YCodeAgentSessionTarget;

/** workflow run 的事件日志分页（详情页审计面）；cursor = journal sequence。 */
export interface YCodeAgentConversationWorkflowRunEventsParams extends YCodeAgentSessionTarget {
  runId: string;
  afterSequence?: number;
  limit?: number;
}

/** dwf run 的枚举（重启后的发现查询）。 */
export interface YCodeAgentConversationWorkflowRunsParams extends YCodeAgentSessionTarget {
  limit?: number;
}

// ── dwf 用户面产物──
// ⚠ 术语：artifact = 脚本经 `artifact.*` 发布给**用户**看的产出（文件 / markdown / 预置看板），
// 不是 run 的顶层返回值（引擎内部对后者的同名叫法）。

/** 产物清单；UI 冷恢复与中枢详情的 durable 读法。 */
export interface YCodeAgentConversationWorkflowRunArtifactsParams extends YCodeAgentSessionTarget {
  runId: string;
}

/** 预置看板的取数面；cursor = journal sequence（严格大于）。 */
export interface YCodeAgentConversationWorkflowRunArtifactDataParams extends YCodeAgentSessionTarget {
  runId: string;
  artifactId: string;
  afterSequence?: number;
  limit?: number;
}

/** 内容产物的字节，一次一块（≤ 512 KiB，形状逐字照 attachmentRead）。 */
export interface YCodeAgentConversationWorkflowRunArtifactReadParams extends YCodeAgentSessionTarget {
  runId: string;
  artifactId: string;
  version: number;
  offset: number;
  limit: number;
}

// ── dwf 工作区 transcript──
/** 轻行清单：一个 run 的 files.* / git.* / world.run 行，不带正文。 */
export interface YCodeAgentConversationWorkflowRunWorkspaceParams extends YCodeAgentSessionTarget {
  runId: string;
}

/** 一个工作区节点的正文，按 maxBytes 保形有界化（缺省与上限在 CLI 网关侧）。 */
export interface YCodeAgentConversationWorkflowRunNodeResultParams extends YCodeAgentSessionTarget {
  runId: string;
  siteId: string;
  ordinal: number;
  maxBytes?: number;
}

export interface YCodeAgentBackgroundBashOutputParams extends YCodeAgentSessionTarget {
  workId: string;
}

export interface YCodeAgentConversationFileChangesParams extends YCodeAgentSessionTarget {
  target: ConversationRowTarget;
  baseRevision: number;
  baseLogEpoch: string;
}

export interface YCodeAgentConversationFileRewindPreviewParams extends YCodeAgentSessionTarget {
  target: ConversationRowTarget;
  baseRevision: number;
  baseLogEpoch: string;
}

export interface YCodeAgentConversationCommandParams extends YCodeAgentWorkspaceTarget {
  envelope: CommandEnvelope;
  /** 仅 host 内部用于 Browser Use runtime 边界，不进入 v4 wire envelope。 */
  clientMode?: YCodeTaskClientMode;
}

export interface YCodeAgentCommandsQueryParams extends YCodeAgentWorkspaceTarget {
  clock?: true;
  commands: CommandKey[];
}

/** UI 不携带 connectionId；connection scope 以 trusted carrier 注入 wire identity。 */
export interface YCodeAgentAttachmentBeginParams extends YCodeAgentSessionTarget {
  uploadId: string;
  fileName: string;
  mime: string;
  totalBytes: number;
  totalChunks: number;
  checksum: string;
}

export interface YCodeAgentAttachmentChunkParams extends YCodeAgentSessionTarget {
  uploadId: string;
  chunkIndex: number;
  dataBase64: string;
}

export interface YCodeAgentAttachmentTerminalParams extends YCodeAgentSessionTarget {
  uploadId: string;
}

export interface YCodeAgentAttachmentReadParams extends YCodeAgentSessionTarget {
  ref: string;
  target?: ConversationRowTarget;
  attachmentIndex?: number;
  offset: number;
  limit: number;
}

export interface YCodeAgentConversationAttachmentReadParams extends YCodeAgentSessionTarget {
  ref: string;
  target: ConversationRowTarget;
  attachmentIndex: number;
  offset: number;
  limit: number;
}

export interface YCodeAgentConversationAttachmentStatParams extends YCodeAgentSessionTarget {
  ref: string;
  target: ConversationRowTarget;
  attachmentIndex: number;
}

export interface YCodeAgentAttachmentPreviewSourceParams extends YCodeAgentSessionTarget {
  ref: string;
  target?: ConversationRowTarget;
  attachmentIndex?: number;
}

/** host scope 内部 transport 控制面；connectionId 只能经 trusted carrier 注入。 */
export interface YCodeAgentConnectionFlowParams extends YCodeAgentWorkspaceTarget {
  state: V4ConnectionFlowState;
}

/** sessions-index：workspace 级列表订阅（无 sessionId 维度）。 */
export interface YCodeAgentSessionsIndexSubscribeParams extends YCodeAgentWorkspaceTarget {
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
  /**
   * 订阅者作用域后缀：CLI 侧重订阅替换按 (connectionId, topic) 判定，
   * host 进程内多个独立消费者（renderer 侧栏 / task-index syncer）订阅同一 topic 时
   * 必须用不同 connectionId，否则互相替换对方的订阅代际。缺省共享 host 连接 id。
   */
  subscriberScope?: string;
  /**
   * task-list 等被动观察者必须使用 existing-only；runtime 不存在时返回稳定 unavailable，
   * 禁止为了建立列表订阅而启动 Agent。缺省保持显式会话入口的旧行为。
   */
  runtimePolicy?: YCodeAgentRuntimePolicy;
}

/** workspace-config：workspace 级配置目录订阅（config options + slash 目录）。 */
export interface YCodeAgentWorkspaceConfigSubscribeParams extends YCodeAgentWorkspaceTarget {
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
  subscriberScope?: string;
  runtimePolicy?: YCodeAgentRuntimePolicy;
}

export type YCodeAgentServiceEvent =
  | { type: "session.event"; event: YCodeSessionEvent }
  | { type: "state.updated"; notification: YCodeStateUpdatedNotification }
  | { type: "permission.request"; request: YCodePermissionRequestParams }
  | { type: "userInput.request"; request: YCodeUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: YCodeUserInputResponse;
    }
  | { type: "snapshot"; snapshot: YCodeSessionStateSnapshot };

export interface YCodeAgentAppRuntimePreferences {
  askUserQuestionAutoResolutionEnabled: boolean;
  modelIoFullRetentionEnabled?: boolean;
  /** 新建/恢复会话时读取；不热更新运行中的会话。 */
  toolSearchMode?: AppToolSearchMode;
}

export interface YCodeAgentLocalRuntimeChildProcesses {
  pid: number;
  provider: string;
  workspacePath: string;
  lane?: string;
  children: YCodeProcessChildProcess[];
}

export interface YCodeAgentStorageStartupSnapshot {
  generation: number;
  state: YCodeStorageStartupState | null;
}

export interface IYCodeAgentService {
  /** 控制面不需要账号或模型，且不发送普通协议请求。 */
  prepareStorage(params: YCodeAgentWorkspaceTarget): Promise<void>;
  getStorageStartupState(
    params: YCodeAgentWorkspaceTarget,
  ): Promise<YCodeAgentStorageStartupSnapshot | null>;
  onDynamicStorageStartupState(
    params: YCodeAgentWorkspaceTarget,
  ): Event<YCodeAgentStorageStartupSnapshot>;
  initialize(params: YCodeAgentWorkspaceTarget): Promise<YCodeAgentInitializeResult>;
  /**
   * 同步 App 全局运行时偏好到所有已活动 workspace；不得为此启动空闲 Agent。
   */
  syncAppRuntimePreferences(preferences: YCodeAgentAppRuntimePreferences): Promise<void>;
  getWorkspaceRuntimeIdentity(
    params: YCodeAgentWorkspaceTarget,
  ): Promise<YCodeAgentWorkspaceRuntimeIdentity>;
  createSession(params: YCodeAgentCreateSessionParams): Promise<YCodeSessionStateSnapshot>;
  resumeSession(params: YCodeAgentResumeSessionParams): Promise<YCodeSessionStateSnapshot>;
  listSessions(params: YCodeAgentListSessionsParams): Promise<YCodeSessionInfo[]>;
  listSessionSubagents(
    params: YCodeAgentListSessionSubagentsParams,
  ): Promise<YCodeSessionSubagentsResult>;
  getAppUsageStats(params: YCodeAgentAppUsageParams): Promise<AppUsageSnapshot>;
  getTaskTokenUsage(params: YCodeAgentTaskTokenUsageParams): Promise<YCodeTaskTokenUsageResult>;
  previewSessionStorage(params: YCodeAgentSessionTarget): Promise<SessionStoragePreview>;
  purgeSessionStorage(
    params: YCodeAgentSessionTarget & { expectedRevision: string; confirmPermanent: true },
  ): Promise<SessionPurgeResult>;
  /** 共享会话库统计（只读）；由目标 workspace 的 Agent 执行。 */
  getSessionDatabaseStats(params: YCodeAgentWorkspaceTarget): Promise<SessionDatabaseStats>;
  /** 显式整理；有运行中会话或被其它进程锁住时返回 refused，不杀会话。 */
  optimizeSessionDatabase(
    params: YCodeAgentWorkspaceTarget & { confirm: true },
  ): Promise<SessionDatabaseOptimizeResult>;
  readSession(params: YCodeAgentReadSessionParams): Promise<YCodeSessionStateSnapshot>;
  readSessionMessages(
    params: YCodeAgentReadSessionMessagesParams,
  ): Promise<YCodeMessageWithParts[]>;
  readSessionDebug(params: YCodeAgentSessionTarget): Promise<SessionDebugSnapshot>;
  readSessionEvents(params: YCodeAgentReadSessionEventsParams): Promise<YCodeSessionEvent[]>;
  readWorkspacePresentation(
    params: YCodeAgentReadWorkspacePresentationParams,
  ): Promise<YCodeWorkspacePresentation>;
  /** 无 task/session 的 Settings 预信任；Agent 会重新发现并校验 canonical snapshot。 */
  grantWorkspaceHookTrust(
    params: YCodeAgentGrantWorkspaceHookTrustParams,
  ): Promise<YCodeWorkspaceHookTrustGrantResult>;
  listMcpServerStatuses(params: YCodeAgentListMcpServerStatusesParams): Promise<YCodeMcpListResult>;
  /**
   * MCP Apps 宿主 RPC（`mcp/ui`）：prepare 只拿登记载荷 + 实例凭证；调用 / 资源 / app-tools
   * 全部回同一个 session，按 workspace identity + sessionId 路由。沙箱登记在 renderer 平台端口。
   */
  mcpUi(params: YCodeAgentMcpUiParams): Promise<McpUiHostResponse>;
  listPlugins(params: YCodeAgentPluginViewParams): Promise<YCodePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：session-scoped 只读投影。
   * 走 workspace 级 agent client（session 记录只存在于该进程），不走独立插件管理进程。
   */
  getPluginReferenceCatalog(
    params: YCodeAgentPluginReferenceCatalogParams,
  ): Promise<YCodePluginsReferenceCatalogResult>;
  /** Composer Skill 引用 catalog；带 sessionId 时读取该 runtime 的冻结快照。 */
  getSkillReferenceCatalog(
    params: YCodeAgentSkillReferenceCatalogParams,
  ): Promise<YCodeSkillsReferenceCatalogResult>;
  // 已保存工作流的 GUI 中枢：workspace 级、无会话，每次调用现扫 `<cwd>/.ycode/workflows/`。
  // 全局档传 `scope: "global"`：带 workspace 就用它当载体，不带则由 services 层自选本机载体运行时。
  listSavedWorkflows(params: YCodeAgentListSavedWorkflowsParams): Promise<YCodeWorkflowsListResult>;
  getSavedWorkflow(params: YCodeAgentGetSavedWorkflowParams): Promise<YCodeWorkflowsGetResult>;
  updateSavedWorkflowMeta(
    params: YCodeAgentUpdateSavedWorkflowMetaParams,
  ): Promise<YCodeWorkflowsUpdateMetaResult>;
  deleteSavedWorkflow(
    params: YCodeAgentDeleteSavedWorkflowParams,
  ): Promise<YCodeWorkflowsDeleteResult>;
  listSavedWorkflowRuns(
    params: YCodeAgentListSavedWorkflowRunsParams,
  ): Promise<YCodeWorkflowsRunsResult>;
  // 在项目档 / 全局档之间移动同名文件：
  // `workspace` 是载体（移到项目传目标项目、移到全局传源项目），`to` 是落点档；不覆盖已存在的目标。
  moveSavedWorkflow(params: YCodeAgentMoveSavedWorkflowParams): Promise<YCodeWorkflowsMoveResult>;
  resolveSuggestedPluginReference(
    params: YCodeAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@ycode/shared").YCodePluginsResolveSuggestedReferenceResult>;
  /** 推荐项 Plugin 首次本地检查缺失后的 operation-scoped 刷新进度。 */
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<YCodePluginOperationProgressNotification>;
  getPluginsOverview(params: YCodeAgentPluginViewParams): Promise<YCodePluginsOverviewResult>;
  /**
   * 资源管理器：枚举本 Host 内全部本地 Agent 进程（含 plugin / mcp-status 泳道），
   * 并向每个存活 runtime 请求 `process/childProcesses`；单个 runtime 失败只让它的 children 为空。
   */
  collectLocalRuntimeChildProcesses(
    signal?: AbortSignal,
  ): Promise<YCodeAgentLocalRuntimeChildProcesses[]>;
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
  // ---- 定时任务(automation)管理 ----
  listAutomations(params: YCodeAgentWorkspaceTarget): Promise<YCodeAutomation[]>;
  listAllAutomations(): Promise<YCodeAutomation[]>;
  createAutomation(params: YCodeAgentCreateAutomationParams): Promise<YCodeAutomation>;
  updateAutomation(params: YCodeAgentUpdateAutomationParams): Promise<YCodeAutomation | null>;
  deleteAutomation(params: YCodeAgentAutomationIdParams): Promise<void>;
  setAutomationEnabled(params: YCodeAgentSetAutomationEnabledParams): Promise<void>;
  restartAutomation(params: YCodeAgentAutomationIdParams): Promise<void>;
  runAutomationNow(params: YCodeAgentAutomationIdParams): Promise<YCodeAgentRunAutomationNowResult>;
  listAutomationRuns(params: YCodeAgentAutomationIdParams): Promise<YCodeAutomationRun[]>;
  deleteAutomationRun(params: YCodeAgentDeleteAutomationRunParams): Promise<void>;
  generateWorkspaceText(
    params: YCodeAgentGenerateWorkspaceTextParams,
  ): Promise<YCodeWorkspaceGenerateTextResult>;
  testModelConnectivity(
    params: YCodeAgentTestModelConnectivityParams,
  ): Promise<YCodeProviderTestModelConnectivityResult>;
  /**
   * @deprecated：send 主路径已收敛 v4 sendText 命令。仅剩两个消费点——
   * adapter 带附件输入回退（待附件命令面落地后移除）与 ycodeSessionService
   * pass-through；新代码禁止回用。
   */
  sendPrompt(params: YCodeAgentSendPromptParams): Promise<YCodeSessionSendResult>;
  compactSession(params: YCodeAgentCompactParams): Promise<YCodeSessionCompactResult>;
  goalSession(params: YCodeAgentGoalParams): Promise<YCodeSessionGoalResult>;
  closeSession(
    params: YCodeAgentSessionTarget & { expectedPersistence?: "deferred" | "immediate" },
  ): Promise<boolean>;
  setModel(params: YCodeAgentSetModelParams): Promise<YCodeSessionStateSnapshot>;
  setThoughtLevel(params: YCodeAgentSetThoughtLevelParams): Promise<YCodeSessionStateSnapshot>;
  setMode(params: YCodeAgentSetModeParams): Promise<YCodeSessionStateSnapshot>;
  respondSessionRuntimePreferences(
    params: YCodeAgentRespondSessionRuntimePreferencesParams,
  ): Promise<void>;
  onDynamicSessionRuntimePreferencesRequest(): Event<YCodeAgentSessionRuntimePreferencesRequest>;
  /**
   * CLI 进程级资源样本，带 services 打的 lane 标签（CLI 自己不知道 lane）。
   * 使用 dynamic event 避免 RPC 服务在无人订阅时缓冲周期事件；
   * 该事件不属于 session/conversation continuous 或 replayable 状态。
   */
  onDynamicProcessResourceSample(): Event<AgentLaneResourceSample>;
  /** MCP 进程生命周期与低频内存事件，仅供可信 Host relay 上报 ARMS。 */
  onDynamicMcpTelemetry(): Event<YCodeMcpTelemetryEvent>;
  /** MCP 进程树资源事实，只供可信 Host 汇总上报。 */
  onDynamicMcpResourceSamples(): Event<YCodeMcpResourceSample[]>;
  /**
   * MCP Apps 的 app-tool 投递：CLI 把模型侧调用下发给 renderer，唯一页面实例 claim 后执行。
   * 消费者按 (sessionId, scopeId, instance.token) 过滤；与 MCP 资源样本一样是进程级通知。
   */
  onDynamicMcpUiAppToolCall(): Event<McpUiAppToolCallNotification>;
  /** Bash 完成事实，仅可信 Host 资源旁路订阅。 */
  onDynamicToolExecResource(): Event<YCodeToolExecResource>;
  /**
   * @deprecated 旧协议订阅面（session/subscribe + session/event + state.updated）。
   * task-index syncer 已迁 v4 sessions-index/workspace-config 帧；
   * 仅剩 ycodeTaskServiceAdapter.onDynamicTaskEvent（replayable 读路径）消费。
   * 写路径已收敛 v4 命令面；本订阅是读路径投影源。
   */
  onDynamicSessionEvent(params: YCodeAgentSessionSubscribeParams): Event<YCodeAgentServiceEvent>;
  // ── v4 conversation 通道（竖切）──
  /** RPC attachment 建立后先读取 host 可信 hello。 */
  helloConversationV4(): Promise<HelloMessage>;
  /** hello 校验后回送 clientHello；metadata 不能覆盖 connection mode/profile。 */
  initializeConversationV4(clientHello: ClientHello): Promise<void>;
  /** 仅供 trusted host relay/facade；terminal RPC caller 必须被 connection scope 拒绝。 */
  setConnectionFlowStateV4(params: YCodeAgentConnectionFlowParams): Promise<void>;
  subscribeConversationV4(
    params: YCodeAgentConversationSubscribeParams,
  ): Promise<V4ConversationSubscribeResult>;
  resyncConversationV4(
    params: YCodeAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeConversationV4(params: YCodeAgentConversationUnsubscribeParams): Promise<void>;
  /** rows/range 行分页 query（loadOlder 游标向上补历史）。 */
  conversationRowsRangeV4(
    params: YCodeAgentConversationRowsRangeParams,
  ): Promise<V4ConversationRowsRangeResult>;
  conversationPlansV4(
    params: YCodeAgentConversationPlansParams,
  ): Promise<V4ConversationPlansResult>;
  /** workflow run 事件日志分页；与 plans 同族（只读、无状态、超时重发安全）。 */
  conversationWorkflowRunEventsV4(
    params: YCodeAgentConversationWorkflowRunEventsParams,
  ): Promise<V4ConversationWorkflowRunEventsResult>;
  /** workflow run 枚举；journal-backed 的重启后发现面。 */
  conversationWorkflowRunsV4(
    params: YCodeAgentConversationWorkflowRunsParams,
  ): Promise<V4ConversationWorkflowRunsResult>;
  /** workflow run 的用户面产物清单；与 plans 同族（只读、无状态、超时重发安全）。 */
  conversationWorkflowRunArtifactsV4(
    params: YCodeAgentConversationWorkflowRunArtifactsParams,
  ): Promise<V4ConversationWorkflowRunArtifactsResult>;
  /** 预置看板的条目分页；hook 以 itemCount 变化为信号增量拉取。 */
  conversationWorkflowRunArtifactDataV4(
    params: YCodeAgentConversationWorkflowRunArtifactDataParams,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult>;
  /** 内容产物的字节，一次一块；授权在 CLI 侧（journal 行才是取字节的依据）。 */
  conversationWorkflowRunArtifactReadV4(
    params: YCodeAgentConversationWorkflowRunArtifactReadParams,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult>;
  /** dwf 工作区 transcript 的清单。 */
  conversationWorkflowRunWorkspaceV4(
    params: YCodeAgentConversationWorkflowRunWorkspaceParams,
  ): Promise<V4ConversationWorkflowRunWorkspaceResult>;
  /** 一个工作区节点的有界正文。 */
  conversationWorkflowRunNodeResultV4(
    params: YCodeAgentConversationWorkflowRunNodeResultParams,
  ): Promise<V4ConversationWorkflowRunNodeResultResult>;
  backgroundBashOutputV4(
    params: YCodeAgentBackgroundBashOutputParams,
  ): Promise<BackgroundBashOutputResult>;
  conversationFileChangesV4(
    params: YCodeAgentConversationFileChangesParams,
  ): Promise<V4ConversationFileChangesResult>;
  conversationFileRewindPreviewV4(
    params: YCodeAgentConversationFileRewindPreviewParams,
  ): Promise<V4ConversationFileRewindPreviewResult>;
  sendConversationCommandV4(params: YCodeAgentConversationCommandParams): Promise<CommandAck>;
  queryConversationCommandsV4(params: YCodeAgentCommandsQueryParams): Promise<CommandsQueryResult>;
  attachmentBeginV4(params: YCodeAgentAttachmentBeginParams): Promise<V4AttachmentBeginResult>;
  attachmentChunkV4(params: YCodeAgentAttachmentChunkParams): Promise<V4AttachmentChunkResult>;
  attachmentCommitV4(params: YCodeAgentAttachmentTerminalParams): Promise<V4AttachmentCommitResult>;
  attachmentAbortV4(params: YCodeAgentAttachmentTerminalParams): Promise<void>;
  /** Desktop local 已发送视频 source query；远端与 Web 返回 chunked。 */
  attachmentPreviewSourceV4(
    params: YCodeAgentAttachmentPreviewSourceParams,
  ): Promise<V4AttachmentPreviewSourceResult>;
  /** 已发送 image/video 只读分块查询；connection scope 注入可信 workspace 连接。 */
  attachmentReadV4(params: YCodeAgentAttachmentReadParams): Promise<V4AttachmentReadResult>;
  /** Share 读取 userInput 附件，允许 text/plain 等非媒体类型。 */
  conversationAttachmentReadV4(
    params: YCodeAgentConversationAttachmentReadParams,
  ): Promise<V4ConversationAttachmentReadResult>;
  /** Share 选择阶段只读 userInput 附件元数据，不读取完整内容。 */
  conversationAttachmentStatV4(
    params: YCodeAgentConversationAttachmentStatParams,
  ): Promise<V4ConversationAttachmentStatResult>;
  /** workspace 级下行帧流（v4/conversation/frame），renderer 侧按 topic 自行路由。 */
  onDynamicConversationFrame(
    params: YCodeAgentWorkspaceTarget,
  ): Event<ConversationTopicWireCandidate>;
  onDynamicConversationTelemetryFact(
    params: YCodeAgentWorkspaceTarget,
  ): Event<ConversationTelemetryFact>;
  /** 当前窗口全部本地 live task 的 CUA 权限观察；历史、远程与 replayable 不在此事件面。 */
  onDynamicCuaPermissionObservation(): Event<YCodeAgentCuaPermissionObservation>;
  // ── sessions-index 通道（列表活性）──
  /** 只读 CLI 持久事实；不恢复会话运行实例。旧远端可以不提供此能力。 */
  reconcileSessionsIndexV4?(
    params: YCodeAgentWorkspaceTarget & { sessionIds: string[] },
  ): Promise<SessionsIndexReconcileResult>;
  subscribeSessionsIndexV4(
    params: YCodeAgentSessionsIndexSubscribeParams,
  ): Promise<V4SessionsIndexSubscribeResult>;
  resyncSessionsIndexV4(
    params: YCodeAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeSessionsIndexV4(params: YCodeAgentConversationUnsubscribeParams): Promise<void>;
  /** workspace 级 sessions-index 下行帧流（与 conversation 同一通知，按 topic 前缀分流）。 */
  onDynamicSessionsIndexFrame(
    params: YCodeAgentWorkspaceTarget,
  ): Event<SessionsIndexTopicWireCandidate>;
  // ── workspace-config 通道（配置目录活性；task-index syncer 消费）──
  subscribeWorkspaceConfigV4(
    params: YCodeAgentWorkspaceConfigSubscribeParams,
  ): Promise<V4WorkspaceConfigSubscribeResult>;
  resyncWorkspaceConfigV4(
    params: YCodeAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeWorkspaceConfigV4(params: YCodeAgentConversationUnsubscribeParams): Promise<void>;
  /** workspace 级 workspace-config 下行帧流（与 conversation 同一通知，按 topic 前缀分流）。 */
  onDynamicWorkspaceConfigFrame(
    params: YCodeAgentWorkspaceTarget,
  ): Event<WorkspaceConfigTopicWireCandidate>;
  /**
   * （CLI 重连重订）：agent 进程换代通知（超时回收/崩溃后重新拉起）。
   * v4 订阅活在 CLI 进程内存，进程换代即失效；订阅方（task-index syncer 等）
   * 收到后必须对该 workspaceKey 重发 subscribe，否则帧流静默中断。
   */
  onAgentRuntimeRestarted(listener: (event: { workspaceKey: string }) => void): IDisposable;
  /**
   * Agent client 在 service 内完成登记后发布 available，当前 client 关闭后发布 unavailable。
   * 这是被动 observer attach/detach 的唯一生命周期信号，不表达用户使用租约。
   */
  onAgentRuntimeLifecycle?: (
    listener: (event: YCodeAgentRuntimeLifecycleEvent) => void,
  ) => IDisposable;
  /** 当前 desktop-local CUA turn 是否仍在执行，用于 Helper recovery 避免中途回收 Agent。 */
  hasActiveCuaOperationTurn(): boolean;
  disposeWorkspace(params: YCodeAgentWorkspaceTarget): Promise<void>;
  disposeAll(): void;
}

export const IYCodeAgentService = createServiceDescriptor<IYCodeAgentService>(
  ServiceChannels.YCodeAgent,
);
