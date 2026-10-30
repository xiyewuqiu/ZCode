import { memo, useCallback, useEffect, useState } from "react";
import type { Locale, RemoteTarget } from "@ycode/shared";
import type { CreateTaskRequest } from "@/app-shell/types.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import {
  ProjectDirectoryProvider,
  ProjectSidebar,
  type ProjectCreateTaskRequest,
  type ProjectSidebarProps,
  type SidebarFileTreeOpenRequest,
  type SidebarFileTreeTarget,
} from "@/project-sidebar/index.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import type { Theme } from "@/useTheme.js";
import { WorkspaceFileTree } from "@/WorkspaceFileTree.js";

export { applyWorkspaceTriggerSelection } from "@/WorkspaceSidebar/workspaceSidebarSelection.js";
export { WorkspaceSidebarCollapsedRail } from "@/WorkspaceSidebar/WorkspaceSidebarCollapsedRail.js";
export type { SidebarFileTreeOpenRequest, SidebarFileTreeTarget };

export interface WorkspaceSidebarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activePreviewPath?: string | null;
  onSelectTask: ProjectSidebarProps["onSelectTask"];
  onStartDraftInWorkspace: ProjectSidebarProps["onStartDraftInWorkspace"];
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenBrowserUrl?: (url: string) => void;
  fileTreeOpenRequest?: SidebarFileTreeOpenRequest | null;
  onCreateTask: (request?: CreateTaskRequest) => void;
  onCreateConversationTask: () => void;
  onOpenFolderFromWorkspaceMenu: () => void;
  onOpenRemoteWorkspace?: ProjectSidebarProps["onOpenRemoteWorkspace"];
  theme: Theme;
  onConnectRemote: (options: RemoteTarget, requestId?: string) => Promise<string>;
  onSelectRemoteProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
  ) => Promise<void>;
  onCancelRemoteProject: (sessionId: string) => Promise<void>;
  onReconnectRemoteWorkspace: (workspaceKey: string) => Promise<void>;
  reconnectingRemoteWorkspaceKeys: string[];
  remoteWorkspaceErrorByWorkspaceKey: Record<string, string>;
  /** 旧入口仍携带重连日志；项目侧栏不消费，只保持 Shell 调用形状。 */
  reconnectingRemoteWorkspaceLogsByWorkspaceKey?: Record<string, unknown>;
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
  onOpenAutomations?: () => void;
  onOpenPluginStore?: () => void;
  automationsActive?: boolean;
  pluginStoreActive?: boolean;
  onFileTreeOpenChange?: (open: boolean) => void;
}

/**
 * 项目树是唯一组织视图；workspace tab 继续只负责导航与执行目录。
 * 文件树仍由本壳层覆盖在侧栏之上：项目读取与文件读取是两条独立链路。
 */
export const WorkspaceSidebar = memo(function WorkspaceSidebarComponent(
  props: WorkspaceSidebarProps,
) {
  const {
    workspacePath,
    activePreviewPath,
    onOpenCodeViewer,
    onOpenBrowserUrl,
    fileTreeOpenRequest,
    onCreateTask,
    onFileTreeOpenChange,
    isDesktop = false,
  } = props;
  // 老入口不显式传 identity 时仍从当前 tab 精确解析；同路径多身份不能被 path-only 桶吞掉。
  const tabWorkspaceIdentity = useTabStore((state) => {
    if (!state.activeTabId) return undefined;
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    if (!tab || !isWorkspaceTab(tab) || tab.workspacePath !== workspacePath) return undefined;
    return tab.workspaceIdentity;
  });
  const workspaceIdentity = props.workspaceIdentity ?? tabWorkspaceIdentity;
  const [fileTreeTarget, setFileTreeTarget] = useState<SidebarFileTreeTarget | null>(null);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(false);
  useEffect(() => {
    if (!fileTreeOpenRequest) return;
    setFileTreeTarget(fileTreeOpenRequest.target);
    setIsFileTreeOpen(true);
  }, [fileTreeOpenRequest]);
  useEffect(() => {
    onFileTreeOpenChange?.(isFileTreeOpen);
  }, [isFileTreeOpen, onFileTreeOpenChange]);
  useEffect(() => () => onFileTreeOpenChange?.(false), [onFileTreeOpenChange]);
  const handleOpenFileManager = useCallback((target: SidebarFileTreeTarget) => {
    setFileTreeTarget(target);
    setIsFileTreeOpen(true);
  }, []);
  // 项目行请求在 ProjectSidebar 内已解析成 targetWorkspace/projectId；这里只收窄回调类型。
  const handleCreateTask = useCallback(
    (request?: ProjectCreateTaskRequest) => {
      onCreateTask(request as CreateTaskRequest | undefined);
    },
    [onCreateTask],
  );
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <ProjectDirectoryProvider isDesktop={isDesktop}>
        <ProjectSidebar
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          workspaceRemoteSessionId={props.workspaceRemoteSessionId}
          activePreviewPath={activePreviewPath}
          onOpenFileManager={handleOpenFileManager}
          onSelectTask={props.onSelectTask}
          onStartDraftInWorkspace={props.onStartDraftInWorkspace}
          onOpenCodeViewer={onOpenCodeViewer}
          onOpenBrowserUrl={onOpenBrowserUrl}
          fileTreeOpenRequest={fileTreeOpenRequest}
          onCreateTask={handleCreateTask}
          onCreateConversationTask={props.onCreateConversationTask}
          onOpenFolderFromWorkspaceMenu={props.onOpenFolderFromWorkspaceMenu}
          onOpenRemoteWorkspace={props.onOpenRemoteWorkspace}
          theme={props.theme}
          onConnectRemote={props.onConnectRemote}
          onSelectRemoteProject={props.onSelectRemoteProject}
          onCancelRemoteProject={props.onCancelRemoteProject}
          onReconnectRemoteWorkspace={props.onReconnectRemoteWorkspace}
          reconnectingRemoteWorkspaceKeys={props.reconnectingRemoteWorkspaceKeys}
          remoteWorkspaceErrorByWorkspaceKey={props.remoteWorkspaceErrorByWorkspaceKey}
          isDesktop={props.isDesktop}
          isMacDesktop={props.isMacDesktop}
          isWindowsDesktop={props.isWindowsDesktop}
          isSidebarVisible={props.isSidebarVisible}
          onToggleSidebar={props.onToggleSidebar}
          toggleSidebarShortcutLabel={props.toggleSidebarShortcutLabel}
          canGoBack={props.canGoBack}
          canGoForward={props.canGoForward}
          onGoBack={props.onGoBack}
          onGoForward={props.onGoForward}
          goBackShortcutLabel={props.goBackShortcutLabel}
          goForwardShortcutLabel={props.goForwardShortcutLabel}
          onOpenCommandCenter={props.onOpenCommandCenter}
          onOpenAutomations={props.onOpenAutomations}
          onOpenPluginStore={props.onOpenPluginStore}
          automationsActive={props.automationsActive}
          pluginStoreActive={props.pluginStoreActive}
        />
      </ProjectDirectoryProvider>
      <div
        className={`absolute inset-0 transition-transform duration-200 ease-out ${
          isFileTreeOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
        aria-hidden={!isFileTreeOpen}
      >
        {fileTreeTarget ? (
          <WorkspaceFileTree
            workspacePath={fileTreeTarget.workspacePath}
            workspaceName={fileTreeTarget.workspaceName}
            workspaceIdentity={fileTreeTarget.workspaceIdentity}
            workspaceRemoteSessionId={fileTreeTarget.workspaceRemoteSessionId}
            revealPath={fileTreeTarget.revealPath}
            temporaryExternalDirectory={fileTreeTarget.temporaryExternalDirectory}
            canOpenLocalFileManager={isDesktop}
            activePreviewPath={activePreviewPath}
            onClose={() => setIsFileTreeOpen(false)}
            onOpenBrowserUrl={isDesktop ? onOpenBrowserUrl : undefined}
            onOpenPreview={(source) => {
              // 文件树可以查看非当前 workspace 的文件。
              // 预览 source 携带 workspace 作用域，PreviewPane 才能用正确 host 读取远程文件。
              onOpenCodeViewer?.({
                ...source,
                workspacePath: fileTreeTarget.workspacePath,
                workspaceIdentity: fileTreeTarget.workspaceIdentity,
                workspaceRemoteSessionId: fileTreeTarget.workspaceRemoteSessionId,
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );
});

export type { Locale };
