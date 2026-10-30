import type { McpToolDescriptor } from "@ycode/contracts";
import {
  buildMcpAppsManifest,
  mergeMcpAppsManifest,
  normalizeMcpAppResourceMeta,
  resolveMcpAppsResourceMimeType,
  validateMcpAppsHtmlResource,
  type McpAppsManifest,
  type McpToolUiDescriptor,
} from "@ycode/shared/mcp-apps";
import type {
  McpAppUiResource,
  McpUiPluginScope,
  McpUiSessionAccess,
} from "./contract.js";
import { McpUiHtmlRejectedError, McpUiServerScopeError, McpUiToolAccessError } from "./contract.js";
import { assertMcpUiServerScope } from "./handlers.js";

/** Host discovery 的一条结果：哪个 server / 工具暴露了哪个 UI 资源。 */
export interface DiscoveredMcpAppTool {
  serverName: string;
  toolName: string;
  modelName: string;
  /** 工具 `_meta` 归一化后的 UI 描述。 */
  ui: McpToolUiDescriptor;
  /** 仅凭工具 `_meta` 得到的 manifest；资源级 CSP / permissions 需读取资源后合并。 */
  manifest: McpAppsManifest;
}

/**
 * discovery：从 tools/list 的已归一化 descriptor 中挑出声明了 `ui://` 资源的工具。
 * 纯函数，零 IO。可见性不含 "model" 的工具也保留——页面仍可渲染，只是模型看不到。
 */
export function discoverMcpAppsFromTools(
  descriptors: readonly McpToolDescriptor[],
): DiscoveredMcpAppTool[] {
  const result: DiscoveredMcpAppTool[] = [];
  for (const descriptor of descriptors) {
    if (!descriptor.ui) continue;
    result.push({
      serverName: descriptor.serverName,
      toolName: descriptor.toolName,
      modelName: descriptor.name ?? descriptor.toolName,
      ui: descriptor.ui,
      manifest: mergeMcpAppsManifest(descriptor.ui, null),
    });
  }
  return result;
}

/**
 * 读取一个工具的 MCP App 资源并完成安全校验：
 * - server 必须属于本 session（fail closed）；
 * - 工具必须存在且 `visibility` 含 "app"（页面才有资格拉起它）；
 * - `resourceUri` 必须与工具 `_meta` 声明一致（防止页面自行指定任意资源）；
 * - HTML mimeType 只接受 MCP App / text/html，大小 ≤ 16 MiB。
 * 返回的 HTML 交给桌面 sandbox 登记；本函数不持久化、不缓存。
 */
export async function readMcpAppUiResource(
  access: McpUiSessionAccess,
  scope: McpUiPluginScope & { toolName: string; resourceUri: string },
  options?: { signal?: AbortSignal },
): Promise<McpAppUiResource> {
  await assertMcpUiServerScope(access, scope);
  const visibility = await access.getToolVisibility(scope.serverName, scope.toolName);
  if (!visibility) {
    throw new McpUiToolAccessError("tool_not_found", scope.serverName, scope.toolName);
  }
  if (!visibility.includes("app")) {
    throw new McpUiToolAccessError("tool_not_app_visible", scope.serverName, scope.toolName);
  }
  const ui = await access.getToolUi(scope.serverName, scope.toolName);
  if (!ui || ui.resourceUri !== scope.resourceUri) {
    throw new McpUiToolAccessError("tool_not_found", scope.serverName, scope.toolName);
  }

  const result = await access.readResource(scope.serverName, scope.resourceUri, options);
  const content =
    result.contents.find((item) => item.uri === scope.resourceUri) ?? result.contents[0];
  if (!content) {
    throw new McpUiHtmlRejectedError("not_found", scope.resourceUri, {
      serverName: scope.serverName,
    });
  }
  const html = content.text ?? decodeBase64Utf8(content.blob);
  if (html === null) {
    throw new McpUiHtmlRejectedError("not_found", scope.resourceUri, {
      reason: "resource has neither text nor blob",
    });
  }
  const mimeType = resolveMcpAppsResourceMimeType(content.mimeType);
  const validation = validateMcpAppsHtmlResource({ mimeType, html });
  if (!validation.ok) {
    throw new McpUiHtmlRejectedError(validation.reason, scope.resourceUri, validation.detail);
  }

  const resourceMeta = normalizeMcpAppResourceMeta(content._meta);
  const manifest = mergeMcpAppsManifest(ui, resourceMeta);
  return {
    resourceUri: manifest.resourceUri,
    mimeType,
    html,
    bytes: validation.bytes,
    permissions: manifest.permissions,
    ...(manifest.csp ? { csp: manifest.csp } : {}),
    ...(manifest.cspRelaxations ? { cspRelaxations: manifest.cspRelaxations } : {}),
    prefersBorder: manifest.prefersBorder,
    ...(manifest.heightHint !== undefined ? { heightHint: manifest.heightHint } : {}),
    ...(manifest.minFrameHeight !== undefined ? { minFrameHeight: manifest.minFrameHeight } : {}),
    showInline: manifest.showInline,
    ...(manifest.surface ? { surface: manifest.surface } : {}),
  };
}

/**
 * 仅凭工具与资源 `_meta` 构造 manifest（不读 HTML）。宿主 bridge 在资源条目已缓存 `_meta` 时复用。
 */
export function readMcpAppsManifest(
  toolMeta: unknown,
  resourceMeta?: unknown,
): McpAppsManifest | null {
  return buildMcpAppsManifest({ toolMeta, resourceMeta });
}

/** 资源可为 text（UTF-8）或 blob（base64）。坏 base64 返回 null，让上层按"找不到内容"拒绝。 */
function decodeBase64Utf8(blob: string | undefined): string | null {
  if (blob === undefined) return null;
  try {
    return Buffer.from(blob, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export { McpUiServerScopeError };
