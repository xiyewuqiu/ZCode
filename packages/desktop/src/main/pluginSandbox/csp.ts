import type {
  McpAppCspRelaxations,
  McpAppsResourcePermission,
  McpToolUiCsp,
} from "@ycode/shared/mcp-apps";
import { normalizeCspOrigin } from "@ycode/shared/mcp-apps";
import { buildPluginSandboxShellUrl } from "./contract.js";

/**
 * App 文档的 CSP：缺省严格按 MCP Apps 规范块（`default-src 'none'; script-src 'self' 'unsafe-inline'; …`），
 * 四类域只放行资源 `_meta.ui.csp` 声明的 origin（规范 MUST NOT 放行未声明域）。
 * inline script / style 必须放行——MCP Apps 的 HTML 资源普遍内联脚本，隔离边界是独立 partition +
 * 独立 origin + webview sandbox，而不是禁止内联。`'unsafe-eval'` / `'wasm-unsafe-eval'` 不缺省放行。
 */
export function buildPluginSandboxCsp(input: {
  csp?: McpToolUiCsp;
  cspRelaxations?: McpAppCspRelaxations;
  sandboxId: string;
  appIdentity: string;
}): string {
  const resource = normalizeOrigins(input.csp?.resourceDomains);
  const connect = normalizeOrigins(input.csp?.connectDomains);
  const frame = normalizeOrigins(input.csp?.frameDomains);
  const baseUri = normalizeOrigins(input.csp?.baseUriDomains);
  if (!PLUGIN_SANDBOX_CSP_HOST_SAFE_ID.test(input.sandboxId)) {
    // 非法字符会让 frame-ancestors 静默变成 'none'，这里直接拒绝而不是产出坏头。
    throw new Error(`plugin sandbox id is not CSP host-safe: ${input.sandboxId}`);
  }
  if (!/^[a-f0-9]{64}$/.test(input.appIdentity)) {
    throw new Error("plugin sandbox app identity must be a sha256 hex string");
  }
  // 自定义 scheme 的 URL.origin 固定是 "null"，CSP host-source 必须用 protocol//host 手工拼。
  const documentUrl = new URL(buildPluginSandboxShellUrl(input.sandboxId, input.appIdentity));
  const documentOrigin = `${documentUrl.protocol}//${documentUrl.host}`;
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "blob:",
    "data:",
    ...(input.cspRelaxations?.unsafeEval ? ["'unsafe-eval'"] : []),
    ...(input.cspRelaxations?.wasmUnsafeEval ? ["'wasm-unsafe-eval'"] : []),
    ...resource,
  ];
  return [
    "default-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${["'self'", "'unsafe-inline'", ...resource].join(" ")}`,
    `img-src ${["'self'", "data:", "blob:", ...resource].join(" ")}`,
    `media-src ${["'self'", "data:", "blob:", ...resource].join(" ")}`,
    `font-src ${["'self'", "data:", ...resource].join(" ")}`,
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
    `frame-src ${frame.length > 0 ? frame.join(" ") : "'none'"}`,
    `base-uri ${["'self'", ...baseUri].join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    // 插件 iframe 只允许被同 sandbox 的受信 shell 嵌套。
    `frame-ancestors ${documentOrigin}`,
    "form-action 'none'",
  ].join("; ");
}

/** CSP host-source 的 host 字符集（ALPHA / DIGIT / "-"）。 */
export const PLUGIN_SANDBOX_CSP_HOST_SAFE_ID = /^[A-Za-z0-9-]+$/;

/** 受信 relay shell：只加载自身与插件 iframe，不联网；shell 脚本由 main 生成并内联。 */
export function buildPluginSandboxShellCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "frame-src ycode-sandbox:",
    "connect-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export const PLUGIN_SANDBOX_PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "display-capture=()",
  "payment=()",
  "usb=()",
  "clipboard-read=()",
].join(", ");

/**
 * 按资源声明放宽 Permissions-Policy：shell 文档对声明的特性用 `*`（它只嵌本沙箱的插件 iframe，
 * 自定义 scheme 的 origin 串 Chromium 不一定接受），插件文档用 `(self)`；未声明的一律 `()`。
 */
export function buildPluginSandboxPermissionsPolicy(
  permissions: readonly McpAppsResourcePermission[] | undefined,
  document: "shell" | "plugin" = "plugin",
): string {
  const granted = new Set(permissions ?? []);
  const allow = document === "shell" ? "*" : "(self)";
  return [
    `camera=${granted.has("camera") ? allow : "()"}`,
    `microphone=${granted.has("microphone") ? allow : "()"}`,
    `geolocation=${granted.has("geolocation") ? allow : "()"}`,
    "display-capture=()",
    "payment=()",
    "usb=()",
    "clipboard-read=()",
  ].join(", ");
}

function normalizeOrigins(list: string[] | undefined): string[] {
  if (!list) return [];
  const origins = list
    .map(normalizeCspOrigin)
    .filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}
