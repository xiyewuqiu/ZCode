import type { Locale } from "@ycode/shared";
import { PlatformChannels } from "@ycode/shared";
import type {
  McpAppInstance,
  PluginSandboxHandle,
  PluginSandboxRegisterInput,
} from "@ycode/shared/mcp-apps";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  MessageChannelMain,
  session as electronSession,
  systemPreferences,
  webContents as electronWebContents,
  type WebContents,
} from "electron";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PluginSandboxRecord, PluginSandboxRegistryPort } from "./contract.js";
import { attachPluginSandboxGuest, configurePluginSandboxGuest } from "./guestPolicy.js";
import { createPluginSandboxPermissionGate } from "./permissionGate.js";
import { formatPluginSandboxPermissionDialogText } from "./permissions.js";
import { createPluginSandboxRegistry } from "./registry.js";
import { preparePluginSandboxSession } from "./session.js";

export interface PluginSandboxHost {
  clearBrowserData(): Promise<void>;
  /** renderer 经 IPC 登记已验证 HTML；返回句柄前完成 partition session 准备。 */
  register(input: PluginSandboxRegisterInput): PluginSandboxHandle;
  /** desktopWindowChrome 的 will-attach 分支。 */
  configureGuest(input: {
    webPreferences: Electron.WebPreferences;
    params: Record<string, string>;
    ownerWebContentsId: number;
  }): ReturnType<typeof configurePluginSandboxGuest>;
  /** desktopWindowChrome 的 did-attach 分支。 */
  attachGuest(input: { guest: WebContents; hostWebContents: WebContents; sandboxId: string }): void;
}

let installedHost: PluginSandboxHost | null = null;

export function getPluginSandboxHost(): PluginSandboxHost | null {
  return installedHost;
}

/**
 * 在 app ready 后安装一次：创建注册表、注册 renderer 可调的 IPC（register / dispose / 手势消费，按 sender 归属校验）。
 * scheme 的 privileged 注册必须在 app ready 前完成，不在这里。
 */
export function installPluginSandboxHost(input: {
  preloadPath: string;
  logger?: { warn: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
  registry?: PluginSandboxRegistryPort;
  /** 注册表容量（缺省 64）。 */
  registryMaxEntries?: number;
}): PluginSandboxHost {
  if (installedHost) return installedHost;
  const detachByKey = new Map<string, () => void>();
  const watchedOwners = new Set<number>();
  const guests = new Map<string, WebContents>();
  const stopping = new WeakMap<WebContents, Promise<void>>();
  const partitions = new Set<string>();
  let clearing = false;

  const stopGuest = (guest: WebContents): Promise<void> => {
    if (guest.isDestroyed()) return Promise.resolve();
    const existing = stopping.get(guest);
    if (existing) return existing;
    // attached guest.close 只销毁包装对象，iframe 仍可写存储；先完成原生空白页导航。
    const stopped = Promise.resolve().then(async () => {
      if (guest.isDestroyed()) return;
      const allowUnload = (event: Electron.Event) => event.preventDefault();
      guest.on("will-prevent-unload", allowUnload);
      try {
        await guest.loadURL("about:blank");
      } catch (error) {
        if (!guest.isDestroyed()) throw error;
      } finally {
        guest.removeListener("will-prevent-unload", allowUnload);
      }
      if (guest.isDestroyed()) return;
      const destroyed = new Promise<void>((resolve) => guest.once("destroyed", resolve));
      guest.close({ waitForBeforeUnload: false });
      await destroyed;
    });
    stopping.set(guest, stopped);
    return stopped;
  };
  // partition 持久且按可信 App 身份隔离：dispose 关闭 guest，不撤 protocol handler、不清存储。
  const onDispose = (record: PluginSandboxRecord) => {
    detachByKey.get(record.sandboxId)?.();
    detachByKey.delete(record.sandboxId);
    const guest = guests.get(record.sandboxId);
    if (guest)
      void stopGuest(guest).catch((error: unknown) =>
        input.logger?.warn("[plugin-sandbox] guest stop failed", String(error)),
      );
  };
  const registry =
    input.registry ??
    createPluginSandboxRegistry({
      onDispose,
      ...(input.registryMaxEntries !== undefined ? { maxEntries: input.registryMaxEntries } : {}),
    });

  // 页面浏览器权限闸门：确认框由 main 原生弹出，父窗口是登记该沙箱的宿主窗口，页面无法伪造。
  const resolveLocale = (): Locale =>
    app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  const permissions = createPluginSandboxPermissionGate({
    registry,
    async prompt({ record, permissions: pending }) {
      const text = formatPluginSandboxPermissionDialogText(
        { serverName: record.serverName ?? "MCP App", permissions: pending },
        resolveLocale(),
      );
      const owner = electronWebContents.fromId(record.ownerWebContentsId);
      const parent = owner ? BrowserWindow.fromWebContents(owner) : null;
      const options = {
        type: "question" as const,
        buttons: [text.allowButton, text.denyButton],
        defaultId: 1,
        cancelId: 1,
        title: text.title,
        message: text.message,
        detail: text.detail,
        noLink: true,
      };
      const { response } =
        parent && !parent.isDestroyed()
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options);
      return response === 0;
    },
    ...(process.platform === "darwin"
      ? {
          async requestSystemMediaAccess(kind: "camera" | "microphone") {
            const status = systemPreferences.getMediaAccessStatus(kind);
            if (status === "granted") return true;
            if (status !== "not-determined") return false;
            return systemPreferences.askForMediaAccess(kind);
          },
        }
      : {}),
    ...(input.logger ? { logger: input.logger } : {}),
  });

  const host: PluginSandboxHost = {
    async clearBrowserData() {
      clearing = true;
      for (const owner of watchedOwners) registry.disposeOwner(owner);
      await Promise.all([...guests.values()].map(stopGuest));
      guests.clear();
      const names = await readdir(join(app.getPath("sessionData"), "Partitions")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const name of names)
        if (/^plugin-sandbox-v[12]-[a-f0-9]+$/.test(name)) partitions.add(`persist:${name}`);
      await Promise.all(
        [...partitions].map(async (partition) => {
          const session = electronSession.fromPartition(partition);
          await session.clearStorageData();
          await session.clearCache();
        }),
      );
    },
    register(registerInput) {
      if (clearing) throw new Error("MCP App browser data is being cleared");
      const owner = electronWebContents.fromId(registerInput.ownerWebContentsId);
      if (!owner || owner.isDestroyed()) throw new Error("MCP App window is no longer available");
      const handle = registry.register(registerInput);
      partitions.add(handle.partition);
      // prepare 后尚未挂载的登记也属于窗口；关闭和清除数据不能漏掉它们。
      if (!watchedOwners.has(owner.id)) {
        watchedOwners.add(owner.id);
        owner.once("destroyed", () => {
          watchedOwners.delete(owner.id);
          registry.disposeOwner(owner.id);
        });
      }
      preparePluginSandboxSession({
        session: electronSession.fromPartition(handle.partition),
        registry,
        permissions,
        ...(input.logger ? { logger: input.logger } : {}),
      });
      input.logger?.info?.("[plugin-sandbox] registered", {
        sandboxId: handle.sandboxId,
        initId: handle.initId,
        scopeId: registerInput.scopeId,
        ownerWebContentsId: registerInput.ownerWebContentsId,
      });
      return handle;
    },
    configureGuest(guestInput) {
      return configurePluginSandboxGuest({
        ...guestInput,
        registry,
        preloadPath: input.preloadPath,
      });
    },
    attachGuest({ guest, hostWebContents, sandboxId }) {
      if (clearing) {
        void stopGuest(guest).catch((error: unknown) =>
          input.logger?.warn("[plugin-sandbox] late guest stop failed", String(error)),
        );
        return;
      }
      guests.set(sandboxId, guest);
      guest.once("destroyed", () => {
        if (guests.get(sandboxId) === guest) guests.delete(sandboxId);
      });
      // 宿主 webContents 销毁（窗口关闭 / 崩溃）时释放它名下全部登记；每个 owner 只挂一次。
      if (!watchedOwners.has(hostWebContents.id)) {
        watchedOwners.add(hostWebContents.id);
        const ownerId = hostWebContents.id;
        hostWebContents.once("destroyed", () => {
          watchedOwners.delete(ownerId);
          registry.disposeOwner(ownerId);
        });
      }
      detachByKey.get(sandboxId)?.();
      detachByKey.set(
        sandboxId,
        attachPluginSandboxGuest({
          guest,
          hostWebContents,
          registry,
          sandboxId,
          createMessageChannel: () => new MessageChannelMain(),
          ...(input.logger ? { logger: input.logger } : {}),
        }),
      );
    },
  };

  ipcMain.handle(PlatformChannels.PluginSandboxOwnerWebContentsId, (event) => event.sender.id);
  ipcMain.handle(PlatformChannels.PluginSandboxRegister, (event, raw: unknown) => {
    let payload: PluginSandboxRegisterInput;
    try {
      payload = parseRegisterPayload(raw);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    // owner 永远取真实 sender，renderer 不能替别的窗口登记。
    try {
      const handle = host.register({ ...payload, ownerWebContentsId: event.sender.id });
      return { ok: true, ...handle };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    PlatformChannels.PluginSandboxDispose,
    (event, sandboxId: unknown, initId: unknown) => {
      if (typeof sandboxId !== "string") return;
      const record = registry.get(sandboxId);
      // 只有登记时的宿主窗口能释放自己的沙箱；其他 sender 静默忽略。
      if (!record || record.ownerWebContentsId !== event.sender.id) return;
      input.logger?.info?.("[plugin-sandbox] dispose requested", {
        sandboxId,
        initId,
        currentInitId: record.initId,
      });
      registry.dispose(sandboxId, typeof initId === "number" ? initId : undefined);
      const guest = guests.get(sandboxId);
      // 旧 initId 的迟到 dispose 不能停止仍有效的登记。
      if (guest && !registry.get(sandboxId)) return stopGuest(guest);
    },
  );
  ipcMain.handle(PlatformChannels.PluginSandboxConsumeUserGesture, (event, sandboxId: unknown) => {
    if (typeof sandboxId !== "string") return false;
    const record = registry.get(sandboxId);
    if (!record || record.ownerWebContentsId !== event.sender.id) return false;
    return registry.consumeUserGesture(sandboxId);
  });

  installedHost = host;
  return host;
}

const MAX_HTML_BYTES = 16 * 1024 * 1024;

/**
 * renderer 是不可信输入的边界：HTML 必须是有界字符串，归属与 scope 必须完整。
 * ownerWebContentsId 由 IPC sender 覆盖，这里只校验其他字段。
 */
function parseRegisterPayload(raw: unknown): PluginSandboxRegisterInput {
  if (!isRecord(raw)) throw new Error("Invalid sandbox registration payload");
  const instance = parseInstance(raw.instance);
  const html = requireString(raw.html, "html");
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES)
    throw new Error("Sandbox HTML is too large");
  const scopeId = requireString(raw.scopeId, "scopeId");
  if (scopeId.length > 512) throw new Error("Sandbox scopeId is too long");
  const sessionId = requireString(raw.sessionId, "sessionId");
  const pluginId = requireString(raw.pluginId, "pluginId");
  const serverName = requireString(raw.serverName, "serverName");
  const ownerWebContentsId =
    typeof raw.ownerWebContentsId === "number" ? raw.ownerWebContentsId : 0;
  return {
    instance,
    ownerWebContentsId,
    sessionId,
    pluginId,
    serverName,
    scopeId,
    html,
    ...(typeof raw.workspacePath === "string" ? { workspacePath: raw.workspacePath } : {}),
    ...(typeof raw.workspaceIdentity === "string"
      ? { workspaceIdentity: raw.workspaceIdentity }
      : {}),
    ...(isRecord(raw.csp) ? { csp: normalizeCspInput(raw.csp) } : {}),
    ...(isRecord(raw.cspRelaxations)
      ? { cspRelaxations: normalizeRelaxations(raw.cspRelaxations) }
      : {}),
    ...(Array.isArray(raw.permissions)
      ? { permissions: normalizePermissions(raw.permissions) }
      : {}),
    ...(typeof raw.prefersBorder === "boolean" ? { prefersBorder: raw.prefersBorder } : {}),
    ...(typeof raw.heightHint === "number" ? { heightHint: raw.heightHint } : {}),
    ...(typeof raw.minFrameHeight === "number" ? { minFrameHeight: raw.minFrameHeight } : {}),
    ...(typeof raw.showInline === "boolean" ? { showInline: raw.showInline } : {}),
  };
}

function normalizePermissions(raw: unknown[]): PluginSandboxRegisterInput["permissions"] {
  const known = new Set(["camera", "microphone", "geolocation", "clipboardWrite"]);
  const filtered = raw.filter(
    (item): item is NonNullable<PluginSandboxRegisterInput["permissions"]>[number] =>
      typeof item === "string" && known.has(item),
  );
  return filtered.length > 0 ? [...new Set(filtered)] : undefined;
}

/** renderer 只能透传资源声明的放宽项；未知键与非布尔值在进入 CSP 前丢弃。 */
function normalizeRelaxations(
  raw: Record<string, unknown>,
): PluginSandboxRegisterInput["cspRelaxations"] {
  return {
    ...(raw.unsafeEval === true ? { unsafeEval: true } : {}),
    ...(raw.wasmUnsafeEval === true ? { wasmUnsafeEval: true } : {}),
  };
}

/** CSP 域数组只保留字符串；origin 归一化仍由 buildPluginSandboxCsp 完成。 */
function normalizeCspInput(raw: Record<string, unknown>): PluginSandboxRegisterInput["csp"] {
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : undefined;
  return {
    ...(list(raw.connectDomains) ? { connectDomains: list(raw.connectDomains) } : {}),
    ...(list(raw.resourceDomains) ? { resourceDomains: list(raw.resourceDomains) } : {}),
    ...(list(raw.frameDomains) ? { frameDomains: list(raw.frameDomains) } : {}),
    ...(list(raw.baseUriDomains) ? { baseUriDomains: list(raw.baseUriDomains) } : {}),
  };
}

function parseInstance(raw: unknown): McpAppInstance {
  if (!isRecord(raw)) throw new Error("Invalid sandbox instance");
  const runtimeId = requireString(raw.runtimeId, "instance.runtimeId");
  const token = requireString(raw.token, "instance.token");
  const generation = raw.generation;
  const appIdentity = requireString(raw.appIdentity, "instance.appIdentity");
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation <= 0) {
    throw new Error("Invalid sandbox instance generation");
  }
  if (!/^[a-f0-9]{64}$/.test(appIdentity)) throw new Error("Invalid sandbox app identity");
  return { runtimeId, generation, token, appIdentity };
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${key}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
