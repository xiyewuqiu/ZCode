import type { IPlatformService } from "@ycode/shared";

type DesktopBrowserPlatformBridge = Pick<
  IPlatformService,
  | "onBrowserViewReady"
  | "onBrowserViewOperation"
  | "onBrowserViewViewportChanged"
  | "onBrowserViewVisibility"
  | "onBrowserViewCloseTab"
  | "onBrowserViewSuspend"
  | "onBrowserViewRestore"
  | "browserViewAttachGuest"
  | "browserViewDetachGuest"
  | "browserViewCloseTab"
  | "browserViewReportResidency"
  | "browserViewSuspendReady"
  | "browserViewEnsureResident"
  | "browserViewRestoreTabs"
  | "browserViewUpdateViewport"
  | "importChromeBrowserData"
  | "clearEmbeddedBrowserData"
  | "getPathForFile"
  | "saveFile"
  | "printPageToPdf"
>;

// Rebase 集成：browser bridge 若继续内联在 renderer 入口，会让入口越过 max-lines 门禁。
// 独立对象只做 preload 委托与旧 bridge 兼容兜底，不持有 Browser 业务状态。
export const desktopBrowserPlatformBridge = {
  getPathForFile: (file) =>
    file instanceof File ? (window.ycode.getPathForFile?.(file) ?? null) : null,
  saveFile: (payload) =>
    window.ycode.saveFile?.(payload) ?? Promise.resolve({ success: false, error: "not_supported" }),
  // 条件定义而非兜底返回失败：UI 靠方法是否存在做能力检测，旧 preload 下必须保持 undefined
  printPageToPdf: window.ycode.printPageToPdf ? () => window.ycode.printPageToPdf!() : undefined,
  onBrowserViewReady: (handler) => window.ycode.onBrowserViewReady?.(handler) ?? (() => {}),
  onBrowserViewOperation: (handler) => window.ycode.onBrowserViewOperation?.(handler) ?? (() => {}),
  onBrowserViewViewportChanged: (handler) =>
    window.ycode.onBrowserViewViewportChanged?.(handler) ?? (() => {}),
  onBrowserViewVisibility: (handler) =>
    window.ycode.onBrowserViewVisibility?.(handler) ?? (() => {}),
  onBrowserViewCloseTab: (handler) => window.ycode.onBrowserViewCloseTab?.(handler) ?? (() => {}),
  onBrowserViewSuspend: (handler) => window.ycode.onBrowserViewSuspend?.(handler) ?? (() => {}),
  onBrowserViewRestore: (handler) => window.ycode.onBrowserViewRestore?.(handler) ?? (() => {}),
  browserViewAttachGuest: (payload) =>
    window.ycode.browserViewAttachGuest?.(payload) ??
    Promise.resolve({ ok: false, reason: "not-found", recoveryRequested: false }),
  browserViewDetachGuest: (payload) =>
    window.ycode.browserViewDetachGuest?.(payload) ?? Promise.resolve(false),
  browserViewCloseTab: (payload) =>
    window.ycode.browserViewCloseTab?.(payload) ?? Promise.resolve(),
  browserViewReportResidency: (payload) =>
    window.ycode.browserViewReportResidency?.(payload) ?? Promise.resolve(),
  browserViewSuspendReady: (payload) =>
    window.ycode.browserViewSuspendReady?.(payload) ?? Promise.resolve(),
  browserViewEnsureResident: (payload) =>
    window.ycode.browserViewEnsureResident?.(payload) ?? Promise.resolve(),
  browserViewRestoreTabs: (payload) =>
    window.ycode.browserViewRestoreTabs?.(payload) ?? Promise.resolve([]),
  browserViewUpdateViewport: (payload) =>
    window.ycode.browserViewUpdateViewport?.(payload) ?? Promise.resolve(),
  importChromeBrowserData: (options) =>
    window.ycode.importChromeBrowserData?.(options) ??
    Promise.resolve({
      success: false,
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
      error: "chrome_import_not_supported",
    }),
  clearEmbeddedBrowserData: (mode) =>
    window.ycode.clearEmbeddedBrowserData?.(mode) ??
    Promise.resolve({ success: false, error: "unsupported" }),
} satisfies DesktopBrowserPlatformBridge;
