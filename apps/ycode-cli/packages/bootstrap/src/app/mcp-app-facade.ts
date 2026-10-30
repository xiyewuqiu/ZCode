import { randomUUID } from "node:crypto";
import {
  createMcpAppProvidedToolEntry,
  createMcpToolEntry,
  toMcpToolName,
  type AgentRuntime,
} from "@ycode/core";
import { resolveMcpToolVisibility, type McpPort, type TraceContext } from "@ycode/contracts";
import type { McpAppHostFacade } from "./mcp-app-host.js";

export interface CreateMcpAppFacadeDeps {
  mcpPort?: McpPort;
  runtime: AgentRuntime;
  traceContext: TraceContext;
  workingDirectory: string;
}

/**
 * MCP App 在会话 facade 上的宿主面：
 * - 页面工具调用复用 executor 的权限 / 审批链，并固定批准时的连接代际；
 * - App-Provided Tools 整体替换到 runtime 工具表，重名时以既有工具为准。
 */
export function createMcpAppFacade(deps: CreateMcpAppFacadeDeps): McpAppHostFacade {
  /** 本会话已登记的模型侧 App 工具名；整体替换时先撤旧集合。 */
  let appProvidedToolNames: string[] = [];

  return {
    getMcpAppConnectionSnapshot: (name) =>
      deps.mcpPort?.appConnectionSnapshot?.(name) ?? null,
    onMcpAppConnectionInvalidated: (name, listener) =>
      deps.mcpPort?.onAppConnectionInvalidated?.(name, listener) ?? (() => {}),
    callMcpToolForUi: async (serverName, toolName, args, options) => {
      if (!deps.mcpPort) throw new Error("MCP is disabled");
      // 先固定签发/批准时的连接代际；授权期间连接变化只能失败，不能换连接重放。
      const snapshot = deps.mcpPort.appConnectionSnapshot?.(serverName);
      if (!snapshot) throw new Error("MCP App connection is unavailable");
      const descriptor = (await deps.mcpPort.listTools()).find(
        (tool) => tool.serverName === serverName && tool.toolName === toolName,
      );
      if (!descriptor || !resolveMcpToolVisibility(descriptor).includes("app")) {
        throw new Error("Tool is not available to this App");
      }
      const registry = deps.runtime.getToolRegistry();
      // 已注册的条目自带工具策略（含官方授权组）；没有时用同一 descriptor 现场构造，
      // 但绝不直接调用 mcpPort 绕过 executor 的审批 / hook。
      const registered = registry
        .list()
        .map((name) => registry.get(name))
        .find(
          (entry) =>
            entry?.metadata.mcpPresentation?.serverName === serverName &&
            entry.metadata.mcpPresentation.toolName === toolName,
        );
      const entry =
        registered ?? createMcpToolEntry(toMcpToolName(descriptor), descriptor, deps.mcpPort, false);
      const executor = deps.runtime.getToolExecutor();
      if (!executor.authorizeAppTool) {
        throw new Error("MCP App host authorization is unavailable");
      }
      const input = await executor.authorizeAppTool(
        { id: randomUUID(), name: entry.metadata.name, input: args ?? {} },
        entry,
        {
          ...(options?.signal ? { signal: options.signal } : {}),
          traceContext: deps.traceContext,
        },
      );
      // 审批期间连接可能被替换：批准只属于原连接，执行前必须再次验证。
      options?.signal?.throwIfAborted();
      const current = deps.mcpPort.appConnectionSnapshot?.(serverName);
      if (
        !current ||
        current.identity !== snapshot.identity ||
        current.generation !== snapshot.generation
      ) {
        throw new Error("MCP App connection changed during authorization");
      }
      return deps.mcpPort.callTool(
        {
          serverName,
          toolName,
          arguments: input as Record<string, unknown>,
          trace: deps.traceContext,
          runtimeScope: "main",
          workspacePath: deps.workingDirectory,
        },
        {
          ...(options?.signal ? { signal: options.signal } : {}),
          appConnection: snapshot,
        },
      );
    },
    replaceMcpAppProvidedTools: (definitions, execute) => {
      const registry = deps.runtime.getToolRegistry();
      for (const name of appProvidedToolNames) registry.unregister(name);
      const registered: string[] = [];
      for (const definition of definitions) {
        // 不覆盖内置 / MCP 工具：`app__` 前缀本不该冲突，冲突时以既有工具为准。
        if (registry.has(definition.modelName) || registered.includes(definition.modelName)) {
          continue;
        }
        registry.register(createMcpAppProvidedToolEntry(definition, execute), {
          silentDuplicateWarning: true,
        });
        registered.push(definition.modelName);
      }
      appProvidedToolNames = registered;
      // 同回合下一次模型请求即可见：只是让 getTools 重建缓存；工具集合没变时内容也不变。
      deps.runtime.invalidateToolCache();
      return registered;
    },
  };
}
