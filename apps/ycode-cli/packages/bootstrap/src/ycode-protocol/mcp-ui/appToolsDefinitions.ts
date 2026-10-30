import type { McpAppProvidedToolDefinition } from "@ycode/core";
import {
  buildMcpAppsAppToolModelName,
  type McpAppsAppToolDescriptor,
} from "@ycode/shared/mcp-apps";

/** 信箱里参与模型工具同步的实例视图（只读）。 */
export interface McpUiAppToolDefinitionSource {
  serverName: string;
  pluginId: string;
  scopeId: string;
  generation: number;
  /** 首次登记序号：同 server 只暴露最近登记的实例。 */
  seq: number;
  tools: readonly McpAppsAppToolDescriptor[];
}

export type McpUiAppToolRetainExecution = (
  scopeId: string,
  generation: number,
  callId: string,
) => { signal: AbortSignal; release(): void };

/**
 * 计算暴露给模型的 App 工具集合：同 server 只暴露最近登记的实例，模型名冲突只留第一条。
 * 纯函数；`retainExecution` 由宿主注入，使模型调用在审批前 pin 住实例。
 */
export function buildMcpUiAppToolDefinitions(
  sources: Iterable<McpUiAppToolDefinitionSource>,
  retainExecution?: McpUiAppToolRetainExecution,
): McpAppProvidedToolDefinition[] {
  const latestByServer = new Map<string, McpUiAppToolDefinitionSource>();
  for (const source of sources) {
    const current = latestByServer.get(source.serverName);
    if (!current || source.seq > current.seq) latestByServer.set(source.serverName, source);
  }
  const definitions: McpAppProvidedToolDefinition[] = [];
  const seen = new Set<string>();
  const servers = Array.from(latestByServer.values()).sort((a, b) =>
    a.serverName.localeCompare(b.serverName),
  );
  for (const source of servers) {
    for (const tool of source.tools) {
      const modelName = buildMcpAppsAppToolModelName(source.serverName, tool.name);
      if (seen.has(modelName)) continue;
      seen.add(modelName);
      definitions.push({
        ...(retainExecution
          ? {
              retainExecution: (callId: string) =>
                retainExecution(source.scopeId, source.generation, callId),
            }
          : {}),
        modelName,
        serverName: source.serverName,
        pluginId: source.pluginId,
        scopeId: source.scopeId,
        generation: source.generation,
        toolName: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(tool.annotations?.readOnlyHint !== undefined
          ? { readOnlyHint: tool.annotations.readOnlyHint }
          : {}),
        ...(tool.annotations?.destructiveHint !== undefined
          ? { destructiveHint: tool.annotations.destructiveHint }
          : {}),
        ...(tool.annotations?.idempotentHint !== undefined
          ? { idempotentHint: tool.annotations.idempotentHint }
          : {}),
      });
    }
  }
  return definitions;
}
