import { getDatabaseStartupPortPayload } from "./databaseStartupRelay.js";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, Menu, MessageChannelMain } from "electron";
import type { MessagePortMain, UtilityProcess as ElectronUtilityProcess } from "electron";
import { HostMessageTypes, InternalChannels, PlatformChannels, type Locale } from "@zcode/shared";
import { scheduleArmsBrowserPerfLoadNudge } from "./armsBrowserPerfLoadNudge.js";
import { createBrowserWindow } from "./desktopWindowChrome.js";
import type {
  HostInitMessage,
  SpawnHostProcessOptions,
  WindowBootstrapOptions,
} from "./desktopHostProcess.js";
import type { StartupWorkspaceWarmupTarget } from "./startupWorkspace.js";
import { handleDarwinWindowCloseRequest } from "./desktopDarwinCloseBehavior.js";
import {
  parseWindowUnreadCount,
  sumWindowUnreadCounts,
  syncAppUnreadBadge,
} from "./unreadBadge.js";
import { attachDesktopWindowSizePersistence, type DesktopWindowSize } from "./desktopWindowSize.js";
import {
  registerMainApplicationWindow,
  unregisterMainApplicationWindow,
} from "./resourceManagerWindow.js";

const DEFAULT_RUNTIME_PROCESS_ENV_WAIT_TIMEOUT_MS = 4_500;

export function createWindow(options: {
  iconPath: string;
  preloadPath: string;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  forceQuitRef: { current: boolean };
  handleBeforeClose?: (win: BrowserWindow, label: string) => boolean;
  windowHostProcessMap: Map<number, ElectronUtilityProcess>;
  spawnHostProcess: (
    win: BrowserWindow,
    label: string,
    initMessage: HostInitMessage,
    spawnOptions?: SpawnHostProcessOptions,
  ) => ElectronUtilityProcess;
  disposeHostProcess: (
    child: ElectronUtilityProcess,
    label: string,
    forceKillDelayMs?: number,
  ) => void;
  syncAutoUpdaterStateToWindow: (win: BrowserWindow) => void;
  syncReadyUpdateToWindow: (win: BrowserWindow) => void;
  syncPostUpdateReleaseNotesToWindow: (win: BrowserWindow) => void;
  disposeRemoteWorkspaceSessionsForWindow: (windowId: number, reason: string) => void;
  reattachRemoteWorkspaceSessionsForWindow: (win: BrowserWindow, reason: string) => void;
  bootstrap?: WindowBootstrapOptions;
  agentWarmupTargets?: readonly StartupWorkspaceWarmupTarget[];
  agentSpawnFallbackCwd: string;
  deviceMid: string;
  initialDesktopZoomLevel?: number;
  initialWindowSize?: DesktopWindowSize;
  currentApplicationLocale?: () => Locale;
  persistWindowSize?: (state: DesktopWindowSize) => Promise<void>;
  /** Main 模块初始化期已开始的异步环境采集；通常在 renderer dom-ready 前完成。 */
  runtimeProcessEnvPatchPromise?: Promise<Record<string, string>>;
  /** 不执行 shell 即可计算的完整降级 patch；预热失败/超时时仍要注入 Local Host。 */
  runtimeProcessEnvFallbackPatch: Record<string, string>;
  /** 仅供启动门禁和测试注入；超过该时间必须 fail-open 创建 Local Host。 */
  runtimeProcessEnvWaitTimeoutMs?: number;
  /** Local Host map insertion completed; presentation facts can now be replayed safely. */
  onHostProcessReady?: (windowKey: number) => void;
  resolveBrowserViewOwner?: Parameters<typeof createBrowserWindow>[0]["resolveBrowserViewOwner"];
}) {
  const win = createBrowserWindow({
    iconPath: options.iconPath,
    preloadPath: options.preloadPath,
    bootstrap: {
      restoreSession: options.bootstrap?.restoreSession ?? true,
      supportsSettings: options.bootstrap?.supportsSettings ?? true,
      initialWorkspacePath: options.bootstrap?.initialWorkspacePath,
      initialWorkspacePurpose: options.bootstrap?.initialWorkspacePurpose,
      unavailableWorkspacePath: options.bootstrap?.unavailableWorkspacePath,
    },
    logger: options.logger,
    deviceMid: options.deviceMid,
    initialDesktopZoomLevel: options.initialDesktopZoomLevel,
    initialWindowSize: options.initialWindowSize,
    currentApplicationLocale: options.currentApplicationLocale,
    resolveBrowserViewOwner: options.resolveBrowserViewOwner,
  });
  const label = `local-${win.webContents.id}`;

  if (options.persistWindowSize) {
    attachDesktopWindowSizePersistence(win, options.persistWindowSize, (error) => {
      options.logger.warn("[desktop-window] failed to persist main window size", error);
    });
  }

  if (process.platform === "darwin") {
    win.on("close", (event) => {
      if (
        handleDarwinWindowCloseRequest({
          win,
          forceQuit: options.forceQuitRef.current,
          label,
          logger: options.logger,
        })
      ) {
        event.preventDefault();
      }
    });
  } else if (options.handleBeforeClose) {
    win.on("close", (event) => {
      if (options.handleBeforeClose?.(win, label)) {
        event.preventDefault();
      }
    });
  }

  const wcId = win.webContents.id;
  // 资源遥测据此把主窗口 renderer 归 renderer_main；辅助窗口与 DevTools 归 chromium_other。
  registerMainApplicationWindow(wcId);
  let domReadyGeneration = 0;
  scheduleArmsBrowserPerfLoadNudge(win.webContents);

  // ---- 首窗 Host 提前预热 ----
  // 旧实现等 renderer dom-ready 后才 fork Host：Host 的 Node 启动、SQLite 初始化与
  // 服务装配全部排在 renderer 加载之后，串行叠加在首屏耗时上。
  // 这里在窗口创建后立即 fork Host（runtime env 采集在 Main import 时已启动，此时通常已
  // settled），让 Host 启动与 renderer 解析/React 初始化并行。服务端口先持有，等到
  // dom-ready 再投递——renderer 此时才注册了 message 监听，早投的消息会被丢弃。
  let hostSpawned = false;
  let hostSpawnFailed = false;
  let heldServicePort: MessagePortMain | null = null;
  let servicePortDelivered = false;
  let hostSpawnCompletion: Promise<void> | null = null;

  const spawnLocalHost = (runtimeProcessEnvPatch: Record<string, string>) => {
    if (hostSpawned || hostSpawnFailed || win.isDestroyed()) return;
    const primaryWarmupTarget = options.agentWarmupTargets?.[0];
    try {
      const child = options.spawnHostProcess(
        win,
        label,
        {
          type: HostMessageTypes.InitLocal,
          deviceMid: options.deviceMid,
          workspacePath: primaryWarmupTarget?.workspacePath,
          workspaceIdentity: primaryWarmupTarget?.workspaceIdentity,
          ...(options.agentWarmupTargets && options.agentWarmupTargets.length > 0
            ? { agentWarmupTargets: [...options.agentWarmupTargets] }
            : {}),
          runtimeProcessEnvPatch,
          // fallback 随 local Host 常驻，覆盖非 active 历史目录被删除后失效 cwd 反复 spawn 的场景。
          agentSpawnFallbackCwd: options.agentSpawnFallbackCwd,
        },
        {
          // 预热期不投递端口（renderer 未加载会丢消息），由 dom-ready 统一投递。
          onPortReady: (port) => {
            heldServicePort = port;
          },
        },
      );
      options.windowHostProcessMap.set(wcId, child);
      hostSpawned = true;
      options.onHostProcessReady?.(wcId);
    } catch (error) {
      hostSpawnFailed = true;
      options.logger.warn(
        `[createWindow] early host spawn failed (${label}), falling back to dom-ready spawn:`,
        error,
      );
    }
  };

  const deliverHeldServicePort = (): boolean => {
    if (servicePortDelivered || !hostSpawned) {
      return false;
    }
    servicePortDelivered = true;
    const port = heldServicePort;
    heldServicePort = null;
    const child = options.windowHostProcessMap.get(wcId);
    const startupPayload = child ? getDatabaseStartupPortPayload(child) : undefined;
    if (port && startupPayload && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.postMessage(InternalChannels.ServicePort, startupPayload, [port]);
    } else if (port) {
      port.close();
    }
    options.syncAutoUpdaterStateToWindow(win);
    options.syncReadyUpdateToWindow(win);
    options.syncPostUpdateReleaseNotesToWindow(win);
    options.reattachRemoteWorkspaceSessionsForWindow(win, `${label}:renderer-ready`);
    return true;
  };

  const beginHostSpawn = (): void => {
    if (hostSpawnCompletion || options.windowHostProcessMap.has(wcId) || win.isDestroyed()) {
      return;
    }
    hostSpawnCompletion = (async () => {
      if (!options.runtimeProcessEnvPatchPromise) {
        spawnLocalHost(options.runtimeProcessEnvFallbackPatch);
        return;
      }
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const waitTimeoutMs =
        options.runtimeProcessEnvWaitTimeoutMs ?? DEFAULT_RUNTIME_PROCESS_ENV_WAIT_TIMEOUT_MS;
      const patch = await Promise.race([
        options.runtimeProcessEnvPatchPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            options.logger.warn(
              `[createWindow] runtime env prewarm exceeded ${waitTimeoutMs}ms (${label}), using shell-free fallback`,
            );
            reject(new Error("runtime-env-prewarm-timeout"));
          }, waitTimeoutMs);
        }),
      ]).catch((error) => {
        // 旧 rejection 分支曾传 undefined，导致 Host 再跑一次 login shell；这里始终用预计算 fallback。
        if (!(error instanceof Error && error.message === "runtime-env-prewarm-timeout")) {
          options.logger.warn(
            `[createWindow] runtime env prewarm failed (${label}), using shell-free fallback:`,
            error,
          );
        }
        return options.runtimeProcessEnvFallbackPatch;
      });
      clearTimeout(timeout ?? undefined);
      spawnLocalHost(patch);
    })();
  };
  beginHostSpawn();

  win.webContents.on("dom-ready", async () => {
    const currentDomReadyGeneration = ++domReadyGeneration;
    options.logger.info(`[createWindow] dom-ready fired (${label})`);

    if (process.platform === "win32" && !win.isDestroyed()) {
      win.show();
      win.focus();
    }

    const oldChild = options.windowHostProcessMap.get(wcId);
    if (oldChild) {
      // 首窗早启 Host 已就绪：直接投递预热期持有的端口，无需再走 reattach 换新通道。
      if (hostSpawned && !servicePortDelivered) {
        deliverHeldServicePort();
        return;
      }
      // renderer 刷新（reload）
      // 曾经无条件杀掉旧 host 进程再重建——host 连带 CLI agent 一起死，运行中的会话直接消失，
      // 这正是「会话身份易失」病根。host/CLI 的生命周期属于窗口而非
      // renderer 加载周期：reload 只需给存活的 host 补挂一条新 RPC MessagePort
      // （复用 web 远控的 AttachServicePort 通道），renderer 重新订阅即可恢复投影。
      // 旧端口的 ChannelServer 会随 renderer 上下文销毁触发 close 自行回收。
      if (oldChild.pid !== undefined) {
        try {
          const startupPayload = getDatabaseStartupPortPayload(oldChild);
          if (!startupPayload) throw new Error("Previous Host startup binding is unavailable");
          const { port1, port2 } = new MessageChannelMain();
          oldChild.postMessage(
            {
              type: HostMessageTypes.AttachServicePort,
              requestId: randomUUID(),
              attachmentId: randomUUID(),
              clientMode: "desktop-continuous",
              scope: { kind: "local" },
            },
            [port2],
          );
          win.webContents.postMessage(InternalChannels.ServicePort, startupPayload, [port1]);
          options.logger.info(
            `[createWindow] renderer reloaded, reattached to existing host (${label}), pid=${oldChild.pid}`,
          );
          options.syncAutoUpdaterStateToWindow(win);
          options.syncReadyUpdateToWindow(win);
          options.syncPostUpdateReleaseNotesToWindow(win);
          options.reattachRemoteWorkspaceSessionsForWindow(win, `${label}:renderer-reload`);
          return;
        } catch (error) {
          options.logger.warn(
            `[createWindow] reattach to existing host failed (${label}), falling back to respawn:`,
            error,
          );
        }
      }
      options.logger.info(
        `[createWindow] killing previous host process for (${label}), pid=${oldChild.pid ?? "unknown"}`,
      );
      options.disposeHostProcess(oldChild, `${label}:reload`, 150);
    }

    if (hostSpawnCompletion) {
      // 早启链路已启动但 env patch 未决（慢 shell）：等待其完成后再投递端口。
      await hostSpawnCompletion;
      if (currentDomReadyGeneration !== domReadyGeneration || win.isDestroyed()) {
        return;
      }
      if (deliverHeldServicePort()) {
        return;
      }
    }
    // 兜底重建：早启失败或 reattach 失败后重置预热状态，重新 spawn 并立即投递端口。
    hostSpawnFailed = hostSpawned = servicePortDelivered = false;
    spawnLocalHost(options.runtimeProcessEnvFallbackPatch);
    deliverHeldServicePort();
  });

  win.on("closed", () => {
    unregisterMainApplicationWindow(wcId);
    options.logger.info(`[createWindow] window closed, killing host process (${label})`);
    const child = options.windowHostProcessMap.get(wcId);
    if (child) {
      options.disposeHostProcess(child, `${label}:window-closed`);
      options.windowHostProcessMap.delete(wcId);
    }
    options.disposeRemoteWorkspaceSessionsForWindow(wcId, `${label}:window-closed`);
  });

  return win;
}

export function showCurrentWindowFromDock(primaryWindowCoordinator: {
  ensurePrimaryWindow(reason: string): Promise<void>;
}) {
  if (process.platform === "darwin") {
    app.show();
  }

  void primaryWindowCoordinator.ensurePrimaryWindow("dock-show-current-window");
}

export function focusWorkspaceInExistingWindow(
  path: string,
  windowWorkspaceMap: Map<number, Set<string>>,
  options?: { skipWindowId?: number },
): { activated: boolean; winId?: number } {
  for (const [winId, pathSet] of windowWorkspaceMap) {
    if (options?.skipWindowId === winId) {
      continue;
    }
    if (!pathSet.has(path)) {
      continue;
    }

    const existingWin = BrowserWindow.fromId(winId);
    if (existingWin && !existingWin.isDestroyed()) {
      if (existingWin.isMinimized()) {
        existingWin.restore();
      }
      existingWin.focus();
      existingWin.webContents.send(PlatformChannels.FocusTab, path);
      return { activated: true, winId };
    }

    windowWorkspaceMap.delete(winId);
  }

  return { activated: false };
}

export function syncApplicationUnreadBadge(windowUnreadCountMap: Map<number, number>) {
  syncAppUnreadBadge({
    platform: process.platform,
    totalUnreadCount: sumWindowUnreadCounts(windowUnreadCountMap),
    setBadgeCount: (count) => {
      app.setBadgeCount(count);
    },
  });
}

export function handleWindowUnreadCountSync(
  win: BrowserWindow | null,
  payload: unknown,
  windowUnreadCountMap: Map<number, number>,
  logger: { warn: (...args: unknown[]) => void },
) {
  const unreadCount = parseWindowUnreadCount(payload);
  if (unreadCount == null) {
    logger.warn("[sync-window-unread-count] invalid payload:", payload);
    return false;
  }

  if (!win) {
    return false;
  }

  if (unreadCount === 0) {
    windowUnreadCountMap.delete(win.id);
  } else {
    windowUnreadCountMap.set(win.id, unreadCount);
  }
  syncApplicationUnreadBadge(windowUnreadCountMap);
  return true;
}

export function configureDockMenu(getLabel: () => string, onShowCurrentWindow: () => void) {
  if (process.platform !== "darwin" || app.dock == null) {
    return;
  }

  const dockMenu = Menu.buildFromTemplate([
    {
      label: getLabel(),
      click: onShowCurrentWindow,
    },
  ]);

  app.dock.setMenu(dockMenu);
}

export function handleDesktopWindowCloseRequest(options: {
  platform: NodeJS.Platform;
  forceQuit: boolean;
  explicitQuitRequested?: boolean;
  closeToTrayOnWindows?: boolean;
  isLastWindow: boolean;
  label: string;
  logger: { info: (...args: unknown[]) => void };
  shouldConfirmQuit?: boolean;
  confirmQuit: () => boolean;
  requestQuit: () => void;
  hideWindow?: () => void;
}) {
  if (
    options.platform === "win32" &&
    options.closeToTrayOnWindows &&
    !options.forceQuit &&
    !options.explicitQuitRequested
  ) {
    options.logger.info(`[createWindow] window close hidden to tray (${options.label})`);
    options.hideWindow?.();
    return true;
  }

  if (options.platform === "darwin" || options.forceQuit || !options.isLastWindow) {
    return false;
  }

  if (options.shouldConfirmQuit === false) {
    options.logger.info(
      `[createWindow] last window close skipped confirmation, quitting app (${options.label})`,
    );
    options.requestQuit();
    return true;
  }

  if (!options.confirmQuit()) {
    options.logger.info(`[createWindow] last window close canceled by user (${options.label})`);
    return true;
  }

  options.logger.info(
    `[createWindow] last window close confirmed, quitting app (${options.label})`,
  );
  options.requestQuit();
  return true;
}
