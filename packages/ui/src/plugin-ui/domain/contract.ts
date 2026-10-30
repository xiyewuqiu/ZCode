import type {
  McpAppInstance,
  McpAppsResourcePermission,
  McpToolDisplayUi,
} from "@ycode/shared/mcp-apps";

/**
 * 插件 UI 卡片的 domain 契约。display.ui 由 agent 投影到工具结果元数据；
 * 这里只做防御性读取与卡片模型构造，不引入 React 或平台实现。
 */
export interface PluginUiDisplay extends McpToolDisplayUi {}

/** 卡片可用的 app 源：HTML 与实例凭证由宿主 bridge 读取，UI 不自行拼接资源。 */
export interface PluginUiAppSource {
  html: string;
  instance: McpAppInstance;
}

/** 宿主注入的加载器：没有它就只能展示结构化结果摘要（仍不阻塞工具输出）。 */
export type PluginUiAppLoader = (display: PluginUiDisplay) => Promise<PluginUiAppSource | null>;

/**
 * 宿主 provider 绑定的会话 / 工作区身份。services 负责补齐 workspaceKey 与远程路由，
 * UI 适配器不手写身份格式。
 */
export interface PluginUiHostTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sessionId: string;
}

export type PluginUiPermission = McpAppsResourcePermission;

const PERMISSIONS: readonly McpAppsResourcePermission[] = [
  "camera",
  "microphone",
  "geolocation",
  "clipboardWrite",
];

/** 工具结果 raw.display 的归属身份；卡片头部用它展示 server / 工具名。 */
export function readPluginUiIdentity(rawDisplay: unknown): {
  serverName?: string;
  toolName?: string;
} {
  if (!isRecord(rawDisplay)) return {};
  return {
    ...(readString(rawDisplay.serverName) ? { serverName: readString(rawDisplay.serverName) } : {}),
    ...(readString(rawDisplay.toolName) ? { toolName: readString(rawDisplay.toolName) } : {}),
  };
}

/** 读取工具结果 raw.display.ui；非法/缺省返回 null。 */
export function readPluginUiDisplay(rawDisplay: unknown): PluginUiDisplay | null {
  if (!isRecord(rawDisplay) || rawDisplay.kind !== "mcp_tool") return null;
  const ui = rawDisplay.ui;
  if (!isRecord(ui)) return null;
  const pluginId = readString(ui.pluginId);
  const resourceUri = readString(ui.resourceUri);
  if (!pluginId || !resourceUri || !resourceUri.startsWith("ui://")) return null;
  const csp = isRecord(ui.csp)
    ? {
        ...(readStringArray(ui.csp.connectDomains)
          ? { connectDomains: readStringArray(ui.csp.connectDomains) }
          : {}),
        ...(readStringArray(ui.csp.resourceDomains)
          ? { resourceDomains: readStringArray(ui.csp.resourceDomains) }
          : {}),
        ...(readStringArray(ui.csp.frameDomains)
          ? { frameDomains: readStringArray(ui.csp.frameDomains) }
          : {}),
        ...(readStringArray(ui.csp.baseUriDomains)
          ? { baseUriDomains: readStringArray(ui.csp.baseUriDomains) }
          : {}),
      }
    : undefined;
  return {
    pluginId,
    resourceUri,
    ...(ui.preferredDisplayMode === "inline" ||
    ui.preferredDisplayMode === "fullscreen" ||
    ui.preferredDisplayMode === "pip"
      ? { preferredDisplayMode: ui.preferredDisplayMode }
      : {}),
    ...(typeof ui.prefersBorder === "boolean" ? { prefersBorder: ui.prefersBorder } : {}),
    ...(csp && Object.keys(csp).length > 0 ? { csp } : {}),
    ...(typeof ui.structuredContent === "string"
      ? { structuredContent: ui.structuredContent }
      : {}),
    ...(typeof ui.widgetMeta === "string" ? { widgetMeta: ui.widgetMeta } : {}),
    ...(typeof ui.content === "string" ? { content: ui.content } : {}),
    ...(ui.truncated === true ? { truncated: true } : {}),
    ...(typeof ui.truncatedBytes === "number" ? { truncatedBytes: ui.truncatedBytes } : {}),
    ...(ui.isError === true ? { isError: true } : {}),
    ...(ui.showInline === true ? { showInline: true } : {}),
    ...(readString(ui.surface) ? { surface: readString(ui.surface) } : {}),
  };
}

/** 读取权限声明（display.ui 不携带 permissions；保留给宿主 loader 注入模型）。 */
export function readPluginUiPermissions(value: unknown): PluginUiPermission[] {
  if (!Array.isArray(value)) return [];
  return PERMISSIONS.filter((permission) => value.includes(permission));
}

/** 结构化结果摘要：优先 structuredContent，其次原始 content 的文本块。 */
export function readPluginUiPreview(display: PluginUiDisplay): string | undefined {
  return display.structuredContent ?? display.content;
}

/** 把 display.ui 的 JSON 文本安全解析成对象；失败返回 undefined（不抛错）。 */
export function parsePluginUiJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * 宿主不可用的最早判定（纯函数，零 IO）：卡片 / 面板在 prepare 之前据此落到 fallback。
 * 与 `usePluginUiAppRuntime` 的 effect 保持同一顺序：平台 → 宿主端口 → session 绑定。
 */
export type PluginUiHostUnavailableReason = "no-platform" | "no-host" | "no-session";

export function resolvePluginUiHostUnavailableReason(input: {
  hasPlatform: boolean;
  hasHost: boolean;
  hasLegacyLoader: boolean;
  canRegisterSandbox: boolean;
  sessionId?: string;
}): PluginUiHostUnavailableReason | null {
  if (!input.hasPlatform) return "no-platform";
  if (!input.hasHost && !(input.hasLegacyLoader && input.canRegisterSandbox)) return "no-host";
  if (input.hasHost && !input.sessionId) return "no-session";
  return null;
}

/** fallback 原因展示：短码 + 宿主错误文本，不翻译内部协议名。 */
export function formatPluginUiFallbackReason(
  reason: string | undefined,
  message: string | undefined,
): string {
  const label = reason ?? "error";
  return message ? `${label}: ${message}` : label;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
