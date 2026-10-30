import type { IPlatformService } from "@ycode/shared";
import type { Event, IDisposable } from "@ycode/rpc";
import type {
  McpUiAppToolCallNotification,
  McpUiHostRequestBody,
  McpUiHostResponse,
  PluginSandboxHandle,
  PluginSandboxRegisterRequestPayload,
  PluginUiAppToolMailboxHandler,
  PluginUiHostPort,
} from "@ycode/shared/mcp-apps";
import type { YCodeAgentMcpUiParams } from "@ycode/services";
import type { PluginUiHostTarget } from "../domain/contract.js";

/**
 * renderer 侧的宿主适配器：把 `PluginUiHostPort` 接到
 * services(`mcp/ui` RPC) + `IPlatformService.pluginSandbox`。
 *
 * 所有权切分：
 * - 资源读取 / 实例凭证 / 工具与资源回环 / app-tools 信箱 = CLI（`mcp/ui` RPC）。
 * - 沙箱登记 / webview guest / 端口 / 权限 = main（`platform.pluginSandbox.registerSandbox`）。
 * - 桥、widgetState、卡片状态 = 本 renderer。
 *
 * 平台端口缺失（Web、旧 preload）时返回 null：上层 `usePluginUiAppRuntime` 落到 `no-host`，
 * 工具结果照常渲染——不伪造一个只能展示摘要的 host。
 */
export interface PluginUiAgentServicePort {
  mcpUi(params: YCodeAgentMcpUiParams): Promise<McpUiHostResponse>;
  onDynamicMcpUiAppToolCall(): Event<McpUiAppToolCallNotification>;
}

export interface CreateAgentPluginUiHostPortInput {
  service: PluginUiAgentServicePort;
  platform: IPlatformService | null | undefined;
  target: PluginUiHostTarget;
}

export function createAgentPluginUiHostPort(
  input: CreateAgentPluginUiHostPortInput,
): PluginUiHostPort | null {
  const sandbox = input.platform?.pluginSandbox;
  // 没有沙箱平台端口 = 无法在本平台渲染 MCP App；fail closed，而不是只回摘要。
  if (!sandbox?.registerSandbox) return null;
  const registerSandbox = sandbox.registerSandbox.bind(sandbox);
  const { target } = input;

  const send = async (request: McpUiHostRequestBody): Promise<McpUiHostResponse> => {
    const response = await input.service.mcpUi({ ...target, request });
    if (response.op !== request.op) {
      throw new Error(`MCP UI host returned ${response.op} for ${request.op}`);
    }
    return response;
  };

  const requestId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const port: PluginUiHostPort = {
    async prepareSandbox(params): Promise<PluginSandboxHandle> {
      const response = await send({
        op: "prepare",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        resourceUri: params.resourceUri,
        toolName: params.toolName,
        ownerWebContentsId: params.ownerWebContentsId,
        ...(params.csp ? { csp: params.csp } : {}),
        ...(params.cspRelaxations ? { cspRelaxations: params.cspRelaxations } : {}),
        ...(params.prefersBorder !== undefined ? { prefersBorder: params.prefersBorder } : {}),
        ...(params.preferredDisplayMode
          ? { preferredDisplayMode: params.preferredDisplayMode }
          : {}),
        ...(params.surface ? { surface: params.surface } : {}),
      });
      if (response.op !== "prepare") throw new Error("MCP UI prepare returned no registration");
      const payload: PluginSandboxRegisterRequestPayload = {
        ...response.register,
        // requestId 只是 main 侧回显关联；登记幂等键是 scopeId + 实例凭证。
        requestId: requestId(),
      };
      try {
        return await registerSandbox(payload);
      } catch (error) {
        // main 拒绝登记时撤销刚签发的凭证，避免留下无人认领的执行权。
        void send({
          op: "close",
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          instance: response.instance,
        }).catch(() => undefined);
        throw error;
      }
    },
    async validateInstance(params) {
      await send({
        op: "validate",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
      });
    },
    async closeInstance(params) {
      // 幂等撤销；RPC 失败不阻塞卡片 teardown（main 的 disposeSandbox 仍会释放 guest）。
      await send({
        op: "close",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
      }).catch(() => undefined);
    },
    async callTool(params) {
      const response = await send({
        op: "callTool",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
        toolName: params.toolName,
        ...(params.arguments ? { arguments: params.arguments } : {}),
        callId: params.callId,
      });
      if (response.op !== "callTool") throw new Error("MCP UI callTool returned no result");
      return response.result;
    },
    async cancelToolCall(params) {
      const response = await send({
        op: "cancelToolCall",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
        callId: params.callId,
      });
      return { cancelled: response.op === "cancelToolCall" ? response.cancelled : false };
    },
    async readResource(params) {
      const response = await send({
        op: "readResource",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
        uri: params.uri,
      });
      if (response.op !== "readResource") throw new Error("MCP UI readResource returned no result");
      return response.result;
    },
    async registerAppTools(params) {
      await send({
        op: "registerAppTools",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
        tools: params.tools,
      });
    },
    async unregisterAppTools(params) {
      await send({
        op: "unregisterAppTools",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
      }).catch(() => undefined);
    },
    async claimAppToolCall(params) {
      const response = await send({
        op: "claimAppToolCall",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
        callId: params.callId,
      });
      return { accepted: response.op === "claimAppToolCall" ? response.accepted : false };
    },
    async resolveAppToolCall(params) {
      const response = await send({
        op: "resolveAppToolCall",
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        instance: params.instance,
        callId: params.callId,
        ...(params.result ? { result: params.result } : {}),
        ...(params.error ? { error: params.error } : {}),
      });
      return { accepted: response.op === "resolveAppToolCall" ? response.accepted : false };
    },
    subscribeAppToolCalls(handler: PluginUiAppToolMailboxHandler): () => void {
      const subscription: IDisposable = input.service.onDynamicMcpUiAppToolCall()((event) => {
        // 通知是进程级广播：这里只按会话过滤，实例 token / scopeId 由 relay 在 execute 里再校验。
        if (event.sessionId === target.sessionId) handler(event);
      });
      return () => subscription.dispose();
    },
  };
  return port;
}
