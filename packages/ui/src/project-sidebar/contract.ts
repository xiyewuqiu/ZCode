import type { Locale, RemoteTarget, UserInfo } from "@ycode/shared";
import type { YCodeTaskGroupColor } from "@ycode/services";
import type { LucideIcon } from "lucide-react";
import type {
  AppProps,
  CreateTaskRequest,
  RemoteWorkspaceRecoveryStatus,
} from "@/app-shell/types.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { Theme } from "@/useTheme.js";
export { LEGACY_SINGLE_ROOT_PROJECT_PREFIX } from "@ycode/services";

/**
 * 当前 Host 只有 IYCodeTaskService 暴露分组 RPC；这里用项目侧栏自己的只读/命令视图
 * 适配那份端口，不新增服务端写入路径。
 */
export type TaskGroupColor = YCodeTaskGroupColor;
export interface TaskGroup {
  id: string;
  title: string;
  color: TaskGroupColor;
  createdAt: number;
  updatedAt: number;
}
export interface GroupTaskRef {
  hostId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}
export type GroupNode = { type: "group"; groupId: string } | { type: "task"; task: GroupTaskRef };
export interface TaskGroupStructure {
  groups: TaskGroup[];
  members: Array<{ groupId: string; workspaceKey: string; taskId: string; sortOrder: number }>;
  order: Array<{ type: "group" | "task"; key: string; sortOrder: number }>;
}
export interface MoveGroupNode {
  node: GroupNode;
  sourceGroupId: string | null;
  groupId: string | null;
  anchor?: { node: GroupNode; side: "before" | "after" };
}
/** Controller 的实时完成提醒；旧 Host 只提供 workspace 事件时由钩子补齐。 */
export interface WindowHostTaskUnreadSignal {
  address: import("@ycode/shared/ycode-protocol-v4").WindowHostTaskAddress;
  updatedAt: number;
  status: "completed" | "error";
}
export interface ProjectDevice {
  id: string;
  label: string;
  status: string;
  sourceServerId?: string;
}

export interface ProjectRowAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  run(): void;
  disabled?: boolean;
  destructive?: boolean;
}
export {
  buildRemoteHostWorkspaceIdentity,
  parseRemoteWorkspaceIdentity,
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@ycode/shared";
export type {
  WindowHostTaskAddress,
  WindowHostControllerTaskActivity,
} from "@ycode/shared/ycode-protocol-v4";
export type {
  ProjectTree,
  ProjectTask,
  ProjectTaskRef,
  VirtualProject,
  SaveProjectInput,
  IProjectService,
  IWindowControllerService,
  IYCodeTaskService,
  WindowHostControllerMutation,
  WindowHostControllerFrame,
  IRemoteProjectService,
  RemoteProjectDirectory,
  RemoteProjectEntry,
  RemoteProjectHost,
} from "@ycode/services";
export interface ProjectAvailability {
  entryId?: string;
  /** 仅首次升级入口用于替换旧排序键，不改变项目身份。 */
  upgradeEntryId?: string;
  online: boolean;
  unresolved?: boolean;
}
export type { Locale, Theme };
export type ProjectSidebarView = "projects" | "grouped" | "timeline";
export interface SidebarFileTreeTarget {
  workspacePath: string;
  workspaceName: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  revealPath?: string;
  temporaryExternalDirectory?: boolean;
}
export interface SidebarFileTreeOpenRequest {
  id: number;
  target: SidebarFileTreeTarget;
}
/** 项目行/菜单只需要表达归属；到 Shell 边界再由 targetWorkspace + groupedDraftPlacement 兑现。 */
export interface ProjectTaskCreationRequest {
  projectId?: string | null;
  taskGroupId?: string | null;
  hostId?: string;
  /** 远端入口的成员校验值；Shell 只在成员未换代时继续，不把它写成 workspace 事实。 */
  remoteProjectMembershipId?: string;
  isCurrent?: () => boolean;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
  initialPrompt?: string;
}
export type ProjectCreateTaskRequest = CreateTaskRequest | ProjectTaskCreationRequest;

/** 项目、时间线共用同一 Host 行集合；回调只负责现有导航，不维护组织状态。 */
export interface ProjectSidebarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activePreviewPath?: string | null;
  onOpenFileManager?: (target: SidebarFileTreeTarget) => void;
  onSelectTask: (
    targetWorkspacePath: string,
    taskId: string,
    targetWorkspaceIdentity?: string,
    targetRemoteSessionId?: string,
    expectedUnreadAt?: number,
  ) => void;
  onStartDraftInWorkspace: (targetWorkspacePath: string, targetWorkspaceIdentity?: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenBrowserUrl?: (url: string) => void;
  fileTreeOpenRequest?: SidebarFileTreeOpenRequest | null;
  onCreateTask: (request?: ProjectCreateTaskRequest) => void;
  onCreateConversationTask: () => void;
  onOpenFolderFromWorkspaceMenu: () => void;
  onOpenRemoteWorkspace?: AppProps["onOpenRemoteWorkspace"];
  theme: Theme;
  onConnectRemote: (
    options: RemoteTarget,
    requestId?: string,
    context?: { confirmSourceServerInstall?: boolean },
    feedback?: import("@/app-shell/types.js").RemoteConnectionFeedbackOptions,
  ) => Promise<string>;
  onSelectRemoteProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
    preparedWorkspaceIdentity?: string,
    isCurrent?: () => boolean | Promise<boolean>,
  ) => Promise<void>;
  onCancelRemoteProject: (sessionId: string) => Promise<void>;
  onReconnectRemoteWorkspace: (workspaceKey: string) => Promise<void>;
  onLogout?: () => void;
  onLogin?: () => void;
  user?: UserInfo | null;
  reconnectingRemoteWorkspaceKeys: string[];
  remoteWorkspaceRecoveryByWorkspaceKey?: Record<string, RemoteWorkspaceRecoveryStatus>;
  remoteWorkspaceErrorByWorkspaceKey: Record<string, string>;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  toggleSidebarShortcutLabel?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  goBackShortcutLabel?: string;
  goForwardShortcutLabel?: string;
  onOpenCommandCenter: () => void;
  onOpenRepoWiki?: () => void;
  repoWikiActive?: boolean;
  onOpenAutomations?: () => void;
  onOpenPluginStore?: () => void;
  automationsActive?: boolean;
  pluginStoreActive?: boolean;
  onFileTreeOpenChange?: (open: boolean) => void;
}
