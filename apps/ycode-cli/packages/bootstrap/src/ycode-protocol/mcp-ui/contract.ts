/**
 * mcp-ui 契约：页面发起的 MCP 资源读取与工具调用在 agent 侧的处理器接口。
 * 这里只保留基础切片的归属范围、访问端口与错误映射；完整协议方法由 bootstrap 后续接线。
 */

import type { McpAppsResourcePermission } from "@ycode/shared/mcp-apps";

/** UI 请求的归属范围：会话 + MCP server（归属真相）+ pluginId（只做展示 / 日志）。 */
export interface McpUiPluginScope {
  workspace?: { workspacePath: string; workspaceIdentity?: string };
  instance: import("@ycode/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
}

export interface McpUiReadResourceParams extends McpUiPluginScope {
  uri: string;
}

export interface McpUiResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export interface McpUiReadResourceResult {
  contents: McpUiResourceContent[];
}

/** 页面发起的 resources/read 结果：无 `_meta`，每项 text 或 blob（base64）二选一。 */
export interface McpUiReadResourceForUiResult {
  contents: Array<Pick<McpUiResourceContent, "uri" | "mimeType" | "text" | "blob">>;
}

export interface McpUiCallToolParams extends McpUiPluginScope {
  toolName: string;
  arguments?: Record<string, unknown>;
  /** 宿主生成的必填调用 id；接纳、取消与终态去重共用。 */
  callId: string;
}

export interface McpUiCancelCallParams extends McpUiPluginScope {
  callId: string;
}
export interface McpUiCancelCallResult {
  /** false = 没有这个进行中的调用（已完成或尚未接纳）。 */
  cancelled: boolean;
}

export interface McpUiCallToolResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * 处理器依赖的最小 session 视图：由 bootstrap 的 session record 适配，
 * 处理器不直接接触 YCodeApp 或 mcpPort 的其余能力。
 */
export interface McpUiSessionAccess {
  /** serverName 是否是本 session 已配置的 MCP server（插件 server 与普通 MCP server 同一张表）。 */
  hasMcpServer(serverName: string): Promise<boolean>;
  /** 工具可见性（`_meta.ui.visibility` 归一化结果）；工具不存在返回 null。 */
  getToolVisibility(
    serverName: string,
    toolName: string,
  ): Promise<readonly ("model" | "app")[] | null>;
  /** 工具 `_meta` 归一化后的 UI 描述；用于发现 `ui://` 资源。 */
  getToolUi(
    serverName: string,
    toolName: string,
  ): Promise<import("@ycode/shared/mcp-apps").McpToolUiDescriptor | null>;
  readResource(
    serverName: string,
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceResult>;
  callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiCallToolResult>;
  /** 页面发起的 resources/read；大小与 mimeType 校验在处理器完成。 */
  readResourceForUi(
    serverName: string,
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceResult>;
  /**
   * 页面发起的 resources/list、templates/list 与订阅。可选：mock / 旧 session 不实现时，
   * 宿主 bridge 以 -32601 结束请求，页面据此降级，不影响已完成的握手与工具调用。
   */
  listResourcesForUi?(
    serverName: string,
    cursor?: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    resources: Array<{
      uri: string;
      name?: string;
      title?: string;
      description?: string;
      mimeType?: string;
      _meta?: Record<string, unknown>;
    }>;
    nextCursor?: string;
  }>;
  listResourceTemplatesForUi?(
    serverName: string,
    cursor?: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    resourceTemplates: Array<{
      uriTemplate: string;
      name?: string;
      title?: string;
      description?: string;
      mimeType?: string;
      _meta?: Record<string, unknown>;
    }>;
    nextCursor?: string;
  }>;
  /** 订阅者 = session + 沙箱作用域 + 实例代际；agent 侧按 (server, uri) 引用计数。 */
  subscribeResourceForUi?(
    serverName: string,
    uri: string,
    subscriberKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  unsubscribeResourceForUi?(
    serverName: string,
    uri: string,
    subscriberKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  /**
   * MCP 连接快照：凭证只在签发它的连接代际内有效。缺省（mock / 旧 session）视为不撤销。
   * identity 必须来自 host 可信连接（不含页面自报字段）。
   */
  getMcpAppConnectionSnapshot?(
    serverName: string,
  ): { identity: string; generation: number } | null | undefined;
  /** 连接代际变化（重连 / 断开）时通知；bridge 据此主动撤销实例与模型侧工具。 */
  onMcpAppConnectionInvalidated?(serverName: string, listener: () => void): () => void;
}

/**
 * fail closed：serverName 不在本 session 的 MCP server 表里时抛出，映射为 JSON-RPC -32602。
 * 归属只看 server（任何已连接的 MCP server 都能渲染 MCP App）；pluginId 只用于展示与日志。
 */
export class McpUiServerScopeError extends Error {
  readonly code = -32602;
  constructor(readonly serverName: string) {
    super(`MCP server "${serverName}" is not available in this session`);
    this.name = "McpUiServerScopeError";
  }
}

/**
 * UI 调用了不存在或 model-only 的工具。归属校验通过不代表调用方有资格：
 * `visibility` 不含 "app" 的工具只给模型用。映射为 JSON-RPC -32602。
 */
export class McpUiToolAccessError extends Error {
  readonly code = -32602;
  constructor(
    readonly reason: "tool_not_found" | "tool_not_app_visible",
    readonly serverName: string,
    readonly toolName: string,
  ) {
    super(
      reason === "tool_not_found"
        ? `MCP tool "${toolName}" is not available on server "${serverName}"`
        : `MCP tool "${toolName}" on server "${serverName}" is not visible to plugin UI`,
    );
    this.name = "McpUiToolAccessError";
  }
}

/** 结果超过 8 MiB 或 mimeType 不在白名单时抛出，映射为 JSON-RPC -32001（资源被拒）。 */
export class McpUiResourceRejectedError extends Error {
  readonly code = -32001;
  constructor(
    readonly reason: "too_large" | "mime_not_allowed",
    readonly uri: string,
    readonly detail: {
      bytes?: number;
      maxBytes?: number;
      mimeType?: string;
      expected?: readonly string[];
    },
  ) {
    super(
      reason === "too_large"
        ? `MCP resource "${uri}" is ${detail.bytes} bytes, exceeding the ${detail.maxBytes} byte limit for plugin UI reads`
        : `MCP resource "${uri}" has mimeType "${detail.mimeType}" which is not allowed for plugin UI reads`,
    );
    this.name = "McpUiResourceRejectedError";
  }
}

/**
 * 本 session 的 MCP server 没有实现页面请求的扩展能力（资源列表 / 模板 / 订阅 / sampling）。
 * 映射为 JSON-RPC -32601，页面据此降级；不能让缺失能力伪装成空结果或成功。
 */
export class McpUiNotSupportedError extends Error {
  readonly code = -32601;
  constructor(
    readonly serverName: string,
    readonly operation: "resources/list" | "resources/templates/list" | "resources/subscribe" | "resources/unsubscribe",
  ) {
    super(`MCP server "${serverName}" does not support ${operation}`);
    this.name = "McpUiNotSupportedError";
  }
}

/** HTML 资源校验失败（mimeType 非 MCP App / 超出 16 MiB），映射为 -32001。 */
export class McpUiHtmlRejectedError extends Error {
  readonly code = -32001;
  constructor(
    readonly reason: "mime_not_allowed" | "too_large" | "not_found",
    readonly uri: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(`MCP App resource "${uri}" was rejected: ${reason}`);
    this.name = "McpUiHtmlRejectedError";
  }
}

export interface McpUiHandlers {
  readResource(
    access: McpUiSessionAccess,
    params: McpUiReadResourceParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceResult>;
  callTool(
    access: McpUiSessionAccess,
    params: McpUiCallToolParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiCallToolResult>;
  /** abort 对应 callId 的进行中调用；归属校验同 callTool。 */
  cancelToolCall(
    access: McpUiSessionAccess,
    params: McpUiCancelCallParams,
  ): Promise<McpUiCancelCallResult>;
  readResourceForUi(
    access: McpUiSessionAccess,
    params: McpUiReadResourceParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceForUiResult>;
}

/** Host discovery 结果：工具 → UI 资源 → 已验证 HTML 与呈现权限。 */
export interface McpAppUiResource {
  resourceUri: string;
  mimeType: string;
  html: string;
  bytes: number;
  permissions: McpAppsResourcePermission[];
  csp?: import("@ycode/shared/mcp-apps").McpToolUiCsp;
  cspRelaxations?: import("@ycode/shared/mcp-apps").McpAppCspRelaxations;
  prefersBorder: boolean;
  heightHint?: number;
  minFrameHeight?: number;
  showInline: boolean;
  surface?: string;
}
