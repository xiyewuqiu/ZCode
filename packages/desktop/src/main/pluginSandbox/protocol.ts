import type { PluginSandboxRegistryPort } from "./contract.js";
import {
  PLUGIN_SANDBOX_PLUGIN_HOST_PREFIX,
  PLUGIN_SANDBOX_SCHEME,
  PLUGIN_SANDBOX_SHELL_HOST_PREFIX,
  buildPluginSandboxPluginOrigin,
  buildPluginSandboxPluginUrl,
} from "./contract.js";
import { buildPluginSandboxPermissionsPolicy, buildPluginSandboxShellCsp } from "./csp.js";

export interface PluginSandboxSchemeRegistrar {
  registerSchemesAsPrivileged(
    schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>,
  ): void;
}

/** 与 ycode-media 必须在同一次 registerSchemesAsPrivileged 调用里注册（第二次调用会覆盖第一次）。 */
export const PLUGIN_SANDBOX_PRIVILEGED_SCHEME = {
  scheme: PLUGIN_SANDBOX_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
} as const;

export interface PluginSandboxProtocolHost {
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void;
  unhandle(scheme: string): void;
  isProtocolHandled(scheme: string): boolean;
}

export type PluginSandboxRequestKind = "shell" | "plugin";

export interface PluginSandboxRequestTarget {
  kind: PluginSandboxRequestKind;
  sandboxId: string;
  pathname: string;
}

/** 解析 ycode-sandbox:// URL；host 不匹配前缀、带凭据或端口一律 null。 */
export function parsePluginSandboxUrl(rawUrl: string): PluginSandboxRequestTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${PLUGIN_SANDBOX_SCHEME}:` || url.port || url.username || url.password) {
    return null;
  }
  const kind: PluginSandboxRequestKind | null = url.hostname.startsWith(
    PLUGIN_SANDBOX_SHELL_HOST_PREFIX,
  )
    ? "shell"
    : url.hostname.startsWith(PLUGIN_SANDBOX_PLUGIN_HOST_PREFIX)
      ? "plugin"
      : null;
  if (!kind || !url.pathname.startsWith("/instance/")) return null;
  const sandboxId = url.pathname.split("/")[2];
  if (!sandboxId) return null;
  return {
    kind,
    sandboxId,
    pathname: "/" + url.pathname.split("/").slice(3).join("/"),
  };
}

const HTML_MIME_TYPE = "text/html; charset=utf-8";

/**
 * 资源协议：
 * - `shell-<appIdentity>/instance/<id>/`：受信 relay shell，只内联一段转发脚本并创建插件 iframe；
 * - `plugin-<appIdentity>/instance/<id>/index.html`：登记的 MCP App HTML（CSP / Permissions-Policy 按资源声明）。
 * 未知路径一律 404；所有响应 no-store，避免稳定 origin 的缓存绕过 guest 归属检查。
 */
export function createPluginSandboxProtocolHandler(options: {
  registry: PluginSandboxRegistryPort;
  logger?: { warn: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = handleRequest(request, options.registry);
    response.headers.set("Cache-Control", "no-store");
    const line = `[plugin-sandbox] ${request.method} ${request.url} -> ${response.status}`;
    if (response.status >= 400) options.logger?.warn(line);
    else options.logger?.info?.(line);
    return response;
  };
}

function handleRequest(request: Request, registry: PluginSandboxRegistryPort): Response {
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const target = parsePluginSandboxUrl(request.url);
  if (!target) return new Response(null, { status: 404 });
  const record = registry.get(target.sandboxId);
  if (!record) return new Response(null, { status: 404 });
  const expectedHost = `${target.kind}-${record.instance.appIdentity}`;
  if (new URL(request.url).hostname !== expectedHost) return new Response(null, { status: 404 });
  if (target.pathname !== "/" && target.pathname !== "/index.html") {
    return new Response(null, { status: 404 });
  }
  const shellPermissionsPolicy = buildPluginSandboxPermissionsPolicy(record.permissions, "shell");
  const pluginPermissionsPolicy = buildPluginSandboxPermissionsPolicy(record.permissions, "plugin");
  if (target.kind === "shell") {
    return new Response(
      buildPluginSandboxShellHtml(record.instance.appIdentity, record.sandboxId),
      {
        status: 200,
        headers: {
          "Content-Type": HTML_MIME_TYPE,
          "Content-Security-Policy": buildPluginSandboxShellCsp(),
          "Permissions-Policy": shellPermissionsPolicy,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
  return new Response(record.html, {
    status: 200,
    headers: {
      "Content-Type": HTML_MIME_TYPE,
      "Content-Security-Policy": record.cspHeader,
      "Permissions-Policy": pluginPermissionsPolicy,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * 受信 relay shell。它不解析协议：MessagePort → iframe、iframe → MessagePort 原样转发。
 * 只接受同 window 的 init 帧（preload 转交）与 plugin origin 的 iframe 消息；其他来源全部丢弃。
 */
export function buildPluginSandboxShellHtml(appIdentity: string, sandboxId: string): string {
  const pluginOrigin = buildPluginSandboxPluginOrigin(appIdentity);
  const pluginUrl = buildPluginSandboxPluginUrl(sandboxId, appIdentity);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>YCode MCP App Sandbox</title>
<style>
html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}
#root iframe{display:block;border:0;width:100%;height:100%}
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  "use strict";
  var PLUGIN_ORIGIN = ${JSON.stringify(pluginOrigin)};
  var PLUGIN_URL = ${JSON.stringify(pluginUrl)};
  var ALLOWED = { camera: true, microphone: true, geolocation: true, "clipboard-write": true };
  var root = document.getElementById("root");
  var port = null;
  var frame = null;
  function sanitizeAllow(value) {
    if (typeof value !== "string") return "";
    var seen = {};
    var output = [];
    value.split(";").forEach(function (token) {
      var item = token.trim();
      if (ALLOWED[item] && !seen[item]) {
        seen[item] = true;
        output.push(item);
      }
    });
    return output.join("; ");
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source === window && event.origin === window.location.origin && data &&
        data.type === "ycode-plugin-sandbox-init" && event.ports && event.ports.length === 1) {
      var incoming = event.ports[0];
      if (port) {
        incoming.close();
        return;
      }
      port = incoming;
      frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
      var allow = sanitizeAllow(data.allow);
      if (allow) frame.setAttribute("allow", allow);
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("title", "MCP App");
      frame.src = PLUGIN_URL;
      root.appendChild(frame);
      port.onmessage = function (messageEvent) {
        if (frame && frame.contentWindow) frame.contentWindow.postMessage(messageEvent.data, PLUGIN_ORIGIN);
      };
      if (port.start) port.start();
      return;
    }
    if (frame && event.source === frame.contentWindow && event.origin === PLUGIN_ORIGIN) {
      if (port) port.postMessage(data);
    }
  });
})();
</script>
</body>
</html>`;
}

const installedProtocols = new WeakSet<PluginSandboxProtocolHost>();

export function installPluginSandboxProtocol(
  protocol: PluginSandboxProtocolHost,
  handler: (request: Request) => Promise<Response>,
): void {
  if (installedProtocols.has(protocol)) return;
  protocol.handle(PLUGIN_SANDBOX_SCHEME, handler);
  installedProtocols.add(protocol);
}

export function uninstallPluginSandboxProtocol(protocol: PluginSandboxProtocolHost): void {
  if (!installedProtocols.has(protocol)) return;
  if (protocol.isProtocolHandled(PLUGIN_SANDBOX_SCHEME)) protocol.unhandle(PLUGIN_SANDBOX_SCHEME);
  installedProtocols.delete(protocol);
}
