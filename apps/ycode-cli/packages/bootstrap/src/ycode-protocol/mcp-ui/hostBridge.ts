import {
  buildPluginSandboxRegisterInput,
  normalizeMcpAppsAppTools,
  type McpAppInstance,
  type McpAppsManifest,
  type PluginSandboxHandle,
  type PluginSandboxRegisterInput,
  type PluginUiAppToolCallAccepted,
  type PluginUiAppToolCallParams,
  type PluginUiAppToolMailboxHandler,
  type PluginUiCallToolParams,
  type PluginUiCallToolResult,
  type PluginUiCancelToolCallParams,
  type PluginUiHostPort,
  type PluginUiInstanceScope,
  type PluginUiListResourcesParams,
  type PluginUiListResourcesResult,
  type PluginUiListResourceTemplatesResult,
  type PluginUiPrepareSandboxParams,
  type PluginUiReadResourceParams,
  type PluginUiReadResourceResult,
  type PluginUiRegisterAppToolsParams,
  type PluginUiResolveAppToolCallParams,
  type PluginUiResourceSubscriptionParams,
} from "@ycode/shared/mcp-apps";
import type { McpAppProvidedToolDefinition, McpAppProvidedToolExecutor } from "@ycode/core";
import { McpUiAppToolMailbox } from "./appToolsMailbox.js";
import type { McpUiSessionAccess } from "./contract.js";
import { McpUiNotSupportedError } from "./contract.js";
import { readMcpAppUiResource } from "./discovery.js";
import { createMcpUiHandlers } from "./handlers.js";
import { McpUiInstances, type McpUiInstanceSource } from "./instances.js";

/**
 * MCP Apps 的宿主端竖切：读取 `ui://` 资源 → 校验 mime/大小/可见性 → 签发实例凭证 → 交给沙箱登记，
 * 再把页面的工具 / 资源 / app-tools 请求接到同一个 session access 上。UI renderer 只看到 `PluginUiHostPort`。
 * 权限模型 fail closed：资源未声明 mime/超限、工具不可见、server 不在本 session，全部拒绝。
 */
export interface McpUiHostBridgeDeps {
  /**
   * host/main 的沙箱登记入口；返回句柄（含 sandboxId / initId / partition / resourceMeta）。
   * 同进程宿主（测试 / 嵌入式）用它；跨进程链路（renderer 经 `IPlatformService`）改用
   * `prepareRegistration` 只取登记载荷，由 renderer 自己的沙箱平台端口登记。
   */
  registerSandbox?(
    input: PluginSandboxRegisterInput,
  ): Promise<PluginSandboxHandle> | PluginSandboxHandle;
  /** 凭证代际来源；缺省按 workspace + server 生成稳定身份。 */
  resolveSource?(serverName: string): McpUiInstanceSource | null | undefined;
  /**
   * 把本会话暴露给模型的 app 工具整体同步到 runtime；由 `mcp/ui` 宿主提供。
   * 返回实际登记的名字，`null` 表示会话已不存在。
   */
  applyAppTools?(
    sessionId: string,
    definitions: readonly McpAppProvidedToolDefinition[],
    execute: McpAppProvidedToolExecutor,
  ): string[] | null;
  logger?: {
    info?: (message: string, fields?: Record<string, unknown>) => void;
    warn?: (message: string, fields?: Record<string, unknown>) => void;
    debug?: (message: string, fields?: Record<string, unknown>) => void;
  };
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => () => void;
  createToken?: () => string;
  createCallId?: () => string;
}

/** prepare 的跨进程结果：实例凭证 + 已校验的沙箱登记载荷（HTML 只在这里出现一次）。 */
export interface McpUiPreparedRegistration {
  instance: McpAppInstance;
  register: PluginSandboxRegisterInput;
}

export interface McpUiHostBridge extends PluginUiHostPort {
  readonly instances: McpUiInstances;
  readonly appTools: McpUiAppToolMailbox;
  /** 只读资源 + 签发凭证 + 构造登记载荷；真正的登记由调用方的沙箱平台完成。 */
  prepareRegistration(params: PluginUiPrepareSandboxParams): Promise<McpUiPreparedRegistration>;
  validateInstance(params: PluginUiInstanceScope): Promise<void>;
  closeSession(sessionId: string): void;
  isInstanceBusy(params: PluginUiInstanceScope): boolean;
  dispose(): void;
}

export function createMcpUiHostBridge(
  access: McpUiSessionAccess,
  deps: McpUiHostBridgeDeps,
): McpUiHostBridge {
  const instances = new McpUiInstances();
  const handlers = createMcpUiHandlers({ logger: deps.logger });
  // 连接代际撤销订阅：bridge 是每会话唯一 owner，token → 取消订阅。
  const invalidations = new Map<string, () => void>();
  // 模型条目执行器要回到 bridge 的实例信箱；bridge 本体在下面构造，调用发生在之后。
  let bridgeRef: McpUiHostBridge | undefined;
  const appTools = new McpUiAppToolMailbox({
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.setTimer ? { setTimer: deps.setTimer } : {}),
    ...(deps.createCallId ? { createCallId: deps.createCallId } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    ...(deps.applyAppTools
      ? {
          applyTools: (
            sessionId: string,
            definitions: readonly McpAppProvidedToolDefinition[],
            _execute: McpAppProvidedToolExecutor,
          ) =>
            deps.applyAppTools!(sessionId, definitions, (call, options) => {
              if (!bridgeRef) {
                return Promise.reject(new Error("MCP App bridge is not ready"));
              }
              return executeMcpUiAppTool(bridgeRef, {
                sessionId,
                scopeId: call.definition.scopeId,
                generation: call.definition.generation,
                toolName: call.definition.toolName,
                arguments: call.arguments,
                signal: options.signal,
              });
            }),
        }
      : {}),
    // 模型侧条目在审批前 pin 实例；实例已换代 / 撤销时 retainByScope 抛错。
    retainExecution: (scopeId, generation, callId) =>
      instances.retainByScope(scopeId, generation, callId),
  });

  const sourceFor = (serverName: string): McpUiInstanceSource | null => {
    if (deps.resolveSource) return deps.resolveSource(serverName) ?? null;
    const snapshot = access.getMcpAppConnectionSnapshot?.(serverName);
    if (!snapshot) return null;
    return { identity: snapshot.identity, generation: snapshot.generation };
  };

  const validate = (params: PluginUiInstanceScope): void => {
    instances.validate(
      params.instance,
      {
        workspace: {
          workspacePath: params.workspacePath,
          ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        },
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
      },
      sourceFor(params.serverName),
    );
  };

  const prepareRegistration = async (
    params: PluginUiPrepareSandboxParams,
  ): Promise<McpUiPreparedRegistration> => {
    const source = sourceFor(params.serverName);
    const instance = instances.open(
      {
        workspace: params.workspaceIdentity?.trim() || params.workspacePath,
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        resourceUri: params.resourceUri,
        ownerWebContentsId: params.ownerWebContentsId,
      },
      source,
      deps.createToken ? { createToken: deps.createToken } : {},
    );
    const scope = { ...params, instance };
    try {
      // discovery 自己会做 server / 工具可见性 / resourceUri 绑定 / HTML mime 与 16 MiB 校验；
      // 这里不再重复拼接 manifest，避免两套规则漂移。
      const resource = await readMcpAppUiResource(access, {
        ...scope,
        toolName: params.toolName,
        resourceUri: params.resourceUri,
      });
      const manifest: McpAppsManifest = {
        resourceUri: resource.resourceUri,
        visibility: ["model", "app"],
        permissions: resource.permissions,
        prefersBorder: resource.prefersBorder,
        showInline: resource.showInline,
        ...(resource.csp ? { csp: resource.csp } : {}),
        ...(resource.cspRelaxations ? { cspRelaxations: resource.cspRelaxations } : {}),
        ...(resource.heightHint !== undefined ? { heightHint: resource.heightHint } : {}),
        ...(resource.minFrameHeight !== undefined ? { minFrameHeight: resource.minFrameHeight } : {}),
        ...(resource.surface ? { surface: resource.surface } : {}),
      };
      // 工具级 preferredDisplayMode / surface 只补 manifest 未声明的部分；资源级仍优先。
      const register = buildPluginSandboxRegisterInput({
        manifest:
          params.preferredDisplayMode || params.surface
            ? {
                ...manifest,
                ...(params.preferredDisplayMode
                  ? { preferredDisplayMode: params.preferredDisplayMode }
                  : {}),
                ...(params.surface && !manifest.surface ? { surface: params.surface } : {}),
              }
            : manifest,
        html: resource.html,
        instance,
        ownerWebContentsId: params.ownerWebContentsId,
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
      });
      deps.logger?.info?.("MCP App sandbox prepared", {
        event: "mcp.ui.prepare",
        scopeId: params.scopeId,
        resourceUri: params.resourceUri,
        bytes: resource.bytes,
      });
      // 同一实例只订阅一次；连接换代时撤销凭证、清信箱并撤掉模型侧工具。
      if (!invalidations.has(instance.token)) {
        const off = access.onMcpAppConnectionInvalidated?.(params.serverName, () => {
          invalidations.delete(instance.token);
          appTools.unregister({
            sessionId: params.sessionId,
            scopeId: params.scopeId,
            generation: instance.generation,
            instance,
          });
          instances.close(instance);
          deps.logger?.info?.("MCP App instance revoked by connection generation", {
            event: "mcp.ui.instance.revoked",
            sessionId: params.sessionId,
            scopeId: params.scopeId,
            serverName: params.serverName,
          });
        });
        if (off) invalidations.set(instance.token, off);
      }
      return { instance, register };
    } catch (error) {
      // 准备失败必须撤销刚签发的凭证，避免页面 / 宿主继续用半成品归属。
      instances.close(instance);
      deps.logger?.warn?.("MCP App sandbox prepare failed", {
        event: "mcp.ui.prepare",
        scopeId: params.scopeId,
        resourceUri: params.resourceUri,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const bridge: McpUiHostBridge = {
    instances,
    appTools,
    async prepareSandbox(params: PluginUiPrepareSandboxParams): Promise<PluginSandboxHandle> {
      if (!deps.registerSandbox) {
        throw new Error("MCP App sandbox registration is not available in this host");
      }
      const prepared = await prepareRegistration(params);
      return deps.registerSandbox(prepared.register);
    },
    prepareRegistration,
    async validateInstance(params) {
      validate(params);
    },
    async closeInstance(params) {
      // close 是幂等撤销：即使凭证已被连接快照撤销，也要清掉该实例的信箱登记。
      invalidations.get(params.instance.token)?.();
      invalidations.delete(params.instance.token);
      appTools.unregister({
        sessionId: params.sessionId,
        scopeId: params.scopeId,
        generation: params.instance.generation,
        instance: params.instance,
      });
      instances.close(params.instance);
    },
    isInstanceBusy(params) {
      return instances.isBusy(params.instance);
    },
    async callTool(
      params: PluginUiCallToolParams,
      options?: { signal?: AbortSignal },
    ): Promise<PluginUiCallToolResult> {
      validate(params);
      // 复用正常工具执行器与审批：createMcpUiHandlers 只做归属 / 可见性校验，权限仍由 MCP 工具链决定。
      // pin 实例让连接换代 / 页面关闭时 abort 进行中的调用。
      const pin = instances.retain(params.instance.token, params.callId);
      try {
        const signal = options?.signal
          ? AbortSignal.any([options.signal, pin.signal])
          : pin.signal;
        return await handlers.callTool(access, params, { signal });
      } finally {
        pin.release();
      }
    },
    async cancelToolCall(params: PluginUiCancelToolCallParams) {
      validate(params);
      return handlers.cancelToolCall(access, params);
    },
    async readResource(params: PluginUiReadResourceParams): Promise<PluginUiReadResourceResult> {
      validate(params);
      return handlers.readResourceForUi(access, params);
    },
    async listResources(params: PluginUiListResourcesParams): Promise<PluginUiListResourcesResult> {
      validate(params);
      if (!access.listResourcesForUi) {
        throw new McpUiNotSupportedError(params.serverName, "resources/list");
      }
      return access.listResourcesForUi(params.serverName, params.cursor);
    },
    async listResourceTemplates(
      params: PluginUiListResourcesParams,
    ): Promise<PluginUiListResourceTemplatesResult> {
      validate(params);
      if (!access.listResourceTemplatesForUi) {
        throw new McpUiNotSupportedError(params.serverName, "resources/templates/list");
      }
      return access.listResourceTemplatesForUi(params.serverName, params.cursor);
    },
    async subscribeResource(params: PluginUiResourceSubscriptionParams): Promise<void> {
      validate(params);
      if (!access.subscribeResourceForUi) {
        throw new McpUiNotSupportedError(params.serverName, "resources/subscribe");
      }
      await access.subscribeResourceForUi(
        params.serverName,
        params.uri,
        subscriptionKey(params),
      );
    },
    async unsubscribeResource(params: PluginUiResourceSubscriptionParams): Promise<void> {
      validate(params);
      if (!access.unsubscribeResourceForUi) {
        throw new McpUiNotSupportedError(params.serverName, "resources/unsubscribe");
      }
      await access.unsubscribeResourceForUi(
        params.serverName,
        params.uri,
        subscriptionKey(params),
      );
    },
    async registerAppTools(params: PluginUiRegisterAppToolsParams): Promise<void> {
      validate(params);
      const { tools } = normalizeMcpAppsAppTools(params.tools);
      appTools.register({
        sessionId: params.sessionId,
        scopeId: params.scopeId,
        generation: params.instance.generation,
        instance: params.instance,
        serverName: params.serverName,
        pluginId: params.pluginId,
        tools,
      });
    },
    async unregisterAppTools(params: PluginUiInstanceScope): Promise<void> {
      appTools.unregister({
        sessionId: params.sessionId,
        scopeId: params.scopeId,
        generation: params.instance.generation,
        instance: params.instance,
      });
    },
    async claimAppToolCall(params: PluginUiAppToolCallParams): Promise<PluginUiAppToolCallAccepted> {
      validate(params);
      return appTools.claim({
        sessionId: params.sessionId,
        scopeId: params.scopeId,
        generation: params.instance.generation,
        callId: params.callId,
      });
    },
    async resolveAppToolCall(
      params: PluginUiResolveAppToolCallParams,
    ): Promise<PluginUiAppToolCallAccepted> {
      validate(params);
      return appTools.resolve({
        sessionId: params.sessionId,
        scopeId: params.scopeId,
        generation: params.instance.generation,
        callId: params.callId,
        ...(params.result ? { result: params.result } : {}),
        ...(params.error ? { error: params.error } : {}),
      });
    },
    subscribeAppToolCalls(handler: PluginUiAppToolMailboxHandler) {
      return appTools.subscribe(handler);
    },
    closeSession(sessionId) {
      for (const off of invalidations.values()) off();
      invalidations.clear();
      instances.closeSession(sessionId);
      appTools.closeSession(sessionId);
    },
    dispose() {
      for (const off of invalidations.values()) off();
      invalidations.clear();
      instances.clear();
      appTools.clear();
    },
  };
  bridgeRef = bridge;
  return bridge;
}

const subscriptionKey = (params: PluginUiResourceSubscriptionParams) =>
  `${params.scopeId}|${params.instance.generation}`;

/** 给模型执行器用：把一次 app tool 调用投递到实例信箱。 */
export function executeMcpUiAppTool(
  bridge: McpUiHostBridge,
  params: {
    sessionId: string;
    scopeId: string;
    /** 定义所属实例代际；提供时精确投递，避免同作用域换代后串页。 */
    generation?: number;
    toolName: string;
    arguments?: Record<string, unknown>;
    signal?: AbortSignal;
  },
) {
  return bridge.appTools.execute(params);
}
