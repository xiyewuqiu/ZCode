import { webContents, type Session } from "electron";
import type { PluginSandboxRegistryPort } from "./contract.js";
import type { PluginSandboxPermissionGate } from "./permissionGate.js";
import {
  createPluginSandboxProtocolHandler,
  installPluginSandboxProtocol,
  parsePluginSandboxUrl,
} from "./protocol.js";

const preparedSessions = new WeakSet<Session>();

/**
 * 每个可信 App 身份一个持久 partition（同一 server 的页面共享）。首次使用时把 partition session 锁死：
 * 装 protocol handler、权限交给闸门（未声明一律拒绝）、阻止下载、代理 direct。
 * desktopNetworkPolicy 只覆盖 defaultSession 与 embedded-browser partition，沙箱 session 必须自己设。
 */
export function preparePluginSandboxSession(input: {
  session: Session;
  registry: PluginSandboxRegistryPort;
  /** 缺省（单测 / 未装闸门）时拒绝全部权限。 */
  permissions?: PluginSandboxPermissionGate;
  logger?: { warn: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
}): void {
  const { session } = input;
  if (preparedSessions.has(session)) return;
  preparedSessions.add(session);
  installPluginSandboxProtocol(
    session.protocol,
    createPluginSandboxProtocolHandler({
      registry: input.registry,
      ...(input.logger ? { logger: input.logger } : {}),
    }),
  );
  // 稳定 origin 不能授予跨实例资源访问；以 Electron 提供的实际 guest 与路径登记交叉验证。
  session.webRequest.onBeforeRequest({ urls: [`ycode-sandbox://*/*`] }, (details, callback) => {
    const target = parsePluginSandboxUrl(details.url);
    const record = target && input.registry.get(target.sandboxId);
    if (!record) {
      callback({ cancel: true });
      return;
    }
    const guest =
      details.webContentsId === undefined ? undefined : webContents.fromId(details.webContentsId);
    const current = guest && parsePluginSandboxUrl(guest.getURL());
    const url = new URL(details.url);
    // 首次主文档在 getURL() 提交前就已发出；只在这个窗口放行，后续请求仍必须归属同一 guest。
    const initial =
      details.resourceType === "mainFrame" && (!current || current.sandboxId === target.sandboxId);
    callback({
      cancel:
        url.hostname !== `${target.kind}-${record.instance.appIdentity}` ||
        (!initial && current?.sandboxId !== record.sandboxId),
    });
  });
  const gate = input.permissions;
  session.setPermissionRequestHandler((guest, permission, callback, details) => {
    if (!gate) {
      input.logger?.warn(`[plugin-sandbox] permission blocked: ${permission}`);
      callback(false);
      return;
    }
    const guestUrl = guest.getURL();
    const frame = guest.mainFrame.frames.find((child) => child.url === details.requestingUrl);
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
    void gate
      .request({
        permission,
        guestUrl,
        isCurrent: () =>
          !guest.isDestroyed() &&
          guest.getURL() === guestUrl &&
          Boolean(frame && !frame.detached && guest.mainFrame.frames.includes(frame)),
        requestingUrl: details.requestingUrl,
        ...(mediaTypes ? { mediaTypes } : {}),
      })
      .then(callback, (error: unknown) => {
        input.logger?.warn(`[plugin-sandbox] permission request failed: ${String(error)}`);
        callback(false);
      });
  });
  session.setPermissionCheckHandler((guest, permission, requestingOrigin, details) => {
    if (!gate) return false;
    const mediaType = (details as { mediaType?: string }).mediaType;
    return gate.check({
      guestUrl: guest?.getURL(),
      permission,
      requestingOrigin,
      ...(mediaType ? { mediaType } : {}),
    });
  });
  session.on("will-download", (event) => {
    event.preventDefault();
    input.logger?.warn("[plugin-sandbox] download blocked");
  });
  void session.setProxy({ mode: "direct" }).catch(() => undefined);
}
