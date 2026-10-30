/* eslint-disable max-lines -- ui/* JSON-RPC 状态机与 handler 表需要共享同一份 phase / pending / activeCalls，拆分会引入跨模块可变状态。 */
import {
  MCP_APPS_DEFAULT_PROTOCOL_VERSION,
  MCP_APPS_HANDSHAKE_TIMEOUT_MS,
  MCP_APPS_JSON_RPC_ERRORS,
  MCP_APPS_MCP_METHODS,
  MCP_APPS_SET_WIDGET_STATE_METHOD,
  MCP_APPS_TEARDOWN_TIMEOUT_MS,
  MCP_APPS_UI_METHODS,
  isMcpAppsJsonRpcMessage,
  mcpAppsRpcError,
  type McpAppsAppCapabilities,
  type McpAppsDisplayMode,
  type McpAppsHostCapabilities,
  type McpAppsHostContext,
  type McpAppsInitializeParams,
  type McpAppsInitializeResult,
  type McpAppsJsonRpcError,
  type McpAppsJsonRpcId,
  type McpAppsJsonRpcRequest,
  type McpAppsJsonRpcSuccess,
  type McpAppsRequestDisplayModeResult,
  type McpAppsSizeChangedParams,
  type McpAppsToolCallParams,
  type McpAppsToolResultPayload,
} from "@ycode/shared/mcp-apps";
import type { PluginUiCallToolResult, PluginUiReadResourceResult } from "@ycode/shared/mcp-apps";
import type { PluginUiMessageTransport } from "../adapters/messagePortTransport.js";

/**
 * 宿主 renderer 的 MCP Apps `ui/*` JSON-RPC 桥：握手、host context、工具结果投递、尺寸 / 显示模式、
 * 资源订阅与 teardown。页面在 relay shell 的 iframe 里，桥只经 MessagePort 说话，不接触 DOM / Electron。
 * 未声明 / 未实现的能力一律 -32601，不伪造成功。
 */
export class PluginUiRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "PluginUiRpcError";
  }
}

export type PluginUiBridgePhase = "handshaking" | "ready" | "failed" | "disposed";

export interface PluginUiBridgeHandlers {
  callTool(
    params: McpAppsToolCallParams & { callId: string },
    options: { signal: AbortSignal },
  ): Promise<PluginUiCallToolResult>;
  /** 页面取消 / 卸载时把 callId 传到宿主；远程 host port 不能只靠本地 AbortSignal。 */
  cancelToolCall?(callId: string): void | Promise<void>;
  readResource(uri: string, options: { signal: AbortSignal }): Promise<PluginUiReadResourceResult>;
  listResources?(cursor: string | undefined): Promise<unknown>;
  listResourceTemplates?(cursor: string | undefined): Promise<unknown>;
  subscribeResource?(uri: string): Promise<void>;
  unsubscribeResource?(uri: string): Promise<void>;
  openLink?(url: string): void;
  requestDisplayMode?(mode: McpAppsDisplayMode): McpAppsDisplayMode | Promise<McpAppsDisplayMode>;
  setWidgetState?(widgetState: unknown): void;
  updateModelContext?(params: Record<string, unknown>): void | Promise<void>;
  sendMessage?(params: Record<string, unknown>): void | Promise<void>;
  downloadFile?(params: Record<string, unknown>): void | Promise<unknown>;
  onSizeChanged?(size: { width?: number; height?: number }): void;
  onLoggingMessage?(params: Record<string, unknown>): void;
  onNotification?(method: string, params: Record<string, unknown>): void;
}

export interface PluginUiJsonRpcBridgeOptions {
  transport: PluginUiMessageTransport;
  hostInfo: { name: string; version: string };
  hostCapabilities: McpAppsHostCapabilities;
  hostContext: McpAppsHostContext;
  /** 会话内 widgetState 初值；随握手下发，之后只由页面写回。 */
  initialWidgetState?: unknown;
  handlers: PluginUiBridgeHandlers;
  handshakeTimeoutMs?: number;
  teardownTimeoutMs?: number;
  setTimer?: (callback: () => void, ms: number) => () => void;
  onInitialized?(input: {
    appCapabilities: McpAppsAppCapabilities | undefined;
    initializeResult: McpAppsInitializeResult;
  }): void;
  onFailed?(reason: string): void;
  onClosed?(reason: string): void;
  log?(message: string, detail?: Record<string, unknown>): void;
}

export interface PluginUiJsonRpcBridge {
  readonly phase: PluginUiBridgePhase;
  readonly appCapabilities: McpAppsAppCapabilities | undefined;
  start(): void;
  sendToolInput(params: Record<string, unknown>): void;
  sendToolResult(result: McpAppsToolResultPayload | PluginUiCallToolResult): void;
  sendToolCancelled(): void;
  setHostContext(patch: Partial<McpAppsHostContext>): void;
  getHostContext(): McpAppsHostContext;
  /** 宿主 → 页面请求（app tools 的 tools/list、tools/call），带超时。 */
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T>;
  setNotificationHandler(method: string, handler: (params: Record<string, unknown>) => void): void;
  /** 已握手的实例先给页面 teardown 窗口，再关闭传输。 */
  teardown(): Promise<void>;
  dispose(reason?: string): void;
}

interface PendingHostRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
}

const TOOL_FEED_INPUT = "tool-input";
const TOOL_FEED_RESULT = "tool-result";
const TOOL_FEED_CANCELLED = "tool-cancelled";

export function createPluginUiJsonRpcBridge(
  options: PluginUiJsonRpcBridgeOptions,
): PluginUiJsonRpcBridge {
  const setTimer =
    options.setTimer ??
    ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  let phase: PluginUiBridgePhase = "handshaking";
  let nextRequestId = 1;
  let appCapabilities: McpAppsAppCapabilities | undefined;
  let initializeResult: McpAppsInitializeResult | null = null;
  let cancelHandshakeTimer: (() => void) | null = null;
  let disposed = false;
  let hostContext: McpAppsHostContext = {
    ...options.hostContext,
    ...(options.initialWidgetState !== undefined
      ? { "ycode/widgetState": options.initialWidgetState }
      : {}),
  };
  const pending = new Map<string, PendingHostRequest>();
  const activeCalls = new Map<string, { callId: string; cancel: AbortController }>();
  const notificationHandlers = new Map<string, (params: Record<string, unknown>) => void>();
  let feed:
    | { kind: typeof TOOL_FEED_INPUT; params: Record<string, unknown> }
    | { kind: typeof TOOL_FEED_RESULT; result: McpAppsToolResultPayload | PluginUiCallToolResult }
    | { kind: typeof TOOL_FEED_CANCELLED }
    | null = null;

  const idKey = (id: McpAppsJsonRpcId) => `${typeof id}:${String(id)}`;
  const send = (message: unknown) => {
    if (disposed) return;
    try {
      options.transport.send(message);
    } catch (error) {
      options.log?.("[plugin-ui] bridge send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const respond = (id: McpAppsJsonRpcId, result: unknown) => {
    const frame: McpAppsJsonRpcSuccess = { jsonrpc: "2.0", id, result };
    send(frame);
  };
  const respondError = (id: McpAppsJsonRpcId, code: number, message: string, data?: unknown) => {
    const frame: McpAppsJsonRpcError = {
      jsonrpc: "2.0",
      id,
      error: mcpAppsRpcError(code, message, data),
    };
    send(frame);
  };
  const notify = (method: string, params?: Record<string, unknown>) => {
    send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  };

  const dispose = (reason = "closed") => {
    if (disposed) return;
    disposed = true;
    phase = "disposed";
    cancelHandshakeTimer?.();
    cancelHandshakeTimer = null;
    for (const request of pending.values()) {
      request.cancelTimer();
      request.reject(new Error("MCP App was closed"));
    }
    pending.clear();
    for (const call of activeCalls.values()) {
      call.cancel.abort();
      void options.handlers.cancelToolCall?.(call.callId);
    }
    activeCalls.clear();
    options.transport.close();
    options.onClosed?.(reason);
  };

  const fail = (reason: string) => {
    if (phase === "ready" || disposed) return;
    phase = "failed";
    options.onFailed?.(reason);
    dispose(reason);
  };

  const flushFeed = () => {
    if (!feed || phase !== "ready") return;
    const current = feed;
    feed = null;
    if (current.kind === TOOL_FEED_INPUT) notify(MCP_APPS_UI_METHODS.toolInput, current.params);
    else if (current.kind === TOOL_FEED_RESULT)
      notify(MCP_APPS_UI_METHODS.toolResult, {
        ...current.result,
      } as Record<string, unknown>);
    else notify(MCP_APPS_UI_METHODS.toolCancelled, {});
  };

  const markReady = () => {
    if (phase !== "handshaking" || disposed) return;
    phase = "ready";
    cancelHandshakeTimer?.();
    cancelHandshakeTimer = null;
    options.onInitialized?.({
      appCapabilities,
      initializeResult: initializeResult ?? {
        protocolVersion: MCP_APPS_DEFAULT_PROTOCOL_VERSION,
        hostInfo: options.hostInfo,
        hostCapabilities: options.hostCapabilities,
        hostContext,
      },
    });
    flushFeed();
  };

  const readParams = (params: unknown): Record<string, unknown> => (isRecord(params) ? params : {});

  const handleInitialize = (request: McpAppsJsonRpcRequest): McpAppsInitializeResult => {
    const params = readParams(request.params) as McpAppsInitializeParams;
    appCapabilities = isRecord(params.appCapabilities)
      ? (params.appCapabilities as McpAppsAppCapabilities)
      : undefined;
    const result: McpAppsInitializeResult = {
      protocolVersion:
        typeof params.protocolVersion === "string" && params.protocolVersion.length > 0
          ? params.protocolVersion
          : MCP_APPS_DEFAULT_PROTOCOL_VERSION,
      hostInfo: options.hostInfo,
      hostCapabilities: options.hostCapabilities,
      hostContext,
    };
    initializeResult = result;
    return result;
  };

  const handleToolCall = async (
    request: McpAppsJsonRpcRequest,
  ): Promise<PluginUiCallToolResult> => {
    const params = readParams(request.params);
    const name = readString(params.name);
    if (!name)
      throw new PluginUiRpcError(
        MCP_APPS_JSON_RPC_ERRORS.invalidParams,
        "tools/call requires a name",
      );
    const args = isRecord(params.arguments) ? params.arguments : undefined;
    const callId = createCallId();
    const cancel = new AbortController();
    activeCalls.set(idKey(request.id), { callId, cancel });
    try {
      return await options.handlers.callTool(
        {
          name,
          ...(args ? { arguments: args } : {}),
          ...(isRecord(params._meta) ? { _meta: params._meta } : {}),
          callId,
        },
        { signal: cancel.signal },
      );
    } finally {
      activeCalls.delete(idKey(request.id));
    }
  };

  const dispatchRequest = async (request: McpAppsJsonRpcRequest): Promise<unknown> => {
    const method = request.method;
    if (method === MCP_APPS_UI_METHODS.initialize) return handleInitialize(request);
    if (phase !== "ready") {
      throw new PluginUiRpcError(
        MCP_APPS_JSON_RPC_ERRORS.invalidRequest,
        "MCP App is not initialized",
      );
    }

    switch (method) {
      case MCP_APPS_MCP_METHODS.ping:
        return {};
      case MCP_APPS_MCP_METHODS.toolsCall:
      case "ui/call-tool":
        return handleToolCall(request);
      case MCP_APPS_MCP_METHODS.resourcesRead: {
        const uri = readString(readParams(request.params).uri);
        if (!uri) {
          throw new PluginUiRpcError(
            MCP_APPS_JSON_RPC_ERRORS.invalidParams,
            "resources/read requires uri",
          );
        }
        return options.handlers.readResource(uri, { signal: new AbortController().signal });
      }
      case MCP_APPS_MCP_METHODS.resourcesList: {
        if (!options.handlers.listResources) return unsupported(method);
        return options.handlers.listResources(readString(readParams(request.params).cursor));
      }
      case MCP_APPS_MCP_METHODS.resourcesTemplatesList: {
        if (!options.handlers.listResourceTemplates) return unsupported(method);
        return options.handlers.listResourceTemplates(
          readString(readParams(request.params).cursor),
        );
      }
      case MCP_APPS_MCP_METHODS.resourcesSubscribe: {
        const uri = readString(readParams(request.params).uri);
        if (!uri || !options.handlers.subscribeResource) return unsupported(method);
        await options.handlers.subscribeResource(uri);
        return {};
      }
      case MCP_APPS_MCP_METHODS.resourcesUnsubscribe: {
        const uri = readString(readParams(request.params).uri);
        if (!uri || !options.handlers.unsubscribeResource) return unsupported(method);
        await options.handlers.unsubscribeResource(uri);
        return {};
      }
      case MCP_APPS_UI_METHODS.openLink: {
        const url = readString(readParams(request.params).url);
        if (!url || !options.handlers.openLink) {
          throw new PluginUiRpcError(
            MCP_APPS_JSON_RPC_ERRORS.invalidParams,
            "ui/open-link requires url",
          );
        }
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new PluginUiRpcError(
            MCP_APPS_JSON_RPC_ERRORS.invalidParams,
            "ui/open-link requires an absolute url",
          );
        }
        // 只放行 http(s)：file: / 自定义 scheme 会打开本地程序。
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new PluginUiRpcError(
            MCP_APPS_JSON_RPC_ERRORS.invalidParams,
            `only http(s) links can be opened (${parsed.protocol})`,
          );
        }
        options.handlers.openLink(parsed.toString());
        return {};
      }
      case MCP_APPS_UI_METHODS.requestDisplayMode: {
        const requested = readDisplayMode(readParams(request.params).mode);
        if (!requested) {
          throw new PluginUiRpcError(
            MCP_APPS_JSON_RPC_ERRORS.invalidParams,
            "invalid display mode",
          );
        }
        const current = hostContext.displayMode ?? "inline";
        const available = hostContext.availableDisplayModes ?? [current];
        const resolved = options.handlers.requestDisplayMode
          ? await options.handlers.requestDisplayMode(requested)
          : requested;
        const mode = available.includes(resolved) ? resolved : current;
        if (mode !== current) {
          hostContext = { ...hostContext, displayMode: mode };
          notify(MCP_APPS_UI_METHODS.hostContextChanged, { ...hostContext });
        }
        const result: McpAppsRequestDisplayModeResult = { mode };
        return result;
      }
      case MCP_APPS_SET_WIDGET_STATE_METHOD: {
        options.handlers.setWidgetState?.(readParams(request.params).widgetState);
        return {};
      }
      case MCP_APPS_UI_METHODS.updateModelContext: {
        if (!options.handlers.updateModelContext) return unsupported(method);
        await options.handlers.updateModelContext(readParams(request.params));
        return {};
      }
      case MCP_APPS_UI_METHODS.message: {
        if (!options.handlers.sendMessage) return unsupported(method);
        await options.handlers.sendMessage(readParams(request.params));
        return {};
      }
      case MCP_APPS_UI_METHODS.downloadFile: {
        if (!options.handlers.downloadFile) return unsupported(method);
        return options.handlers.downloadFile(readParams(request.params));
      }
      default:
        return unsupported(method);
    }
  };

  const handleRequest = (request: McpAppsJsonRpcRequest) => {
    void dispatchRequest(request).then(
      (result) => {
        if (!disposed) respond(request.id, result);
      },
      (error: unknown) => {
        if (disposed) return;
        const rpc =
          error instanceof PluginUiRpcError
            ? error
            : new PluginUiRpcError(
                MCP_APPS_JSON_RPC_ERRORS.internalError,
                error instanceof Error ? error.message : String(error),
              );
        respondError(request.id, rpc.code, rpc.message, rpc.data);
      },
    );
  };

  const handleNotification = (method: string, params: Record<string, unknown>) => {
    if (method === MCP_APPS_UI_METHODS.initialized) {
      markReady();
      return;
    }
    if (method === MCP_APPS_UI_METHODS.sizeChanged) {
      const size: McpAppsSizeChangedParams = {
        ...(typeof params.width === "number" ? { width: params.width } : {}),
        ...(typeof params.height === "number" ? { height: params.height } : {}),
      };
      options.handlers.onSizeChanged?.(size);
      return;
    }
    if (method === MCP_APPS_UI_METHODS.requestTeardown) {
      options.handlers.onNotification?.(method, params);
      return;
    }
    if (method === MCP_APPS_MCP_METHODS.loggingMessage) {
      options.handlers.onLoggingMessage?.(params);
      return;
    }
    if (method === "notifications/cancelled") {
      const requestId = params.requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        const active = activeCalls.get(idKey(requestId));
        if (active) {
          active.cancel.abort();
          void options.handlers.cancelToolCall?.(active.callId);
        }
      }
      return;
    }
    notificationHandlers.get(method)?.(params);
    options.handlers.onNotification?.(method, params);
  };

  options.transport.onMessage((message) => {
    if (disposed || !isMcpAppsJsonRpcMessage(message)) return;
    if ("method" in message) {
      if ("id" in message) handleRequest(message);
      else handleNotification(message.method, readParams(message.params));
      return;
    }
    const request = pending.get(idKey(message.id));
    if (!request) return;
    pending.delete(idKey(message.id));
    request.cancelTimer();
    if ("error" in message) {
      request.reject(
        new PluginUiRpcError(message.error.code, message.error.message, message.error.data),
      );
    } else {
      request.resolve(message.result);
    }
  });

  cancelHandshakeTimer = setTimer(() => {
    if (phase !== "handshaking") return;
    fail("ui/initialize handshake timed out");
  }, options.handshakeTimeoutMs ?? MCP_APPS_HANDSHAKE_TIMEOUT_MS);

  const bridge: PluginUiJsonRpcBridge = {
    get phase() {
      return phase;
    },
    get appCapabilities() {
      return appCapabilities;
    },
    start() {
      // 传输在构造时已监听；这里只保证 handshake 计时器已经启动。
    },
    sendToolInput(params) {
      const payload = { arguments: isRecord(params.arguments) ? params.arguments : params };
      if (phase !== "ready") {
        feed = { kind: TOOL_FEED_INPUT, params: payload };
        return;
      }
      notify(MCP_APPS_UI_METHODS.toolInput, payload);
    },
    sendToolResult(result) {
      if (phase !== "ready") {
        feed = { kind: TOOL_FEED_RESULT, result };
        return;
      }
      notify(MCP_APPS_UI_METHODS.toolResult, { ...result } as Record<string, unknown>);
    },
    sendToolCancelled() {
      if (phase !== "ready") {
        feed = { kind: TOOL_FEED_CANCELLED };
        return;
      }
      notify(MCP_APPS_UI_METHODS.toolCancelled, {});
    },
    setHostContext(patch) {
      hostContext = { ...hostContext, ...patch };
      if (phase === "ready") notify(MCP_APPS_UI_METHODS.hostContextChanged, { ...hostContext });
    },
    getHostContext() {
      return { ...hostContext };
    },
    request<T = unknown>(
      method: string,
      params?: unknown,
      requestOptions?: { timeoutMs?: number; signal?: AbortSignal },
    ): Promise<T> {
      if (phase !== "ready") {
        return Promise.reject(new Error("MCP App is not ready"));
      }
      const id = nextRequestId++;
      return new Promise<T>((resolve, reject) => {
        const finish = () => {
          requestOptions?.signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
          const entry = pending.get(idKey(id));
          if (!entry) return;
          pending.delete(idKey(id));
          entry.cancelTimer();
          finish();
          reject(
            new PluginUiRpcError(MCP_APPS_JSON_RPC_ERRORS.internalError, `${method} was cancelled`),
          );
        };
        const cancelTimer = setTimer(() => {
          pending.delete(idKey(id));
          finish();
          reject(
            new PluginUiRpcError(MCP_APPS_JSON_RPC_ERRORS.internalError, `${method} timed out`),
          );
        }, requestOptions?.timeoutMs ?? 30_000);
        pending.set(idKey(id), {
          resolve: (value) => {
            finish();
            resolve(value as T);
          },
          reject: (error) => {
            finish();
            reject(error);
          },
          cancelTimer,
        });
        requestOptions?.signal?.addEventListener("abort", onAbort, { once: true });
        send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    setNotificationHandler(method, handler) {
      notificationHandlers.set(method, handler);
    },
    async teardown() {
      const active = phase === "ready";
      if (!active) {
        dispose("teardown");
        return;
      }
      try {
        await bridge.request(
          MCP_APPS_UI_METHODS.resourceTeardown,
          {},
          { timeoutMs: options.teardownTimeoutMs ?? MCP_APPS_TEARDOWN_TIMEOUT_MS },
        );
      } catch {
        // 页面未回包也必须释放；teardown 是 best effort。
      } finally {
        dispose("teardown");
      }
    },
    dispose(reason) {
      dispose(reason);
    },
  };
  return bridge;
}

let callCounter = 0;
function createCallId(): string {
  callCounter += 1;
  return `ui-${Date.now().toString(36)}-${callCounter.toString(36)}`;
}

function unsupported(method: string): never {
  throw new PluginUiRpcError(
    MCP_APPS_JSON_RPC_ERRORS.methodNotFound,
    `${method} is not supported by this host`,
  );
}

function readDisplayMode(value: unknown): McpAppsDisplayMode | undefined {
  return value === "inline" || value === "fullscreen" || value === "pip" ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
