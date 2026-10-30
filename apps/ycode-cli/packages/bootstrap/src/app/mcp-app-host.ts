import type { McpAppProvidedToolDefinition, McpAppProvidedToolExecutor } from "@ycode/core";
import type { McpToolCallResult } from "@ycode/contracts";

/**
 * MCP App 宿主面在 `YCodeApp` 上的契约。放在单独文件里是因为 `types.ts` 已接近行数上限；
 * 行为实现同属 session facade（`mcp-app-facade.ts`）。
 */
export interface McpAppHostFacade {
  /** 当前 server 的可信连接快照（identity + generation）；未连接 / 端口不支持时返回 null。 */
  getMcpAppConnectionSnapshot(
    serverName: string,
  ): { identity: string; generation: number } | null;
  /** MCP server 连接代际变化时通知；返回取消订阅函数。 */
  onMcpAppConnectionInvalidated(serverName: string, listener: () => void): () => void;
  /**
   * 页面发起的 MCP App 工具调用：复用正常工具执行器与 turn 级权限 / 审批链，
   * 并把调用固定到批准时的连接代际。不能绕过 deny 规则、hook 或 permission broker。
   */
  callMcpToolForUi(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolCallResult>;
  /**
   * App-Provided Tools：用给定集合整体替换本会话的 App 工具，失效工具缓存让下一次模型请求可见。
   * 与非 App 工具重名的定义跳过。返回实际登记的模型侧名字。
   */
  replaceMcpAppProvidedTools(
    definitions: readonly McpAppProvidedToolDefinition[],
    execute: McpAppProvidedToolExecutor,
  ): string[];
}
