// TreemappingPane 的数据源是 v4 conversation 投影 rows。
// Treemapping 只消费「一轮 assistant 输出的 toolCalls + 是否仍在流式」，这里把
// snapshot rows 里最后一个 assistant 轮的 ToolCallRow 适配回旧 TaskChatMessage 形态，
// 复用 treemappingActivity 的既有解析规则，不复活 ycodeChatMessages。
//
// TreemappingPane 挂在 side pane（V4ConversationProvider 之外），因此自持一条
// SessionDataLayer；pane 当前默认从侧边栏隐藏（workspaceSidePane sanitize 过滤
// treemapping tab），该订阅只在 pane 真实挂载时才会建立。
import { useEffect, useMemo, useState } from "react";
import type { ConversationRow, ToolCallRow } from "@ycode/shared/ycode-protocol-v4";
import type { TaskChatMessage } from "@/lib/taskChatMessageTypes.js";
import { useServices } from "@/hooks/useServices.js";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";
import { SessionDataLayer, type SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjectionSelector } from "@/v4/useConversationProjection.js";
import type {
  ConversationProjectionKey,
  ConversationStoreState,
} from "@/v4/conversationProjectionStore.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";

/** 只依赖 rows 窗口：state.updated（queue/status/usage 等）不唤醒 treemapping。 */
const ROWS_WINDOW_KEYS: readonly ConversationProjectionKey[] = ["rows.window"];
const selectRowsWindow = (state: ConversationStoreState) => state.snapshot?.rows.window;

const ASSISTANT_TURN_ROW_KINDS = new Set<ConversationRow["kind"]>([
  "assistantText",
  "reasoning",
  "toolCall",
  "subagent",
]);

/** 从 rows 窗口选出最后一个 assistant 轮，并适配为旧 TaskChatMessage 形态。 */
function buildTreemappingMessageFromRows(rows: readonly ConversationRow[]): TaskChatMessage | null {
  let lastAssistantTurnId: string | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (ASSISTANT_TURN_ROW_KINDS.has(row.kind)) {
      lastAssistantTurnId = row.turnId;
      break;
    }
  }
  if (lastAssistantTurnId === null) {
    return null;
  }

  const turnRows = rows.filter((row) => row.turnId === lastAssistantTurnId);
  const toolCallRows = turnRows.filter((row): row is ToolCallRow => row.kind === "toolCall");
  const streaming = turnRows.some(
    (row) =>
      ((row.kind === "assistantText" || row.kind === "reasoning") && row.state === "streaming") ||
      (row.kind === "toolCall" && (row.status === "inputStreaming" || row.status === "running")),
  );

  return {
    id: `v4-turn-${lastAssistantTurnId}`,
    role: "assistant",
    content: "",
    timestamp: 0,
    streaming: streaming || undefined,
    toolCalls: toolCallRows.map((row) => toolCallRowToLegacyNode(row).toolCall),
  };
}

/**
 * 订阅指定 session 的 v4 conversation 投影，返回 Treemapping 需要的合成 assistant 消息。
 * sessionId 为空时不订阅，返回 null。
 */
export function useTreemappingConversationMessage(params: {
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
}): TaskChatMessage | null {
  const { sessionId, workspacePath, workspaceIdentity } = params;
  const { ycodeAgentService } = useServices();
  const layer = useMemo(
    () =>
      new SessionDataLayer({
        transport: createAgentConversationTransport(ycodeAgentService, {
          workspacePath,
          workspaceIdentity,
        }),
      }),
    [ycodeAgentService, workspacePath, workspaceIdentity],
  );
  useEffect(() => {
    return () => layer.dispose();
  }, [layer]);

  const [lease, setLease] = useState<SessionLease | null>(null);
  useEffect(() => {
    if (!sessionId) {
      setLease(null);
      return;
    }
    const nextLease = layer.acquire(sessionId);
    setLease(nextLease);
    return () => {
      nextLease.release();
    };
  }, [layer, sessionId]);

  const rows = useConversationProjectionSelector(lease, selectRowsWindow, ROWS_WINDOW_KEYS);
  return useMemo(() => (rows ? buildTreemappingMessageFromRows(rows) : null), [rows]);
}
