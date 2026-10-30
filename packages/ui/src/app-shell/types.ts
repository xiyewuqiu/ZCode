import type { RefObject } from "react";
import type {
  YCodeProvider,
  SessionCreateSource,
  YCodeTaskRuntimeStatus,
  YCodeTaskMeta,
  GitChangeSourceId,
  DesktopWindowChromeState,
  IPlatformService,
  RemoteTarget,
  RemoteWorkspaceSessionEntry,
  SourceServerUpdateTarget,
  UpdateStatePayload,
} from "@ycode/shared";
import type { IFeedbackService, IServiceAccessor } from "@ycode/services";
import type { BrowserNavigationRequest, RecentClosedSidePaneTab } from "@/hooks/useAppPanels.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import type {
  BrowserSidePaneMetadata,
  OpenScopedSubagentSideTabRequest,
  OpenBackgroundBashSideTabRequest,
  OpenSelectionSideChatRequest,
  OpenScopedPlanDetailSideTabRequest,
  OpenScopedWorkflowRunSideTabRequest,
  OpenScopedWorkflowActorSessionSideTabRequest,
  OpenScopedWorkflowArtifactSideTabRequest,
  OpenScopedWorkflowWorkspaceSideTabRequest,
  WorkspaceSidePaneState,
} from "@/lib/workspaceSidePane.js";
import type { TreemappingSidePaneTab } from "@/lib/workspaceSidePane.js";
import type { WorkspaceYCodeUIState } from "@/store/ycodeSessionStore.js";
import type { RemoteConnectionLogEntry } from "@/hooks/useRemoteConnectionLogs.js";
import type { Theme } from "@/useTheme.js";
import type {
  ChatSearchResultHighlightRequest,
  ChatViewSummaryPanelVariant,
  ConversationFindMatchState,
} from "@/v4/legacyChatViewTypes.js";
import type {
  ComposerMentionPrefill,
  GroupedDraftTaskPlacement,
} from "@/store/ycodeSessionStoreTypes.js";
import type { TaskFindDialogProps } from "@/quickpick/TaskFindDialog.js";
import type { AutomationsNavigationTab, OpenAutomationsMain } from "@/lib/taskNavigationHistory.js";

export interface WorkspaceShellYCodeState {
  activeTaskId: WorkspaceYCodeUIState["activeTaskId"];
  draftFocusVersion: WorkspaceYCodeUIState["draftFocusVersion"];
  modelSwitchPending: WorkspaceYCodeUIState["modelSwitchPending"];
  modelSwitchStage: WorkspaceYCodeUIState["modelSwitchStage"];
  selectedProvider: WorkspaceYCodeUIState["selectedProvider"];
  optimisticTaskListByTaskId: WorkspaceYCodeUIState["optimisticTaskListByTaskId"];
  workspaceInit: WorkspaceYCodeUIState["workspaceInit"];
  taskStatus: YCodeTaskRuntimeStatus;
  taskError: string | null;
}

export interface CreateTaskOptions {
  /** 异步预填只能提交到解析 Skill 时的同一新任务目标。 */
  expectedWorkspaceKey?: string;
  provider?: YCodeProvider;
  groupedDraftPlacement?: GroupedDraftTaskPlacement;
  createSource?: SessionCreateSource;
  /** 新草稿输入框预填文本；只写草稿，不自动发送。 */
  initialPrompt?: string;
  /** 与 initialPrompt canonical 前缀对应的结构化 mention；仅用于编辑器展示。 */
  initialPromptMention?: ComposerMentionPrefill;
  /** 新任务落在哪个 workspace；缺省取活动 workspace。 */
  targetWorkspace?: { workspacePath: string; workspaceIdentity?: string };
  /** 项目归属由草稿 owner 保存；cwd 只表达执行目录，不能替代项目身份。 */
  projectId?: string | null;
  /** grouped 视图从具体分组新建时继承组归属。 */
  taskGroupId?: string | null;
}

export type CreateTaskRequest = YCodeProvider | CreateTaskOptions;

export interface RemoteWorkspaceRecoveryStatus {
  mode: "automatic" | "manual";
  attempt?: number;
  limit?: number;
}

/** 仅用于 Renderer 连接反馈，不传入 Host 的恢复/遥测协议。 */
export interface RemoteConnectionFeedbackOptions {
  announceReusedConnection?: boolean;
}

export type DeviceAdditionResult =
  | { kind: "connected"; sourceServerId: string | undefined }
  | { kind: "cancelled"; background?: boolean };

/** 仅当前 renderer 内存中的原 owner 引用；不序列化草稿或凭据。 */
export interface DeviceAdditionReturnTarget {
  /** 已有设备连接留在原项目页；只有新增设备往返设置。 */
  kind: "connect-device" | "add-device";
  isCurrent(): boolean;
  /** 只投递连接层可见性；原 owner 决定自己的提交门禁。 */
  onVisibilityChange?(visible: boolean): void;
  /** 返回导航前由原 owner 校验异步成员资格；Root 随后重验原意图。 */
  canFinish?(result: DeviceAdditionResult): Promise<boolean>;
  finish(result: DeviceAdditionResult): void | Promise<void>;
}

export interface RemoteConnectionOpenPreference {
  returnTarget?: DeviceAdditionReturnTarget;
  /** 完成意图由发起入口确定；凭据、安装和重试不得替换它。 */
  completion?: "device-management";
  /** 原地重连交接的失败/等待事实；打开时只展示，不自动重发。 */
  initialFailure?: {
    code?: string;
    message: string;
    logs?: RemoteConnectionLogEntry[];
    profileId?: string;
    /** 交接前固定的非敏感失败身份，不从最新 Profile 重建。 */
    failedTarget?: SourceServerUpdateTarget;
    resolvedWslTarget?: Required<Extract<RemoteTarget, { kind: "wsl" }>>;
  };
  /** 已有项目的连接意图；安装、升级和凭据交互结束后仍打开该目录。 */
  preferredDirectoryPath?: string;
  preferredWorkspaceTabId?: string;
  /** 未加载 tab 的已保存项目；完成后恢复该入口，不进入新建项目选择。 */
  preferredProjectEntryId?: string;
  preferredTarget?: RemoteTarget;
  preferredKind?: RemoteTarget["kind"];
  preferredWslDistro?: string;
  preferredSourceServerId?: string;
  /** 用户从设备/连接记录点击“连接”时精确选择的 Profile；弹窗消费后直达第 4 步。 */
  preferredProfileId?: string;
}

export interface AppProps {
  services: IServiceAccessor;
  baseFeedbackService: IFeedbackService;
  onConnectRemote: (options: RemoteTarget, requestId?: string) => Promise<string>;
  onSelectRemoteProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
    preparedWorkspaceIdentity?: string,
    isCurrent?: () => boolean | Promise<boolean>,
  ) => Promise<void>;
  onCancelRemoteProject: (sessionId: string) => Promise<void>;
  onReconnectRemoteWorkspace: (workspaceKey: string) => Promise<void>;
  reconnectingRemoteWorkspaceKeys: string[];
  remoteWorkspaceRecoveryByWorkspaceKey?: Record<string, RemoteWorkspaceRecoveryStatus>;
  remoteWorkspaceErrorByWorkspaceKey: Record<string, string>;
  reconnectingRemoteWorkspaceLogsByWorkspaceKey?: Record<string, RemoteConnectionLogEntry[]>;
  remoteConnectionLogs?: RemoteConnectionLogEntry[];
  onCreateTask: (request?: CreateTaskRequest) => void;
  onCreateConversationTask?: () => void;
  onResolveConversationWorkspace?: () => Promise<string>;
  onOpenWorkspace: () => void;
  onOpenFolderFromWorkspaceMenu: () => void;
  onOpenRemoteWorkspace?: (preference?: RemoteConnectionOpenPreference) => void | boolean;
  onCreateScratchWorkspace: (name: string) => Promise<string | null>;
  remoteConnectionInProgress?: boolean;
  onReturnToWorkspace?: () => void;
  allowOpenWorkspace?: boolean;
  allowRemoteWorkspace?: boolean;
  remoteWorkspaceSessions?: RemoteWorkspaceSessionEntry[];
  workspaceAbsPath: string;
  workspaceRemoteSessionId?: string;
  workspaceIdentity?: string;
  isWorkspaceVisible?: boolean;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  supportsEmbeddedBrowser?: boolean;
}

export interface GitChangeSummary {
  added: number;
  removed: number;
}

export type WorkspaceMainView = "chat" | "automations" | "plugin-store";

export interface WorkspaceShellLayoutProps extends Omit<AppProps, "baseFeedbackService"> {
  workspaceReadOnlyReason?: string;
  workspaceMainView: WorkspaceMainView;
  pluginStoreOpenVersion: number;
  openAutomationId: string | null;
  openAutomationTab: AutomationsNavigationTab | null;
  onWorkspaceMainViewChange: (view: WorkspaceMainView) => void;
  onOpenAutomationConsumed: () => void;
  handleOpenAutomations: OpenAutomationsMain;
  handleOpenPluginStore: () => void;
  handleManageInstalledPlugins: () => void;
  workspaceShellYCodeState: WorkspaceShellYCodeState;
  theme: Theme;
  isMacFullscreen: boolean;
  desktopWindowChromeState: DesktopWindowChromeState | null;
  macWindowControlsLeftPaddingPx: number;
  windowsWindowControlsRightPaddingPx: number;
  updateReadyVersion: string | null;
  updateState: UpdateStatePayload | null;
  sidebarContainerRef: RefObject<HTMLElement | null>;
  toggleSidebarShortcutLabel: string;
  newTaskShortcutLabel: string;
  goBackShortcutLabel: string;
  goForwardShortcutLabel: string;
  toggleSidePaneShortcutLabel: string;
  toggleSidePaneFullViewShortcutLabel: string;
  /** Side Pane 完整视图 controller；唯一状态 owner 在 App（specs/conversation/side-pane-full-view.md）。 */
  sidePaneFullView: import("@/side-pane-full-view/contract.js").SidePaneFullViewController;
  canGoBack: boolean;
  canGoForward: boolean;
  canTaskNavBack: boolean;
  canTaskNavForward: boolean;
  isTerminalOpen: boolean;
  isSidebarVisible: boolean;
  isBrowserOpen: boolean;
  supportsEmbeddedBrowser: boolean;
  isGitOpen: boolean;
  isSidePaneOpen: boolean;
  summaryPanelVariantOverride: ChatViewSummaryPanelVariant | null;
  onSummaryPanelVariantOverrideChange: (variant: ChatViewSummaryPanelVariant | null) => void;
  sidePaneState: WorkspaceSidePaneState | null;
  recentClosedSidePaneTabs: RecentClosedSidePaneTab[];
  shellPanelIds: string[];
  projectName: string;
  workspaceTabs: Array<{
    workspacePath: string;
    label: string;
    remoteSessionId?: string;
    remoteTarget?: import("@ycode/shared").RemoteTarget;
    workspaceIdentity?: string;
    workspacePurpose?: import("@ycode/shared").WorkspacePurpose;
    localWorkspacePath?: string;
    availability?: import("@/store/tabStore.js").WorkspaceAvailability;
  }>;
  activeTaskId: string | null;
  /** 右侧栏按对话隔离的归属 id：草稿态 = draftSessionId，正式态 = activeTaskId（两者同值衔接）。 */
  sidePaneOwnerId: string | null;
  activeTraceId: string | null;
  activeSessionId: string | null;
  activeTaskProvider: YCodeProvider | null;
  resolvedActiveTaskMeta?: YCodeTaskMeta | null;
  activeTaskTitle: string;
  activeTaskChangeSummary: ReturnType<
    typeof import("@/lib/taskChangeSummary.js").getTaskChangeSummary
  >;
  gitWorktreeReviewSourceId: GitChangeSourceId | null;
  gitWorktreeChangeSummary: GitChangeSummary;
  activeGitSourceId: GitChangeSourceId;
  gitState: ReturnType<typeof import("@/hooks/useGitRepository.js").useGitRepository>;
  browserNavigationRequest: BrowserNavigationRequest | null;
  browserRestoreUrls: Record<string, string>;
  taskNativeSessionLogFile: ReturnType<
    typeof import("@/hooks/useTaskNativeSessionLogFile.js").useTaskNativeSessionLogFile
  >;
  taskSessionFile: ReturnType<
    typeof import("@/hooks/useTaskSessionFilePath.js").useTaskSessionFilePath
  >;
  testMessages: import("@/lib/taskChatMessageTypes.js").TaskChatMessage[] | null;
  conversationFindActiveIndex: number;
  conversationFindNavigationRequestId: number;
  conversationFindQuery: string;
  onConversationFindMatchStateChange: (state: ConversationFindMatchState) => void;
  searchResultHighlightRequest?: ChatSearchResultHighlightRequest | null;
  onSearchResultHighlightDone?: (requestId: number) => void;
  fileChangeFindActiveIndex: number;
  fileChangeFindNavigationRequestId: number;
  fileChangeFindQuery: string;
  onFileChangeFindMatchCountChange: (count: number) => void;
  appLogoUrl: string;
  platform: IPlatformService;
  reloadSessionDisabled: boolean;
  reloadSessionPending: boolean;
  handleReloadSession: (options?: {
    resumeTaskId?: string | null;
    provider?: YCodeProvider | null;
  }) => Promise<void>;
  handleSelectTask: (
    targetWorkspacePath: string,
    taskId: string,
    targetWorkspaceIdentity?: string,
    expectedUnreadAt?: number,
  ) => void;
  handleTaskNavBack: () => void;
  handleTaskNavForward: () => void;
  handleStartDraftInWorkspace: (
    targetWorkspacePath: string,
    targetWorkspaceIdentity?: string,
    targetWorkspacePurpose?: import("@ycode/shared").WorkspacePurpose,
    createSource?: SessionCreateSource,
  ) => void;
  handleOpenCommandCenter: () => void;
  handleRefreshGit: () => void;
  handleBrowserUrlChange: (tabId: string, url: string) => void;
  handleBrowserPageMetadataChange: (tabId: string, metadata: BrowserSidePaneMetadata) => void;
  handleToggleSidebar: () => void;
  handleToggleTerminal: () => void;
  handleToggleBrowser: () => void;
  handleOpenBrowserTab: () => void;
  handleOpenTreemapping: (source?: TreemappingSidePaneTab["source"]) => void;
  handleOpenWhiteboard: () => void;
  handleOpenDeveloperTools: () => void;
  handleOpenTerminalTab: () => void;
  handleToggleGit: () => void;
  handleOpenGitReview: (sourceId?: GitChangeSourceId) => void;
  handleToggleSidePane: () => void;
  handleOpenBrowserUrl: (url: string) => void;
  handleOpenCodeViewer: (source: CodeViewerSource) => void;
  handleAutoOpenAssistantPptx: (request: AssistantPreviewCardsAutoOpenRequest) => void;
  handleOpenBackgroundBash: (request: OpenBackgroundBashSideTabRequest) => void;
  handleOpenSubagentSession: (request: OpenScopedSubagentSideTabRequest) => void;
  handleOpenSubagentDirectory: (
    request: import("@/lib/workspaceSidePane.js").OpenScopedSubagentDirectorySideTabRequest,
  ) => void;
  handleSyncSubagentSessionTabs: (
    request: import("@/lib/workspaceSidePane.js").SyncSubagentSessionTabsRequest,
  ) => void;
  handleOpenSelectionSideChat: (request: OpenSelectionSideChatRequest) => void;
  handleOpenPlanDetail: (request: OpenScopedPlanDetailSideTabRequest) => void;
  handleOpenWorkflowRun: (request: OpenScopedWorkflowRunSideTabRequest) => void;
  handleOpenWorkflowRunDirectory: (
    request: import("@/lib/workspaceSidePane.js").OpenScopedWorkflowRunDirectorySideTabRequest,
  ) => void;
  handleOpenWorkflowActorSession: (request: OpenScopedWorkflowActorSessionSideTabRequest) => void;
  handleOpenWorkflowWorkspace: (request: OpenScopedWorkflowWorkspaceSideTabRequest) => void;
  handleOpenWorkflowArtifact: (request: OpenScopedWorkflowArtifactSideTabRequest) => void;
  handleCloseCodeViewer: () => void;
  handleCloseGit: () => void;
  handleActivateSidePaneTab: (tabId: string) => void;
  handleReorderSidePaneTab: (activeTabId: string, overTabId: string) => void;
  handleCloseSidePaneTab: (tabId: string) => void;
  handleCloseOtherSidePaneTabs: (tabId: string) => void;
  handleCloseAllSidePaneTabs: () => void;
  handleReopenClosedSidePaneTab: (tabId: string) => void;
  handleBrowserNavigationRequestHandled: (requestId: string) => void;
  setIsTerminalOpen: (open: boolean) => void;
  setGitSelectedSourceId: (value: GitChangeSourceId) => void;
  taskFindDialogProps: TaskFindDialogProps;
}
