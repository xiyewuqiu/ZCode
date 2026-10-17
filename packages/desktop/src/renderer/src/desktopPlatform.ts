import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@ycode/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.ycode.selectDirectory(),
    selectFile: () => window.ycode.selectFile(),
    selectFiles: () => window.ycode.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.ycode.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.ycode.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.ycode.onRemoteSessionClosed(handler),
    activateOrSetWorkspace: (path) =>
      window.ycode.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.ycode.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.ycode.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.ycode.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.ycode.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.ycode.isDockerAvailable(),
    listWSLDistros: () => window.ycode.listWSLDistros(),
    listDockerContainers: () => window.ycode.listDockerContainers(),
    listSSHConfigAliases: () => window.ycode.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.ycode.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.ycode.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.ycode.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.ycode.openExternal(url),
    openFeedback: () => window.ycode.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.ycode.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.ycode.canOpenCommunity(locale),
    openInFileManager: (path) => window.ycode.openInFileManager(path),
    openExternalFile: (path) => window.ycode.openExternalFile(path),
    openCuaPermissionOnboarding: window.ycode.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.ycode.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.ycode.prepareCuaHelperPermissionDrag
      ? () =>
          window.ycode.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.ycode.startCuaHelperPermissionDrag
      ? () => window.ycode.startCuaHelperPermissionDrag?.()
      : undefined,
    notifyRendererReady: () => window.ycode.notifyRendererReady(),
    showTaskNotification: (payload) => window.ycode.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.ycode.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.ycode.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.ycode.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.ycode.syncAppSettings?.(patch),
    setShortcutRecordingActive: (active) => window.ycode.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.ycode.onFocusTab(handler),
    onNewTab: (handler) => window.ycode.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.ycode.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.ycode.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.ycode.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.ycode.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.ycode.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.ycode.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.ycode.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.ycode.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.ycode.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.ycode.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.ycode.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.ycode.getDesktopWindowChromeState
      ? () => window.ycode.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.ycode.onDesktopWindowChromeStateChanged
      ? (handler) => window.ycode.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.ycode.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.ycode.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.ycode.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.ycode.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.ycode.onTaskNotificationClick(handler),
    exportLogs: () => window.ycode.exportLogs(),
    captureWindowScreenshot: () =>
      window.ycode.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.ycode.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.ycode.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) => window.ycode.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.ycode.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.ycode.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.ycode.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.ycode.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.ycode.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.ycode.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.ycode.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getYCodeStdioTapDevState: () =>
      window.ycode.getYCodeStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.ycode.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.ycode.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.ycode.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.ycode.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) => window.ycode.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.ycode.quitAndInstallUpdate(),
    getInstalledEditors: () => window.ycode.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.ycode.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.ycode.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.ycode.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.ycode.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.ycode.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.ycode.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __YCODE_DEVICE_ID__?: string }).__YCODE_DEVICE_ID__ ?? "",
  };
}
