/**
 * 宿主端口：UI renderer 通过它读取 `ui://` 资源、签发实例凭证、登记沙箱、回调工具与资源。
 * 实现位于 agent/host（bootstrap mcp-ui 的 host bridge）；renderer 只依赖这个接口，不直接接触 MCP client。
 * 所有方法都带完整归属（workspace + session + plugin + server + scope + instance），宿主侧 fail closed。
 */

import type {
  McpAppsAppToolCallRequest,
  McpAppsAppToolCallResult,
  McpAppsAppToolDescriptor,
} from "./appTools.js";
import type { McpAppInstance } from "./instance.js";
import type {
  McpAppCspRelaxations,
  McpAppsDisplayMode,
  McpToolUiCsp,
  PluginSandboxHandle,
} from "./contract.js";

export interface PluginUiHostScope {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  pluginId: string;
  /** 工具 / 资源所属的 namespaced MCP server；归属真相。 */
  serverName: string;
  /** `buildPluginSandboxScopeId` 的结果（`tool:<id>` / `surface:<id>`）。 */
  scopeId: string;
}

export interface PluginUiInstanceScope extends PluginUiHostScope {
  instance: McpAppInstance;
}

export interface PluginUiPrepareSandboxParams extends PluginUiHostScope {
  /** 工具 `_meta.ui.resourceUri`；宿主会再次校验它与工具声明一致。 */
  resourceUri: string;
  /**
   * 结果归属的工具名。宿主用它校验工具存在且 `visibility` 含 "app"，并比对工具声明的 resourceUri；
   * 缺省时宿主拒绝准备（fail closed），不能只凭页面上报的资源 URI 读取任意资源。
   */
  toolName: string;
  /** 发起请求的宿主窗口 webContents id；main 用它校验 webview attach 归属。 */
  ownerWebContentsId: number;
  /** 工具级声明，只在资源 `_meta` 没声明时兜底。 */
  csp?: McpToolUiCsp;
  cspRelaxations?: McpAppCspRelaxations;
  prefersBorder?: boolean;
  /** 工具级 preferredDisplayMode，用于未握手前的侧栏初始裁决。 */
  preferredDisplayMode?: McpAppsDisplayMode;
  /** 清单声明的面板 id；宿主据此判断是否要求侧栏承载。 */
  surface?: string;
}

export interface PluginUiReadResourceParams extends PluginUiInstanceScope {
  uri: string;
}
export interface PluginUiListResourcesParams extends PluginUiInstanceScope {
  cursor?: string;
}
export interface PluginUiResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  /** base64。 */
  blob?: string;
}
export interface PluginUiReadResourceResult {
  contents: PluginUiResourceContent[];
}
export interface PluginUiResourceDescriptor {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}
export interface PluginUiListResourcesResult {
  resources: PluginUiResourceDescriptor[];
  nextCursor?: string;
}
export interface PluginUiListResourceTemplatesResult {
  resourceTemplates: Array<Omit<PluginUiResourceDescriptor, "uri"> & { uriTemplate: string }>;
  nextCursor?: string;
}
export interface PluginUiResourceSubscriptionParams extends PluginUiInstanceScope {
  uri: string;
}

export interface PluginUiCallToolParams extends PluginUiInstanceScope {
  toolName: string;
  arguments?: Record<string, unknown>;
  /** 宿主生成的调用 id；页面取消 / 卸载时按它取消到 MCP client。 */
  callId: string;
}
export interface PluginUiCancelToolCallParams extends PluginUiInstanceScope {
  callId: string;
}
export interface PluginUiCallToolResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface PluginUiRegisterAppToolsParams extends PluginUiInstanceScope {
  tools: McpAppsAppToolDescriptor[];
}
export interface PluginUiAppToolCallParams extends PluginUiInstanceScope {
  callId: string;
}
export interface PluginUiAppToolCallAccepted {
  accepted: boolean;
}
export interface PluginUiResolveAppToolCallParams extends PluginUiAppToolCallParams {
  result?: McpAppsAppToolCallResult;
  error?: { message: string };
}

/** 实例信箱投递：宿主把模型调用推给唯一页面实例。 */
export interface PluginUiAppToolMailboxEvent {
  scopeId: string;
  instance: McpAppInstance;
  call: McpAppsAppToolCallRequest;
}
export type PluginUiAppToolMailboxHandler = (event: PluginUiAppToolMailboxEvent) => void;

/**
 * 宿主端口。`prepareSandbox` 负责读取并校验资源、签发凭证、登记沙箱；`callTool` 必须复用正常工具执行器
 * 与审批路径，不能绕过权限。资源列表 / 订阅与 app tools 是可选能力，缺失时 renderer 以 -32601 结束请求。
 */
export interface PluginUiHostPort {
  prepareSandbox(params: PluginUiPrepareSandboxParams): Promise<PluginSandboxHandle>;
  validateInstance(params: PluginUiInstanceScope): Promise<void>;
  closeInstance(params: PluginUiInstanceScope): Promise<void>;
  callTool(
    params: PluginUiCallToolParams,
    options?: { signal?: AbortSignal },
  ): Promise<PluginUiCallToolResult>;
  cancelToolCall(params: PluginUiCancelToolCallParams): Promise<{ cancelled: boolean }>;
  readResource(params: PluginUiReadResourceParams): Promise<PluginUiReadResourceResult>;
  listResources?(params: PluginUiListResourcesParams): Promise<PluginUiListResourcesResult>;
  listResourceTemplates?(
    params: PluginUiListResourcesParams,
  ): Promise<PluginUiListResourceTemplatesResult>;
  subscribeResource?(params: PluginUiResourceSubscriptionParams): Promise<void>;
  unsubscribeResource?(params: PluginUiResourceSubscriptionParams): Promise<void>;
  registerAppTools?(params: PluginUiRegisterAppToolsParams): Promise<void>;
  unregisterAppTools?(params: PluginUiInstanceScope): Promise<void>;
  claimAppToolCall?(params: PluginUiAppToolCallParams): Promise<PluginUiAppToolCallAccepted>;
  resolveAppToolCall?(
    params: PluginUiResolveAppToolCallParams,
  ): Promise<PluginUiAppToolCallAccepted>;
  /** 实例信箱的渲染端订阅；返回取消订阅函数。缺省表示宿主不使用 app tools。 */
  subscribeAppToolCalls?(handler: PluginUiAppToolMailboxHandler): () => void;
}
