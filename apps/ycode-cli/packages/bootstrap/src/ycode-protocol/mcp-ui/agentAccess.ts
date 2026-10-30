import type {
  McpCallToolOptions,
  McpPort,
  McpReadResourceResult,
  McpToolCallResult,
  McpToolDescriptor,
  TraceContext,
} from "@ycode/contracts";

/**
 * 会话内 MCP 访问面（由 `createYCodeApp` 装配，App 是 mcpPort 的唯一 owner）。
 * MCP Apps 宿主 bridge 只依赖这几个窄能力：工具描述（可见性 / `_meta.ui`）、调用与资源读取。
 * 资源列表 / 订阅不在 McpPort 上，adapter 因此不实现，页面得到 -32601。
 */
export interface McpUiAgentAccess {
  hasMcpServer(serverName: string): Promise<boolean>;
  listToolDescriptors(): Promise<readonly McpToolDescriptor[]>;
  callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolCallResult>;
  /**
   * 页面发起的调用：复用正常工具执行器与 turn 级权限 / 审批链，并固定连接代际。
   * 缺省（旧装配 / mock）时回退到直接 `callTool`，仅保留可见性校验。
   */
  callToolForUi?(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolCallResult>;
  readResource(
    serverName: string,
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpReadResourceResult>;
  /** 连接快照：凭证只在签发它的连接代际内有效；端口不支持时返回 null。 */
  getMcpAppConnectionSnapshot?(
    serverName: string,
  ): { identity: string; generation: number } | null;
  /** 连接代际变化时通知；缺省表示不主动撤销。 */
  onMcpAppConnectionInvalidated?(serverName: string, listener: () => void): () => void;
}

export interface CreateMcpUiAgentAccessInput {
  mcpPort?: McpPort;
  /** 项目级 untrusted MCP server：本会话不连接，页面也不能渲染它们的 App。 */
  untrustedServerNames: ReadonlySet<string>;
  traceContext: TraceContext;
  workingDirectory: string;
  workspaceIdentity?: string;
  /** 由 session facade 注入：页面调用必须走 executor 的权限 / 审批边界。 */
  callToolForUi?: McpUiAgentAccess["callToolForUi"];
}

/** MCP 未启用 / 该会话没有端口时不构造：宿主 fail closed 为「无 MCP App 能力」。 */
export function createMcpUiAgentAccess(
  input: CreateMcpUiAgentAccessInput,
): McpUiAgentAccess | undefined {
  const { mcpPort } = input;
  if (!mcpPort) return undefined;

  const callOptions = (options?: { signal?: AbortSignal }): McpCallToolOptions => ({
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  return {
    async hasMcpServer(serverName) {
      if (input.untrustedServerNames.has(serverName)) return false;
      // statuses 覆盖会话实际连接的 server（含 create 时下发的临时配置与内置 server）；
      // 不按 configuredMcpServers 名单二次过滤，避免漏掉运行时注入的 server。
      const statuses = await mcpPort.status();
      return statuses[serverName] !== undefined;
    },
    listToolDescriptors: () => mcpPort.listTools(),
    async callTool(serverName, toolName, args, options) {
      return mcpPort.callTool(
        {
          serverName,
          toolName,
          ...(args !== undefined ? { arguments: args } : {}),
          trace: input.traceContext,
          runtimeScope: "main",
          workspacePath: input.workingDirectory,
          ...(input.workspaceIdentity
            ? { workspaceIdentity: input.workspaceIdentity, workspaceKey: input.workspaceIdentity }
            : { workspaceKey: input.workingDirectory }),
        },
        callOptions(options),
      );
    },
    async readResource(serverName, uri, options) {
      if (!mcpPort.readResource) {
        throw new Error(`MCP server "${serverName}" does not support resources/read`);
      }
      return mcpPort.readResource(
        { serverName, uri, trace: input.traceContext },
        callOptions(options),
      );
    },
    ...(input.callToolForUi ? { callToolForUi: input.callToolForUi } : {}),
    getMcpAppConnectionSnapshot: (serverName) =>
      mcpPort.appConnectionSnapshot?.(serverName) ?? null,
    onMcpAppConnectionInvalidated: (serverName, listener) =>
      mcpPort.onAppConnectionInvalidated?.(serverName, listener) ?? (() => {}),
  };
}
