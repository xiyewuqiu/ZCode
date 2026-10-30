/* eslint-disable max-lines -- 卡片运行态必须把 prepare / port / 桥 / 工具投递 / teardown 放在同一个生命周期里，拆开反而让宿主顺序不可审计。 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MCP_APPS_HOST_NAME,
  MCP_APPS_HOST_VERSION,
  buildPluginSandboxScopeId,
  type McpAppsAppCapabilities,
  type PluginSandboxHandle,
  type PluginSandboxPlatformPort,
  type PluginSandboxPortsEvent,
  type PluginUiHostPort,
  type PluginUiInstanceScope,
} from "@ycode/shared/mcp-apps";
import {
  createPluginUiAppToolsRelay,
  type PluginUiAppToolsRelay,
} from "@/plugin-ui/app/pluginUiAppToolsRelay.js";
import {
  createPluginUiJsonRpcBridge,
  type PluginUiJsonRpcBridge,
} from "@/plugin-ui/app/pluginUiJsonRpcBridge.js";
import {
  buildPluginUiWidgetStateKey,
  getPluginUiWidgetState,
  setPluginUiWidgetState,
} from "@/plugin-ui/app/pluginUiWidgetStateStore.js";
import { createPluginUiMessageTransport } from "@/plugin-ui/adapters/messagePortTransport.js";
import { createLegacyPluginUiHostPort } from "@/plugin-ui/adapters/legacyHostPort.js";
import {
  resolvePluginUiHostUnavailableReason,
  type PluginUiAppLoader,
  type PluginUiDisplay,
} from "@/plugin-ui/domain/contract.js";
import {
  buildPluginUiHostCapabilities,
  buildPluginUiHostContext,
  buildPluginUiStyleVariables,
  PLUGIN_UI_CARD_MAX_HEIGHT_PX,
} from "@/plugin-ui/domain/hostContext.js";
import { logger } from "@/logger.js";

export type PluginUiFallbackReason =
  | "no-host"
  | "no-platform"
  | "no-session"
  | "no-resource"
  | "bridge-failed"
  | "error";

export type PluginUiRuntimeStatus = "loading" | "ready" | "fallback";
export type PluginUiSurfaceMode = "inline" | "fullscreen" | "pip";

export interface PluginUiAppRuntimeInput {
  display: PluginUiDisplay;
  toolCallId: string;
  serverName: string;
  toolName: string;
  sessionId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolCancelled?: boolean;
  theme: "light" | "dark";
  locale: string;
  width: number;
  host?: PluginUiHostPort;
  legacyLoader?: PluginUiAppLoader;
  onOpenExternal?: (url: string) => void;
  hostVersion?: string;
  platformOverride?: PluginSandboxPlatformPort;
}

export interface PluginUiAppRuntime {
  status: PluginUiRuntimeStatus;
  reason?: PluginUiFallbackReason;
  message?: string;
  handle: PluginSandboxHandle | null;
  height: number;
  minHeight?: number;
  sideMode: PluginUiSurfaceMode;
  setSideMode(mode: PluginUiSurfaceMode): void;
  appCapabilities?: McpAppsAppCapabilities;
  retry(): void;
}

const DEFAULT_HEIGHT = 320;

/**
 * 一个 MCP App 卡片 / 面板的运行态：prepare（资源校验 + 凭证 + 沙箱登记）→ 等 MessagePort →
 * 建 JSON-RPC 桥 → 投递工具结果 → teardown。任何一步失败都退回 fallback，工具结果本身不受影响。
 */
export function usePluginUiAppRuntime(input: PluginUiAppRuntimeInput): PluginUiAppRuntime {
  const platform = input.platformOverride;
  const initialSideMode = resolveInitialSideMode(input.display);
  const [status, setStatus] = useState<PluginUiRuntimeStatus>("loading");
  const [reason, setReason] = useState<PluginUiFallbackReason | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [handle, setHandle] = useState<PluginSandboxHandle | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [sideMode, setSideMode] = useState<PluginUiSurfaceMode>(initialSideMode);
  const [appCapabilities, setAppCapabilities] = useState<McpAppsAppCapabilities | undefined>();
  const [retryEpoch, setRetryEpoch] = useState(0);

  const bridgeRef = useRef<PluginUiJsonRpcBridge | null>(null);
  const relayRef = useRef<PluginUiAppToolsRelay | null>(null);
  const handleRef = useRef<PluginSandboxHandle | null>(null);
  const scopeRef = useRef<PluginUiInstanceScope | null>(null);
  const pendingPortRef = useRef<PluginSandboxPortsEvent | null>(null);
  const mountedRef = useRef(true);
  const sideModeRef = useRef(sideMode);
  sideModeRef.current = sideMode;
  const lastFeedRef = useRef<{
    input: unknown;
    result: unknown;
    cancelled: boolean;
  } | null>(null);

  const inputRef = useRef(input);
  inputRef.current = input;
  const displayKey = [
    input.display.pluginId,
    input.display.resourceUri,
    input.display.preferredDisplayMode ?? "inline",
    input.display.surface ?? "",
    input.display.prefersBorder === true ? "border" : "plain",
  ].join("|");

  const fallback = useCallback((next: PluginUiFallbackReason, detail?: string) => {
    if (!mountedRef.current) return;
    setReason(next);
    setMessage(detail);
    setStatus("fallback");
  }, []);

  const buildContext = useCallback(() => {
    const current = inputRef.current;
    return buildPluginUiHostContext({
      theme: current.theme,
      locale: current.locale,
      displayMode: sideModeRef.current === "inline" ? "inline" : sideModeRef.current,
      width: current.width,
      maxHeight: PLUGIN_UI_CARD_MAX_HEIGHT_PX,
      availableDisplayModes: ["inline", "fullscreen", "pip"],
      styleVariables: buildPluginUiStyleVariables((token) => readHostToken(token)),
      toolInfo: { name: current.toolName },
      platform: "desktop",
    });
  }, []);

  const attachPort = useCallback(
    (portEvent: PluginSandboxPortsEvent, hostPort: PluginUiHostPort) => {
      const currentHandle = handleRef.current;
      const scope = scopeRef.current;
      if (!currentHandle || !scope) return;
      if (
        portEvent.sandboxId !== currentHandle.sandboxId ||
        portEvent.initId < currentHandle.initId
      ) {
        return;
      }
      const nextHandle = { ...currentHandle, initId: portEvent.initId };
      handleRef.current = nextHandle;
      setHandle(nextHandle);
      const activeScope = { ...scope, instance: nextHandle.instance };
      scopeRef.current = activeScope;

      relayRef.current?.dispose();
      relayRef.current = null;
      void bridgeRef.current?.teardown();
      const transport = createPluginUiMessageTransport(portEvent.port);
      const current = inputRef.current;
      const widgetKey = buildPluginUiWidgetStateKey({
        workspacePath: current.workspacePath,
        ...(current.workspaceIdentity ? { workspaceIdentity: current.workspaceIdentity } : {}),
        sessionId: current.sessionId ?? "",
        pluginId: current.display.pluginId,
        serverName: current.serverName,
        resourceUri: current.display.resourceUri,
        scopeId: scope.scopeId,
      });
      const bridge = createPluginUiJsonRpcBridge({
        transport,
        hostInfo: {
          name: MCP_APPS_HOST_NAME,
          version: current.hostVersion ?? MCP_APPS_HOST_VERSION,
        },
        hostCapabilities: buildPluginUiHostCapabilities({
          canOpenLinks: Boolean(current.onOpenExternal),
          canSetWidgetState: true,
          canSubscribeResources: Boolean(hostPort.listResources || hostPort.subscribeResource),
          ...(current.display.surface ? { surfaceId: current.display.surface } : {}),
        }),
        hostContext: buildContext(),
        initialWidgetState: getPluginUiWidgetState(widgetKey),
        handlers: {
          callTool: async (params, options) => {
            const bound = activeScope;
            if (!bound) throw new Error("MCP App is no longer authorized");
            return hostPort.callTool(
              {
                ...bound,
                toolName: params.name,
                ...(params.arguments ? { arguments: params.arguments } : {}),
                callId: params.callId,
              },
              options,
            );
          },
          readResource: async (uri) => {
            const bound = activeScope;
            if (!bound) throw new Error("MCP App is no longer authorized");
            return hostPort.readResource({ ...bound, uri });
          },
          cancelToolCall: async (callId) => {
            await hostPort.cancelToolCall({ ...activeScope, callId });
          },
          ...(hostPort.listResources
            ? {
                listResources: (cursor: string | undefined) => {
                  const bound = activeScope;
                  if (!bound) throw new Error("MCP App is no longer authorized");
                  return hostPort.listResources!({ ...bound, ...(cursor ? { cursor } : {}) });
                },
              }
            : {}),
          ...(hostPort.listResourceTemplates
            ? {
                listResourceTemplates: (cursor: string | undefined) => {
                  const bound = activeScope;
                  if (!bound) throw new Error("MCP App is no longer authorized");
                  return hostPort.listResourceTemplates!({
                    ...bound,
                    ...(cursor ? { cursor } : {}),
                  });
                },
              }
            : {}),
          ...(hostPort.subscribeResource
            ? {
                subscribeResource: (uri: string) => {
                  const bound = activeScope;
                  if (!bound) throw new Error("MCP App is no longer authorized");
                  return hostPort.subscribeResource!({ ...bound, uri });
                },
              }
            : {}),
          ...(hostPort.unsubscribeResource
            ? {
                unsubscribeResource: (uri: string) => {
                  const bound = activeScope;
                  if (!bound) throw new Error("MCP App is no longer authorized");
                  return hostPort.unsubscribeResource!({ ...bound, uri });
                },
              }
            : {}),
          ...(current.onOpenExternal
            ? { openLink: (url: string) => current.onOpenExternal?.(url) }
            : {}),
          requestDisplayMode: (mode) => {
            const next = mode === "inline" ? "inline" : mode;
            setSideMode(next);
            return next;
          },
          setWidgetState: (widgetState) => setPluginUiWidgetState(widgetKey, widgetState),
          onSizeChanged: (size) => {
            if (typeof size.height !== "number" || !Number.isFinite(size.height)) return;
            const min = currentHandle.resourceMeta?.minFrameHeight ?? 120;
            const max = PLUGIN_UI_CARD_MAX_HEIGHT_PX;
            setHeight(Math.min(max, Math.max(min, Math.round(size.height))));
          },
          onLoggingMessage: (params) => {
            logger.debug("[plugin-ui] app log", {
              pluginId: current.display.pluginId,
              level: params.level,
            });
          },
        },
        onInitialized: ({ appCapabilities: capabilities }) => {
          if (!mountedRef.current) return;
          setAppCapabilities(capabilities);
          setStatus("ready");
          const relay = createPluginUiAppToolsRelay({
            bridge,
            host: hostPort,
            scope: activeScope,
            log: (msg, detail) => logger.debug(msg, detail),
          });
          relayRef.current = relay;
          relay.onInitialized(
            capabilities,
            () => mountedRef.current && bridgeRef.current === bridge,
          );
        },
        onFailed: (failure) => {
          const failedHandle = handleRef.current;
          const failedScope = scopeRef.current;
          handleRef.current = null;
          scopeRef.current = null;
          setHandle(null);
          if (failedScope) void hostPort.closeInstance(failedScope).catch(() => undefined);
          if (failedHandle && platform) {
            void platform.disposeSandbox(failedHandle.sandboxId, failedHandle.initId);
          }
          fallback("bridge-failed", failure);
        },
        onClosed: (closedReason) => {
          if (mountedRef.current && closedReason !== "teardown") {
            logger.debug("[plugin-ui] bridge closed", { reason: closedReason });
          }
        },
        log: (msg, detail) => logger.debug(msg, detail),
      });
      bridgeRef.current = bridge;
      const min = nextHandle.resourceMeta?.minFrameHeight ?? 120;
      const hint = nextHandle.resourceMeta?.heightHint ?? DEFAULT_HEIGHT;
      setHeight(Math.min(PLUGIN_UI_CARD_MAX_HEIGHT_PX, Math.max(min, hint)));
      lastFeedRef.current = null;
      bridge.start();
    },
    [buildContext, fallback],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSideMode(resolveInitialSideMode(input.display));
  }, [input.display.preferredDisplayMode, input.display.surface]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setReason(undefined);
    setMessage(undefined);
    setAppCapabilities(undefined);
    pendingPortRef.current = null;

    const current = inputRef.current;
    const ownerHost =
      current.host ??
      (current.legacyLoader && platform?.registerSandbox
        ? createLegacyPluginUiHostPort({
            display: current.display,
            loader: current.legacyLoader,
            platform: platform as PluginSandboxPlatformPort & {
              registerSandbox: NonNullable<PluginSandboxPlatformPort["registerSandbox"]>;
            },
          })
        : null);
    const unavailable = resolvePluginUiHostUnavailableReason({
      hasPlatform: Boolean(platform),
      hasHost: Boolean(current.host),
      hasLegacyLoader: Boolean(current.legacyLoader),
      canRegisterSandbox: Boolean(platform?.registerSandbox),
      ...(current.sessionId ? { sessionId: current.sessionId } : {}),
    });
    if (unavailable) {
      fallback(unavailable);
      return;
    }
    // 纯函数判定与上面的 platform / ownerHost 条件等价；显式别名把类型收窄回非空。
    const activePlatform = platform as PluginSandboxPlatformPort;
    const activeHost = ownerHost as PluginUiHostPort;

    const scopeId = buildPluginSandboxScopeId(
      current.display.surface
        ? { kind: "surface", surfaceId: current.display.surface }
        : { kind: "toolCall", toolCallId: current.toolCallId },
    );

    const unsubscribe = activePlatform.onPorts((event) => {
      if (cancelled) return;
      const active = handleRef.current;
      if (!active || event.sandboxId !== active.sandboxId) {
        pendingPortRef.current = event;
        return;
      }
      attachPort(event, activeHost);
    });

    void (async () => {
      try {
        const ownerWebContentsId = await activePlatform.getOwnerWebContentsId();
        if (cancelled) return;
        const prepared = await activeHost.prepareSandbox({
          workspacePath: current.workspacePath,
          ...(current.workspaceIdentity ? { workspaceIdentity: current.workspaceIdentity } : {}),
          sessionId: current.sessionId ?? "",
          pluginId: current.display.pluginId,
          serverName: current.serverName,
          scopeId,
          resourceUri: current.display.resourceUri,
          toolName: current.toolName,
          ownerWebContentsId,
          ...(current.display.preferredDisplayMode
            ? { preferredDisplayMode: current.display.preferredDisplayMode }
            : {}),
          ...(current.display.surface ? { surface: current.display.surface } : {}),
          ...(current.display.csp ? { csp: current.display.csp } : {}),
          ...(current.display.prefersBorder !== undefined
            ? { prefersBorder: current.display.prefersBorder }
            : {}),
        });
        if (cancelled) {
          await activeHost
            .closeInstance({
              workspacePath: current.workspacePath,
              sessionId: current.sessionId ?? "",
              pluginId: current.display.pluginId,
              serverName: current.serverName,
              scopeId,
              instance: prepared.instance,
            })
            .catch(() => undefined);
          await activePlatform.disposeSandbox(prepared.sandboxId, prepared.initId);
          return;
        }
        handleRef.current = prepared;
        scopeRef.current = {
          workspacePath: current.workspacePath,
          ...(current.workspaceIdentity ? { workspaceIdentity: current.workspaceIdentity } : {}),
          sessionId: current.sessionId ?? "",
          pluginId: current.display.pluginId,
          serverName: current.serverName,
          scopeId,
          instance: prepared.instance,
        };
        setHandle(prepared);
        const pending = pendingPortRef.current;
        if (pending && pending.sandboxId === prepared.sandboxId) {
          pendingPortRef.current = null;
          attachPort(pending, activeHost);
        }
      } catch (error) {
        if (cancelled) return;
        fallback("error", error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      const bridge = bridgeRef.current;
      bridgeRef.current = null;
      const relay = relayRef.current;
      relayRef.current = null;
      const released = handleRef.current;
      const bound = scopeRef.current;
      handleRef.current = null;
      scopeRef.current = null;
      void (async () => {
        relay?.dispose();
        await bridge?.teardown().catch(() => undefined);
        if (bound) await activeHost.closeInstance(bound).catch(() => undefined);
        if (released) await activePlatform.disposeSandbox(released.sandboxId, released.initId);
      })();
    };
  }, [
    attachPort,
    fallback,
    displayKey,
    input.legacyLoader,
    input.host,
    input.sessionId,
    input.serverName,
    input.toolCallId,
    input.toolName,
    input.workspaceIdentity,
    input.workspacePath,
    platform,
    retryEpoch,
  ]);

  useEffect(() => {
    if (status !== "ready") return;
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const current = inputRef.current;
    const last = lastFeedRef.current;
    if (
      last &&
      last.input === current.toolInput &&
      last.result === current.toolResult &&
      last.cancelled === (current.toolCancelled === true)
    ) {
      return;
    }
    if (current.toolCancelled) {
      lastFeedRef.current = {
        input: current.toolInput,
        result: current.toolResult,
        cancelled: true,
      };
      bridge.sendToolCancelled();
      return;
    }
    if (last?.input !== current.toolInput && current.toolInput !== undefined) {
      bridge.sendToolInput({ arguments: isRecord(current.toolInput) ? current.toolInput : {} });
    }
    if (last?.result !== current.toolResult && current.toolResult !== undefined) {
      bridge.sendToolResult(
        isRecord(current.toolResult)
          ? (current.toolResult as Record<string, unknown>)
          : { structuredContent: current.toolResult },
      );
    }
    lastFeedRef.current = {
      input: current.toolInput,
      result: current.toolResult,
      cancelled: false,
    };
  }, [status, input.toolCancelled, input.toolInput, input.toolResult]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.setHostContext({
      ...buildContext(),
      displayMode: sideMode === "inline" ? "inline" : sideMode,
    });
  }, [buildContext, input.theme, input.locale, input.width, sideMode]);

  return {
    status,
    ...(reason ? { reason } : {}),
    ...(message ? { message } : {}),
    handle,
    height,
    ...(handle?.resourceMeta?.minFrameHeight
      ? { minHeight: handle.resourceMeta.minFrameHeight }
      : {}),
    sideMode,
    setSideMode,
    ...(appCapabilities ? { appCapabilities } : {}),
    retry: () => setRetryEpoch((epoch) => epoch + 1),
  };
}

function resolveInitialSideMode(display: PluginUiDisplay): PluginUiSurfaceMode {
  if (display.preferredDisplayMode === "pip") return "pip";
  if (display.preferredDisplayMode === "fullscreen" || display.surface) return "fullscreen";
  return "inline";
}

function readHostToken(token: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
