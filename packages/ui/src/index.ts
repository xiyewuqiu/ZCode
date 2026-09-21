// App 仅由 root/RootWorkspaceContent 直接导入（@/App.js），不在此 re-export：
// barrel 静态导出会让所有 @zcode/ui 消费方的首屏闭包都携带完整 App 图。
export { AppErrorBoundary, ScopedErrorBoundary } from "./ErrorBoundary.js";
export type { ScopedErrorBoundaryVariant } from "./ErrorBoundary.js";
export { Button, buttonVariants } from "./components/ui/button.js";
export { DesktopWindowFrame } from "./DesktopWindowFrame.js";
export {
  AssistantCodeCommentFeatureProvider,
  useAssistantCodeCommentFeatureEnabled,
} from "./AssistantCodeCommentFeatureProvider.js";
export { Root } from "./Root.js";
export { UpdateStatusWindowRoot } from "./UpdateStatusWindowRoot.js";
export { ConfirmDialogHost } from "./ConfirmDialog.js";
// Terminal / GitGraphPane / layoutGitGraph 不再从 barrel 导出：Terminal 拖入 @xterm/xterm，
// git-graph 拖入 @pierre/diffs，均只被内部模块直接导入（AnimatedTerminalPanel、GitGraphDialog）。
export { useTheme } from "./useTheme.js";
export type { Theme } from "./useTheme.js";
export { useTestActions } from "./test-actions.js";
export type { TestActions } from "./test-actions.js";
export { StoreProvider, useZCodeStore } from "./store/StoreProvider.js";
export type { ZCodeState } from "./store/index.js";
export {
  bindRemoteWorkspacePath,
  getRemoteWorkspaceSession,
  registerBaseWorkspaceServices,
  registerRemoteWorkspaceSession,
  unbindRemoteWorkspacePath,
  unregisterRemoteWorkspaceSession,
  useRemoteWorkspaceSessionStore,
} from "./store/remoteWorkspaceSessionStore.js";
export {
  REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE,
  createRemoteWorkspaceDisconnectedError,
} from "./lib/remoteWorkspaceServiceError.js";

// Hooks —— 统一的服务和平台操作访问层
export {
  ServiceProvider,
  useServices,
  useWorkspaceServices,
  PlatformProvider,
  usePlatform,
  useSelectDirectory,
  useConnectRemote,
  useReaddir,
  useSystemInfo,
  useIntranetProbe,
  useTerminal,
  useSettings,
  useRecentProjects,
  useConfirmDialog,
  useCredentials,
  useGitRepository,
  useGitActions,
} from "./hooks/index.js";

export { ZCodeIntlProvider, useZCodeIntl, LocaleSwitcher } from "./i18n/index.js";
export type { IntlInstance } from "./i18n/index.js";
export {
  FileDisplayInline,
  createFileDisplayDom,
  getFileDisplayPath,
  resolveFileDisplayDescriptor,
  setDefaultFileDisplayBasePath,
} from "./lib/fileDisplay.js";
export type { FileDisplayDescriptor, FileDisplayOptions } from "./lib/fileDisplay.js";
export { playTaskNotificationSound } from "./lib/taskNotificationSound.js";
export {
  applyUiFontSizePx,
  loadUiFontSizePx,
  subscribeToUiFontSizeStorageChanges,
} from "./lib/uiFontSize.js";
export { reportUiLaunchToInput } from "./lib/uiPerfArmsTelemetry.js";
export {
  RendererUserActionTelemetry,
  runUserAction,
  runUserActionAsync,
  setUserActionTelemetry,
  startUserAction,
} from "./lib/userActionTelemetry.js";
export {
  CORE_USER_ACTION_FEATURES,
  SETTINGS_USER_ACTION_FEATURES,
  USER_ACTION_CATALOG,
} from "./lib/userActionTraceCatalog.js";
export { setReactErrorArmsReporter } from "./lib/reactErrorArmsTelemetry.js";
export { recordArmsCustomEventForE2E } from "./lib/armsCustomEventObservability.js";
export { generateMobileDeviceFingerprint, setStreamClientId } from "./lib/streamClientId.js";
export { GlobalDatabaseStartupLoading } from "./root/GlobalDatabaseStartupLoading.js";

export { LocalTtftObserver, setLocalTtftObserver } from "@/v4/telemetry/localTtftObserver.js";
