/**
 * MCP Apps 页面 ↔ 宿主 renderer 的 `ui/*` 线协议：方法名、握手结果、宿主上下文 / 能力与 JSON-RPC 帧。
 * 参数形状与官方 `@modelcontextprotocol/ext-apps` 同构；这里只保留宿主与 relay 必需的最小字段集。
 * 页面与宿主共享这些类型，避免 UI 与 sandbox 各写一份字符串常量。
 */

import type { McpAppsDisplayMode } from "./contract.js";
import type { McpAppsHostTitleBar, McpAppsStyleVariables } from "./hostContract.js";

export const MCP_APPS_JSON_RPC_VERSION = "2.0" as const;

/** 页面 → 宿主`ui/*` 方法名（规范）。 */
export const MCP_APPS_UI_METHODS = {
  initialize: "ui/initialize",
  initialized: "ui/notifications/initialized",
  openLink: "ui/open-link",
  requestDisplayMode: "ui/request-display-mode",
  sizeChanged: "ui/notifications/size-changed",
  hostContextChanged: "ui/notifications/host-context-changed",
  toolInput: "ui/notifications/tool-input",
  toolResult: "ui/notifications/tool-result",
  toolCancelled: "ui/notifications/tool-cancelled",
  resourceTeardown: "ui/resource-teardown",
  message: "ui/message",
  updateModelContext: "ui/update-model-context",
  downloadFile: "ui/download-file",
  requestTeardown: "ui/notifications/request-teardown",
} as const;

/** 页面与宿主都会用到的 MCP 方法（页面调宿主、宿主调页面两个方向）。 */
export const MCP_APPS_MCP_METHODS = {
  ping: "ping",
  toolsList: "tools/list",
  toolsCall: "tools/call",
  toolsListChanged: "notifications/tools/list_changed",
  resourcesRead: "resources/read",
  resourcesList: "resources/list",
  resourcesTemplatesList: "resources/templates/list",
  resourcesSubscribe: "resources/subscribe",
  resourcesUnsubscribe: "resources/unsubscribe",
  resourcesUpdated: "notifications/resources/updated",
  resourcesListChanged: "notifications/resources/list_changed",
  loggingMessage: "notifications/message",
} as const;

/** `initialize` 协商的协议版本；宿主回显页面请求的版本，不强制升级。 */
export const MCP_APPS_DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export type McpAppsJsonRpcId = string | number;

export interface McpAppsJsonRpcRequest {
  jsonrpc: typeof MCP_APPS_JSON_RPC_VERSION;
  id: McpAppsJsonRpcId;
  method: string;
  params?: unknown;
}
export interface McpAppsJsonRpcNotification {
  jsonrpc: typeof MCP_APPS_JSON_RPC_VERSION;
  method: string;
  params?: unknown;
}
export interface McpAppsJsonRpcSuccess {
  jsonrpc: typeof MCP_APPS_JSON_RPC_VERSION;
  id: McpAppsJsonRpcId;
  result: unknown;
}
export interface McpAppsJsonRpcError {
  jsonrpc: typeof MCP_APPS_JSON_RPC_VERSION;
  id: McpAppsJsonRpcId;
  error: { code: number; message: string; data?: unknown };
}
export type McpAppsJsonRpcMessage =
  | McpAppsJsonRpcRequest
  | McpAppsJsonRpcNotification
  | McpAppsJsonRpcSuccess
  | McpAppsJsonRpcError;

export function isMcpAppsJsonRpcMessage(value: unknown): value is McpAppsJsonRpcMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== MCP_APPS_JSON_RPC_VERSION) return false;
  const hasId = typeof record.id === "string" || typeof record.id === "number";
  if (typeof record.method === "string") return true;
  return hasId && ("result" in record || "error" in record);
}

export interface McpAppsContainerDimensions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface McpAppsSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface McpAppsDeviceCapabilities {
  hover?: boolean;
  touch?: boolean;
}

/**
 * 宿主上下文。规范字段之外允许附加键（扩展经 experimental 能力宣告）；
 * `ycode/widgetState` 初值随握手下发，之后只由页面 `ui/set-widget-state` 写回宿主内存。
 */
export interface McpAppsHostContext {
  theme?: "light" | "dark";
  locale?: string;
  displayMode?: McpAppsDisplayMode;
  availableDisplayModes?: McpAppsDisplayMode[];
  platform?: "desktop" | "web" | "mobile";
  userAgent?: string;
  timeZone?: string;
  containerDimensions?: McpAppsContainerDimensions;
  safeAreaInsets?: McpAppsSafeAreaInsets;
  deviceCapabilities?: McpAppsDeviceCapabilities;
  styles?: { variables?: McpAppsStyleVariables };
  toolInfo?: {
    tool?: { name: string; description?: string; inputSchema?: unknown };
  };
  titleBar?: McpAppsHostTitleBar;
  [key: string]: unknown;
}

/** 宿主能力：声明与处理器一一对应；未声明的能力页面必须降级。 */
export interface McpAppsHostCapabilities {
  openLinks?: Record<string, never>;
  serverTools?: Record<string, never>;
  serverResources?: { listChanged?: boolean };
  logging?: Record<string, never>;
  sampling?: Record<string, never>;
  downloadFile?: Record<string, never>;
  message?: { text?: Record<string, never>; image?: Record<string, never> };
  updateModelContext?: {
    text?: Record<string, never>;
    structuredContent?: Record<string, never>;
    image?: Record<string, never>;
  };
  experimental?: Record<string, unknown>;
}

/** 页面在 `ui/initialize` 里自报的能力。 */
export interface McpAppsAppCapabilities {
  availableDisplayModes?: McpAppsDisplayMode[];
  tools?: { listChanged?: boolean };
  [key: string]: unknown;
}

export interface McpAppsInitializeParams {
  protocolVersion?: string;
  appInfo?: { name?: string; version?: string };
  appCapabilities?: McpAppsAppCapabilities;
  [key: string]: unknown;
}

export interface McpAppsInitializeResult {
  protocolVersion: string;
  hostInfo: { name: string; version: string };
  hostCapabilities: McpAppsHostCapabilities;
  hostContext: McpAppsHostContext;
}

export interface McpAppsRequestDisplayModeParams {
  mode: McpAppsDisplayMode;
}
export interface McpAppsRequestDisplayModeResult {
  mode: McpAppsDisplayMode;
}
export interface McpAppsSizeChangedParams {
  width?: number;
  height?: number;
}
export interface McpAppsOpenLinkParams {
  url: string;
}
export interface McpAppsSetWidgetStateParams {
  widgetState: unknown;
}
export interface McpAppsToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/** JSON-RPC 标准错误码的宿主侧映射。 */
export const MCP_APPS_JSON_RPC_ERRORS = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  resourceRejected: -32001,
} as const;

export function mcpAppsRpcError(
  code: number,
  message: string,
  data?: unknown,
): { code: number; message: string; data?: unknown } {
  return data === undefined ? { code, message } : { code, message, data };
}
