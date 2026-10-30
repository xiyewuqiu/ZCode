import {
  MCP_UI_APP_TOOL_CALL_NOTIFICATION,
  mcpUiHostRequestSchema,
  mcpUiHostResponseSchema,
  type McpUiHostResponse,
  type McpUiPrepareResult,
  type PluginUiHostPort,
} from "@ycode/shared/mcp-apps";
import { ycodeProtocolErrorCodes } from "@ycode/shared";
import { ProtocolRequestError, type YCodeProtocolAgentServerContext, type YCodeProtocolSessionRecord } from "../server-types.js";
import { createMcpUiHostBridge, type McpUiHostBridge } from "./hostBridge.js";
import { abortMcpUiToolCallsForSession, clearMcpUiInstanceCalls } from "./handlers.js";
import { createMcpUiSessionAccess } from "./sessionAccess.js";

/**
 * `mcp/ui` 协议处理器：renderer → host(services) → CLI 的最后一跳。
 *
 * 归属与所有权：
 * - 会话查找 = `context.sessions`（单 CLI resident pool），workspace identity 优先于路径；
 *   请求里的 workspace 必须与会话记录一致，否则 -32602。
 * - 实例凭证 / 资源校验 / app-tools 信箱 = 每会话一个 `McpUiHostBridge`（本模块 Map 的唯一 owner）。
 * - 沙箱登记/main 的 guest = renderer 的 `IPlatformService.pluginSandbox`；CLI 只返回登记载荷。
 *
 * 幂等：`McpUiInstances.open` 对同一逻辑作用域 + 同一连接代际返回同一凭证，因此重复 prepare
 * 得到同一 instance / token；main 侧登记按 scopeId 幂等。
 */
interface SessionHostEntry {
  record: YCodeProtocolSessionRecord;
  bridge: McpUiHostBridgeHost;
  unsubscribeMailbox: () => void;
}

/**
 * `PluginUiHostPort` 的 app-tools 能力是可选的；本 bridge 实现始终提供，
 * 用窄类型把可选性收掉，避免在每个分支写同一份 undefined 兜底。
 */
type McpUiHostBridgeHost = McpUiHostBridge &
  Required<
    Pick<
      PluginUiHostPort,
      | "registerAppTools"
      | "unregisterAppTools"
      | "claimAppToolCall"
      | "resolveAppToolCall"
      | "subscribeAppToolCalls"
    >
  >;

const registryByContext = new WeakMap<
  YCodeProtocolAgentServerContext,
  Map<string, SessionHostEntry>
>();

function registryOf(
  context: YCodeProtocolAgentServerContext,
): Map<string, SessionHostEntry> {
  let registry = registryByContext.get(context);
  if (!registry) {
    registry = new Map();
    registryByContext.set(context, registry);
  }
  return registry;
}

function requireWorkspaceMatch(
  record: YCodeProtocolSessionRecord,
  workspace: { workspacePath: string; workspaceIdentity?: string; remoteSessionId?: string },
): void {
  const requested = workspace.workspaceIdentity?.trim() || workspace.workspacePath;
  const actual = record.workspace.workspaceIdentity?.trim() || record.workspace.workspacePath;
  const remoteMatches =
    !workspace.remoteSessionId ||
    !record.workspace.remoteSessionId ||
    workspace.remoteSessionId === record.workspace.remoteSessionId;
  if (requested !== actual || !remoteMatches) {
    throw new ProtocolRequestError(
      -32602,
      "MCP App request workspace does not match the session",
    );
  }
}

function requireSession(
  context: YCodeProtocolAgentServerContext,
  sessionId: string,
): YCodeProtocolSessionRecord {
  const record = context.sessions.get(sessionId);
  if (!record) {
    throw new ProtocolRequestError(
      ycodeProtocolErrorCodes.sessionUnavailable,
      `Session is not active: ${sessionId}`,
    );
  }
  return record;
}

function getSessionHost(
  context: YCodeProtocolAgentServerContext,
  record: YCodeProtocolSessionRecord,
  sessionId: string,
): SessionHostEntry {
  const registry = registryOf(context);
  const existing = registry.get(sessionId);
  // 冷恢复会换掉 record 对象：旧 bridge 的凭证只属于旧 runtime，必须整体丢弃。
  if (existing && existing.record === record) return existing;
  if (existing) disposeEntry(existing);

  const agentAccess = record.app.mcpUiAgentAccess?.();
  if (!agentAccess) {
    throw new ProtocolRequestError(-32601, "MCP Apps is not available in this session");
  }
  const bridge = createMcpUiHostBridge(createMcpUiSessionAccess(agentAccess), {
    ...(context.logger ? { logger: context.logger } : {}),
    // 页面登记的 app 工具整体同步到本会话 runtime；会话消失返回 null 由信箱清空。
    applyAppTools: (sessionId, definitions, execute) => {
      const current = context.sessions.get(sessionId);
      return current ? current.app.replaceMcpAppProvidedTools(definitions, execute) : null;
    },
  }) as McpUiHostBridgeHost;
  // 模型侧 app-tool 调用经 host 通知下发给唯一页面实例；renderer 按 token 过滤。
  const unsubscribeMailbox = bridge.subscribeAppToolCalls((event) => {
    context.notify({
      method: MCP_UI_APP_TOOL_CALL_NOTIFICATION,
      params: { sessionId, ...event },
    });
  });
  const entry: SessionHostEntry = { record, bridge, unsubscribeMailbox };
  registry.set(sessionId, entry);
  return entry;
}

function disposeEntry(entry: SessionHostEntry): void {
  entry.unsubscribeMailbox();
  entry.bridge.dispose();
}

/** 会话关闭 / 冷恢复替换时调用：撤销凭证、清信箱、abort 进行中的 UI 调用。 */
export function disposeMcpUiSessionHost(
  context: YCodeProtocolAgentServerContext,
  sessionId: string,
): void {
  const registry = registryOf(context);
  const entry = registry.get(sessionId);
  if (entry) {
    registry.delete(sessionId);
    disposeEntry(entry);
  }
  abortMcpUiToolCallsForSession(sessionId);
}

/** 会话关闭钩子未覆盖时的兜底：清掉记录已消失的会话（例如进程内直接删 record）。 */
function sweepMissingSessions(context: YCodeProtocolAgentServerContext): void {
  const registry = registryOf(context);
  for (const [sessionId, entry] of registry) {
    if (context.sessions.get(sessionId) === entry.record) continue;
    registry.delete(sessionId);
    disposeEntry(entry);
    abortMcpUiToolCallsForSession(sessionId);
  }
}

export async function handleMcpUiRpc(
  context: YCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<McpUiHostResponse> {
  // strict：未知键 / 错误 op 在协议边界直接拒绝，不做宽松降级。
  const request = mcpUiHostRequestSchema.parse(rawParams);
  sweepMissingSessions(context);
  const record = requireSession(context, request.sessionId);
  requireWorkspaceMatch(record, request.workspace);
  const { bridge } = getSessionHost(context, record, request.sessionId);

  const scope = {
    workspacePath: request.workspace.workspacePath,
    ...(request.workspace.workspaceIdentity
      ? { workspaceIdentity: request.workspace.workspaceIdentity }
      : {}),
    sessionId: request.sessionId,
    pluginId: request.pluginId,
    serverName: request.serverName,
    scopeId: request.scopeId,
  };

  switch (request.op) {
    case "prepare": {
      const prepared = await bridge.prepareRegistration({
        ...scope,
        resourceUri: request.resourceUri,
        toolName: request.toolName,
        ownerWebContentsId: request.ownerWebContentsId,
        ...(request.csp ? { csp: request.csp } : {}),
        ...(request.cspRelaxations ? { cspRelaxations: request.cspRelaxations } : {}),
        ...(request.prefersBorder !== undefined ? { prefersBorder: request.prefersBorder } : {}),
        ...(request.preferredDisplayMode
          ? { preferredDisplayMode: request.preferredDisplayMode }
          : {}),
        ...(request.surface ? { surface: request.surface } : {}),
      });
      return mcpUiHostResponseSchema.parse({
        op: "prepare",
        instance: prepared.instance,
        register: prepared.register,
      } satisfies McpUiPrepareResult);
    }
    case "validate":
      await bridge.validateInstance({ ...scope, instance: request.instance });
      return { op: "validate", ok: true };
    case "close": {
      await bridge.closeInstance({ ...scope, instance: request.instance });
      clearMcpUiInstanceCalls(request.sessionId, request.instance.token);
      return { op: "close", ok: true };
    }
    case "callTool": {
      const result = await bridge.callTool({
        ...scope,
        instance: request.instance,
        toolName: request.toolName,
        ...(request.arguments ? { arguments: request.arguments } : {}),
        callId: request.callId,
      });
      return mcpUiHostResponseSchema.parse({ op: "callTool", result });
    }
    case "cancelToolCall": {
      const { cancelled } = await bridge.cancelToolCall({
        ...scope,
        instance: request.instance,
        callId: request.callId,
      });
      return { op: "cancelToolCall", cancelled };
    }
    case "readResource": {
      const result = await bridge.readResource({
        ...scope,
        instance: request.instance,
        uri: request.uri,
      });
      return mcpUiHostResponseSchema.parse({ op: "readResource", result });
    }
    case "registerAppTools":
      await bridge.registerAppTools({
        ...scope,
        instance: request.instance,
        tools: request.tools,
      });
      return { op: "registerAppTools", ok: true };
    case "unregisterAppTools":
      await bridge.unregisterAppTools({ ...scope, instance: request.instance });
      return { op: "unregisterAppTools", ok: true };
    case "claimAppToolCall": {
      const { accepted } = await bridge.claimAppToolCall({
        ...scope,
        instance: request.instance,
        callId: request.callId,
      });
      return { op: "claimAppToolCall", accepted };
    }
    case "resolveAppToolCall": {
      const { accepted } = await bridge.resolveAppToolCall({
        ...scope,
        instance: request.instance,
        callId: request.callId,
        ...(request.result ? { result: request.result } : {}),
        ...(request.error ? { error: request.error } : {}),
      });
      return { op: "resolveAppToolCall", accepted };
    }
    default: {
      const exhaustive: never = request;
      throw new ProtocolRequestError(-32602, `Unsupported MCP UI op: ${String(exhaustive)}`);
    }
  }
}
