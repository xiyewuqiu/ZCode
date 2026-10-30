import { useMemo } from "react";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/fileSummaryTypes.js";
import { PluginUiCard } from "@/plugin-ui/components/PluginUiCard.js";
import { usePluginUiHostContext } from "@/plugin-ui/components/PluginUiHostProvider.js";
import {
  parsePluginUiJson,
  readPluginUiDisplay,
  readPluginUiIdentity,
  type PluginUiDisplay,
} from "@/plugin-ui/domain/contract.js";

/** MCP 工具行里的单个 App 卡片；display.ui 缺省时不渲染，工具结果走原 renderer。 */
export function PluginUiToolCallCard({ context }: { context: ToolCallBlockRenderContext }) {
  const host = usePluginUiHostContext();
  const { toolCall } = context.toolCallNode;
  const rawDisplay = useMemo(() => {
    const raw = toolCall.raw;
    if (typeof raw !== "object" || raw === null) return null;
    return (raw as Record<string, unknown>).display;
  }, [toolCall.raw]);
  const display = useMemo(() => readPluginUiDisplay(rawDisplay), [rawDisplay]);
  const identity = useMemo(() => readPluginUiIdentity(rawDisplay), [rawDisplay]);
  const toolResult = useMemo(() => (display ? buildToolResult(display) : undefined), [display]);
  if (!display) return null;

  const serverName = identity.serverName ?? display.pluginId;
  const permissions = host.permissionsFor?.({
    serverName,
    pluginId: display.pluginId,
  });

  return (
    <PluginUiCard
      display={display}
      toolCallId={toolCall.toolId}
      serverName={serverName}
      toolName={identity.toolName ?? toolCall.toolName ?? ""}
      workspacePath={context.workspacePath}
      {...(context.theme ? { theme: context.theme } : {})}
      {...(toolCall.input !== undefined ? { toolInput: toolCall.input } : {})}
      {...(toolResult ? { toolResult } : {})}
      {...(toolCall.status === "stopped" ? { toolCancelled: true } : {})}
      {...(host.loader ? { appLoader: host.loader } : {})}
      {...(permissions && permissions.length > 0 ? { permissions: [...permissions] } : {})}
      className="mb-2"
    />
  );
}

/** display.ui 里持久化的 content / structuredContent 是 JSON 文本；坏 JSON 不阻断页面。 */
function buildToolResult(display: PluginUiDisplay): Record<string, unknown> | undefined {
  const content = parsePluginUiJson(display.content);
  const structuredContent = parsePluginUiJson(display.structuredContent);
  const blocks = Array.isArray(content) ? content : undefined;
  if (!blocks && structuredContent === undefined && !display.isError) return undefined;
  return {
    ...(blocks ? { content: blocks } : {}),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(display.isError ? { isError: true } : {}),
  };
}
