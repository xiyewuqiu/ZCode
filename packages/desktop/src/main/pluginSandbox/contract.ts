import type {
  McpAppCspRelaxations,
  McpAppsResourcePermission,
  PluginSandboxHandle,
  PluginSandboxPlatformPort,
  PluginSandboxRegisterInput,
} from "@ycode/shared/mcp-apps";
import { createHash } from "node:crypto";

/** privileged scheme 与 URL / partition 派生规则。 */
export const PLUGIN_SANDBOX_SCHEME = "ycode-sandbox";
/** relay shell 的 host 前缀；页面在它的 iframe 里运行，shell 负责 MessagePort ↔ iframe postMessage。 */
export const PLUGIN_SANDBOX_SHELL_HOST_PREFIX = "shell-";
export const PLUGIN_SANDBOX_PLUGIN_HOST_PREFIX = "plugin-";
/**
 * `persist:` 使 localStorage / IndexedDB 跨卡片、跨重启保留（页面状态恢复模式成立）。
 * stable origin 由可信 appIdentity 派生，随机 sandboxId 只出现在资源路径。
 */
export const PLUGIN_SANDBOX_PARTITION_PREFIX = "persist:plugin-sandbox-v1-";

/**
 * webview 的顶层文档是受信 relay shell（shell-<appIdentity>），插件 HTML 在它的 iframe（plugin-<appIdentity>）里。
 * 两个 origin 共享同一 partition，但保持跨源：页面即使拿到 shell 的消息也无法直接定义宿主 DOM。
 */
export function buildPluginSandboxShellUrl(sandboxId: string, appIdentity: string): string {
  return `${PLUGIN_SANDBOX_SCHEME}://${PLUGIN_SANDBOX_SHELL_HOST_PREFIX}${appIdentity}/instance/${sandboxId}/`;
}
export function buildPluginSandboxPluginOrigin(appIdentity: string): string {
  return `${PLUGIN_SANDBOX_SCHEME}://${PLUGIN_SANDBOX_PLUGIN_HOST_PREFIX}${appIdentity}`;
}
export function buildPluginSandboxPluginUrl(sandboxId: string, appIdentity: string): string {
  return `${buildPluginSandboxPluginOrigin(appIdentity)}/instance/${sandboxId}/index.html`;
}
/** Agent 可信 App 身份已经包含来源、工作区、环境及已知账号；不接受页面自报来源。 */
export function buildPluginSandboxPartition(input: { appIdentity: string }): string {
  const hash = createHash("sha256").update(input.appIdentity).digest("hex");
  return `${PLUGIN_SANDBOX_PARTITION_PREFIX}${hash}`;
}

export type { PluginSandboxRegisterInput } from "@ycode/shared/mcp-apps";

export interface PluginSandboxRecord extends PluginSandboxHandle {
  workspacePath?: string;
  workspaceIdentity?: string;
  ownerWebContentsId: number;
  sessionId: string;
  pluginId?: string;
  serverName?: string;
  scopeId: string;
  html: string;
  /** 由 csp 与 cspRelaxations 派生的完整 Content-Security-Policy 头值。 */
  cspHeader: string;
  cspRelaxations?: McpAppCspRelaxations;
  /** 资源声明的浏览器权限；Permissions-Policy 与权限闸门都以它为准。 */
  permissions?: McpAppsResourcePermission[];
  prefersBorder: boolean;
}

/**
 * 沙箱注册表：main 进程中沙箱内容与生命周期的唯一 owner。
 * `register` 以完整归属与 Agent token 幂等；同凭证内容不可变，重复调用返回同一 sandboxId/initId。
 */
export interface PluginSandboxRegistryPort {
  /** 容量满且全部登记都有活 guest 时抛 `PluginSandboxQuotaError`，不淘汰活实例。 */
  register(input: PluginSandboxRegisterInput): PluginSandboxHandle;
  get(sandboxId: string): PluginSandboxRecord | null;
  /** initId 给出且与当前登记不一致时不释放（旧 controller 的迟到 dispose）。 */
  dispose(sandboxId: string, initId?: number): void;
  /** 释放某个宿主 webContents 名下全部登记（窗口关闭 / 崩溃）。 */
  disposeOwner(ownerWebContentsId: number): void;
  /** guest 挂上 +1、销毁 −1；pinned > 0 的登记不参与 TTL 与容量淘汰。 */
  pin(sandboxId: string): void;
  unpin(sandboxId: string): void;
  /** guest 有输入事件时由 guest 策略调用；token TTL 5 秒。 */
  markUserGesture(sandboxId: string): void;
  consumeUserGesture(sandboxId: string): boolean;
}

/** renderer 侧端口以 `IPlatformService.pluginSandbox` 挂载；类型定义在 shared，这里只保留别名。 */
export type IPluginSandboxPlatform = PluginSandboxPlatformPort;

/** 注册表容量已满且全部是活实例；renderer 收到后停在错误态并提示，不淘汰别的卡片。 */
export class PluginSandboxQuotaError extends Error {
  readonly code = "sandbox_quota" as const;
  constructor(maxEntries: number) {
    super(`MCP App 数量已达上限（${maxEntries}），请先关闭其他插件卡片。`);
    this.name = "PluginSandboxQuotaError";
  }
}
