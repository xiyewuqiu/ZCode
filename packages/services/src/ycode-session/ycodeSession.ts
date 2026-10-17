import { ServiceChannels } from "@ycode/shared";
import type {
  TraceId,
  YCodeAgentMcpServer,
  YCodeDeliveryKind,
  YCodeMessageWithParts,
  ModelSelection,
  YCodePermissionRequestParams,
  YCodeUserInputRequestParams,
  YCodeUserInputResponse,
  YCodeSessionInfo,
  YCodeSessionImportHistory,
  YCodeSessionEvent,
  YCodeSessionMode,
  YCodeSessionPersistence,
  YCodeSessionStateSnapshot,
  YCodeStateUpdatedNotification,
  YCodeWorkspacePresentation,
} from "@ycode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface YCodeSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type YCodeSessionReadWorkspacePresentationParams = YCodeSessionWorkspaceTarget;

export interface YCodeTaskTarget extends YCodeSessionWorkspaceTarget {
  sessionId: string;
}

export interface YCodeSessionCreateParams extends YCodeSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: YCodeSessionMode;
  model?: ModelSelection;
  persistence?: YCodeSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: YCodeAgentMcpServer[];
  importedHistory?: YCodeSessionImportHistory;
}

export interface YCodeSessionResumeParams extends YCodeTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: YCodeAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface YCodeSessionListParams extends YCodeSessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface YCodeSessionReadParams extends YCodeTaskTarget {
  deliveryKind?: YCodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface YCodeSessionMessagesParams extends YCodeTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface YCodeSessionEventsParams extends YCodeTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface YCodeSessionSetModelParams extends YCodeTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface YCodeSessionSetThoughtLevelParams extends YCodeTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface YCodeSessionSetModeParams extends YCodeTaskTarget {
  mode: YCodeSessionMode;
  expectedRevision?: number;
}

export interface YCodeSessionSubscribeParams extends YCodeTaskTarget {
  deliveryKind: YCodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type YCodeSessionServiceEvent =
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

export interface YCodeSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface YCodeSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IYCodeSessionService {
  initializeWorkspace(params: YCodeSessionWorkspaceTarget): Promise<YCodeSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: YCodeSessionWorkspaceTarget,
  ): Promise<YCodeSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: YCodeSessionReadWorkspacePresentationParams,
  ): Promise<YCodeWorkspacePresentation>;
  createSession(params: YCodeSessionCreateParams): Promise<YCodeSessionStateSnapshot>;
  resumeSession(params: YCodeSessionResumeParams): Promise<YCodeSessionStateSnapshot>;
  listSessions(params: YCodeSessionListParams): Promise<YCodeSessionInfo[]>;
  readSession(params: YCodeSessionReadParams): Promise<YCodeSessionStateSnapshot>;
  readSessionMessages(params: YCodeSessionMessagesParams): Promise<YCodeMessageWithParts[]>;
  readSessionEvents(params: YCodeSessionEventsParams): Promise<YCodeSessionEvent[]>;
  promoteDeferredDraftSession(params: YCodeTaskTarget): Promise<void>;
  closeSession(params: YCodeTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: YCodeTaskTarget): Promise<boolean>;
  setModel(params: YCodeSessionSetModelParams): Promise<YCodeSessionStateSnapshot>;
  setThoughtLevel(params: YCodeSessionSetThoughtLevelParams): Promise<YCodeSessionStateSnapshot>;
  setMode(params: YCodeSessionSetModeParams): Promise<YCodeSessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IYCodeSessionService = createServiceDescriptor<IYCodeSessionService>(
  ServiceChannels.YCodeSession,
);
