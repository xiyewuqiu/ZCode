import {
  MCP_APPS_HTML_MAX_BYTES,
  MCP_APPS_HTML_MIME_TYPES,
  MCP_APPS_RESOURCE_MIME_TYPE,
  type McpAppCspRelaxations,
  type McpAppResourceMeta,
  type McpAppsDisplayMode,
  type McpAppsResourcePermission,
  type McpToolUiCsp,
  type McpToolUiDescriptor,
  type PluginSandboxRegisterInput,
} from "./contract.js";
import type { McpAppInstance } from "./instance.js";
import { normalizeMcpAppResourceMeta, normalizeMcpToolUiMeta } from "./toolMeta.js";

/**
 * MCP Apps manifest 的有效视图：工具 `_meta` 声明「哪个资源」，资源 `_meta` 补充「怎么运行」。
 * 纯 domain，零 IO；宿主在读到资源 HTML 后用它校验并构造沙箱登记。
 */
export interface McpAppsManifest {
  resourceUri: string;
  visibility: Array<"model" | "app">;
  preferredDisplayMode?: McpAppsDisplayMode;
  /** 资源级 CSP 优先，工具级 `_meta.ui.csp` 只在资源没有声明时兜底。 */
  csp?: McpToolUiCsp;
  cspRelaxations?: McpAppCspRelaxations;
  permissions: McpAppsResourcePermission[];
  prefersBorder: boolean;
  heightHint?: number;
  minFrameHeight?: number;
  showInline: boolean;
  surface?: string;
}

/**
 * 合并工具与资源的 `_meta`。resourceUri 非法时返回 null（等同于没有 MCP App）；
 * 其余字段任何一项非法只丢弃该项，绝不部分接受一个坏 manifest。
 */
export function buildMcpAppsManifest(input: {
  toolMeta: unknown;
  resourceMeta?: unknown;
}): McpAppsManifest | null {
  const tool = normalizeMcpToolUiMeta(input.toolMeta);
  if (!tool) return null;
  const resource = normalizeMcpAppResourceMeta(input.resourceMeta);
  return mergeMcpAppsManifest(tool, resource);
}

/** 已归一化的工具 / 资源描述合并；宿主侧 bridge 复用同一规则，避免两处漂移。 */
export function mergeMcpAppsManifest(
  tool: McpToolUiDescriptor,
  resource: McpAppResourceMeta | null,
): McpAppsManifest {
  return {
    resourceUri: tool.resourceUri,
    visibility: tool.visibility ?? ["model", "app"],
    ...(tool.preferredDisplayMode ? { preferredDisplayMode: tool.preferredDisplayMode } : {}),
    ...(resource?.csp ? { csp: resource.csp } : tool.csp ? { csp: tool.csp } : {}),
    ...(resource?.cspRelaxations ? { cspRelaxations: resource.cspRelaxations } : {}),
    permissions: [...(resource?.permissions ?? [])],
    // 资源级声明优先；资源没声明时回退工具级。
    prefersBorder: resource?.prefersBorder ?? tool.prefersBorder ?? false,
    ...(resource?.heightHint !== undefined ? { heightHint: resource.heightHint } : {}),
    ...(resource?.minFrameHeight !== undefined ? { minFrameHeight: resource.minFrameHeight } : {}),
    showInline: resource?.showInline ?? tool.showInline ?? false,
    ...(tool.surface ? { surface: tool.surface } : {}),
  };
}

export type McpAppsHtmlValidation =
  | { ok: true; bytes: number }
  | { ok: false; reason: "mime_not_allowed" | "too_large"; detail: Record<string, unknown> };

/**
 * `ui://` HTML 资源校验：只接受规范 mimeType 与 `text/html`，按 UTF-8 字节封顶 16 MiB。
 * 未知 mimeType 一律拒绝，不做内容嗅探。
 */
export function validateMcpAppsHtmlResource(input: {
  mimeType?: string;
  html: string;
}): McpAppsHtmlValidation {
  const essence = input.mimeType?.split(";")[0]?.trim().toLowerCase();
  if (
    essence !== undefined &&
    !MCP_APPS_HTML_MIME_TYPES.includes(essence as (typeof MCP_APPS_HTML_MIME_TYPES)[number])
  ) {
    return {
      ok: false,
      reason: "mime_not_allowed",
      detail: { mimeType: input.mimeType, expected: [...MCP_APPS_HTML_MIME_TYPES] },
    };
  }
  const bytes = utf8Bytes(input.html);
  if (bytes > MCP_APPS_HTML_MAX_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      detail: { bytes, maxBytes: MCP_APPS_HTML_MAX_BYTES },
    };
  }
  return { ok: true, bytes };
}

/**
 * 把 manifest + 已验证 HTML 转为 main 的登记输入。`requestId` 由传输层补齐；
 * 这里只生成稳定归属，便于 host 与 main 两侧共用同一构造。
 */
export function buildPluginSandboxRegisterInput(input: {
  manifest: McpAppsManifest;
  html: string;
  instance: McpAppInstance;
  ownerWebContentsId: number;
  sessionId: string;
  pluginId: string;
  serverName: string;
  scopeId: string;
  workspacePath?: string;
  workspaceIdentity?: string;
}): PluginSandboxRegisterInput {
  const { manifest } = input;
  return {
    instance: input.instance,
    ownerWebContentsId: input.ownerWebContentsId,
    sessionId: input.sessionId,
    pluginId: input.pluginId,
    serverName: input.serverName,
    scopeId: input.scopeId,
    html: input.html,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
    ...(manifest.csp ? { csp: manifest.csp } : {}),
    ...(manifest.cspRelaxations ? { cspRelaxations: manifest.cspRelaxations } : {}),
    ...(manifest.permissions.length > 0 ? { permissions: manifest.permissions } : {}),
    ...(manifest.prefersBorder ? { prefersBorder: true } : {}),
    ...(manifest.heightHint !== undefined ? { heightHint: manifest.heightHint } : {}),
    ...(manifest.minFrameHeight !== undefined ? { minFrameHeight: manifest.minFrameHeight } : {}),
    ...(manifest.showInline ? { showInline: true } : {}),
  };
}

/** 默认资源 mimeType：资源条目没声明时按规范值处理（不拒绝）。 */
export function resolveMcpAppsResourceMimeType(mimeType: string | undefined): string {
  return mimeType ?? MCP_APPS_RESOURCE_MIME_TYPE;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
