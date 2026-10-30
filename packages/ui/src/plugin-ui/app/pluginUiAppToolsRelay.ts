import {
  MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE,
  MCP_APPS_APP_TOOLS_REFRESH_INTERVAL_MS,
  MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS,
  MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS,
  normalizeMcpAppsAppTools,
  type McpAppsAppCapabilities,
  type McpAppsAppToolCallResult,
  type PluginUiAppToolMailboxEvent,
  type PluginUiHostPort,
  type PluginUiInstanceScope,
} from "@ycode/shared/mcp-apps";
import type { PluginUiJsonRpcBridge } from "./pluginUiJsonRpcBridge.js";

const MAX_TOOL_LIST_PAGES = 10;
const TOOL_LIST_CHANGED = "notifications/tools/list_changed";

/**
 * App-Provided Tools 的渲染端：握手后发现页面工具并登记到宿主；模型调用经实例信箱到达后
 * claim → 页面 `tools/call` → resolve 回传。按 callId 去重，未认领的投递不执行。
 * 宿主未提供 app-tools 能力时整段跳过，不影响主工具结果。
 */
export interface PluginUiAppToolsRelay {
  onInitialized(capabilities: McpAppsAppCapabilities | undefined, isCurrent: () => boolean): void;
  isBusy(): boolean;
  dispose(): void;
}

export function createPluginUiAppToolsRelay(input: {
  bridge: PluginUiJsonRpcBridge;
  host: PluginUiHostPort;
  scope: PluginUiInstanceScope;
  setTimer?: (callback: () => void, ms: number) => () => void;
  log?(message: string, detail?: Record<string, unknown>): void;
}): PluginUiAppToolsRelay {
  const setTimer =
    input.setTimer ??
    ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  const started = new Set<string>();
  const calls = new Map<string, AbortController>();
  let unsubscribeMailbox: (() => void) | null = null;
  let registered = false;
  let refreshing = false;
  let pendingRefresh = false;
  let lastRefreshAt = 0;
  let cancelRefreshTimer: (() => void) | null = null;
  let disposed = false;

  const unregister = () => {
    if (!registered) return;
    registered = false;
    void input.host.unregisterAppTools?.(input.scope).catch(() => undefined);
  };

  const listPageTools = async (): Promise<unknown[]> => {
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_LIST_PAGES; page += 1) {
      const result = await input.bridge.request<{ tools?: unknown[]; nextCursor?: string }>(
        "tools/list",
        cursor ? { cursor } : {},
      );
      tools.push(...(result.tools ?? []));
      if (tools.length >= MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE || !result.nextCursor) break;
      if (result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    return tools;
  };

  const refresh = async (isCurrent: () => boolean) => {
    if (!input.host.registerAppTools) return;
    refreshing = true;
    lastRefreshAt = Date.now();
    try {
      const { tools, skipped } = normalizeMcpAppsAppTools(await listPageTools());
      if (skipped.length > 0) input.log?.("[plugin-ui] app tools skipped", { skipped });
      if (disposed || !isCurrent()) return;
      await input.host.registerAppTools({ ...input.scope, tools });
      if (disposed || !isCurrent()) {
        void input.host.unregisterAppTools?.(input.scope).catch(() => undefined);
        return;
      }
      registered = true;
    } catch (error) {
      input.log?.("[plugin-ui] app tools registration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      refreshing = false;
    }
    if (pendingRefresh && !disposed && isCurrent()) {
      pendingRefresh = false;
      schedule(isCurrent);
    }
  };

  // list_changed 节流：1 s 窗口内的多次通知合并为一次尾随刷新。
  const schedule = (isCurrent: () => boolean) => {
    if (refreshing) {
      pendingRefresh = true;
      return;
    }
    if (cancelRefreshTimer) return;
    const wait = Math.max(0, lastRefreshAt + MCP_APPS_APP_TOOLS_REFRESH_INTERVAL_MS - Date.now());
    if (wait === 0) {
      void refresh(isCurrent);
      return;
    }
    cancelRefreshTimer = setTimer(() => {
      cancelRefreshTimer = null;
      if (!disposed && isCurrent()) void refresh(isCurrent);
    }, wait);
  };

  const execute = (event: PluginUiAppToolMailboxEvent) => {
    if (
      disposed ||
      event.instance.token !== input.scope.instance.token ||
      event.scopeId !== input.scope.scopeId
    ) {
      return;
    }
    const call = event.call;
    if (call.activity !== undefined) return;
    if (call.cancelled) {
      calls.get(call.callId)?.abort();
      started.add(call.callId);
      return;
    }
    if (started.has(call.callId)) return;
    started.add(call.callId);
    const cancel = new AbortController();
    calls.set(call.callId, cancel);
    void (async () => {
      try {
        const claimed = await input.host.claimAppToolCall?.({
          ...input.scope,
          callId: call.callId,
        });
        if (!claimed?.accepted || disposed) return;
        const result = await input.bridge.request<McpAppsAppToolCallResult>(
          "tools/call",
          { name: call.toolName, arguments: call.arguments },
          { timeoutMs: MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS, signal: cancel.signal },
        );
        await input.host.resolveAppToolCall?.({
          ...input.scope,
          callId: call.callId,
          result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await input.host
          .resolveAppToolCall?.({
            ...input.scope,
            callId: call.callId,
            error: { message: message.slice(0, MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS) },
          })
          .catch(() => undefined);
      } finally {
        calls.delete(call.callId);
      }
    })();
  };

  return {
    onInitialized(capabilities, isCurrent) {
      if (disposed || !capabilities?.tools) return;
      if (!unsubscribeMailbox && input.host.subscribeAppToolCalls) {
        unsubscribeMailbox = input.host.subscribeAppToolCalls((event) => {
          if (isCurrent()) execute(event);
        });
      }
      if (capabilities.tools.listChanged) {
        input.bridge.setNotificationHandler(TOOL_LIST_CHANGED, () => {
          if (isCurrent()) schedule(isCurrent);
        });
      }
      void refresh(isCurrent);
    },
    isBusy: () => calls.size > 0,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of calls.values()) cancel.abort();
      calls.clear();
      started.clear();
      cancelRefreshTimer?.();
      cancelRefreshTimer = null;
      unsubscribeMailbox?.();
      unsubscribeMailbox = null;
      unregister();
    },
  };
}
