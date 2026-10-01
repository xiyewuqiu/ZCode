import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { createConversationTurnRenderer } from "@/v4/conversationTurnRenderUnits.js";
import {
  buildConversationTurnNavigatorItems,
  type ConversationTurnNavigatorItem,
} from "@/v4/conversationTurnNavigatorHelpers.js";

export interface ConversationShareModel {
  items: readonly ConversationTurnNavigatorItem[];
  eligibleItems: readonly ConversationTurnNavigatorItem[];
  eligibleRowIds: ReadonlySet<number>;
  availableTurns: { rowId: number; productTurnId: string }[];
  eligibleProductTurnIds: string[];
}

const EMPTY_MODEL: ConversationShareModel = {
  items: [],
  eligibleItems: [],
  eligibleRowIds: new Set(),
  availableTurns: [],
  eligibleProductTurnIds: [],
};

/** 每个会话范围一个派生模型；不保存选择或服务端事实。 */
export function createConversationShareModel() {
  let render: ReturnType<typeof createConversationTurnRenderer> | null = null;
  return (
    rows: readonly ConversationRow[] | null,
    labels: Parameters<typeof buildConversationTurnNavigatorItems>[1],
  ): ConversationShareModel => {
    // 普通聊天原先每个 chunk 都构建完整分享目录；关闭时不读取历史，并释放上次缓存。
    if (rows === null) {
      render = null;
      return EMPTY_MODEL;
    }
    render ??= createConversationTurnRenderer();
    const items = buildConversationTurnNavigatorItems(render(rows), labels);
    const eligibleItems = items.filter((item) => !item.isRunning);
    const rowsById = new Map(rows.map((row) => [row.rowId, row]));
    const availableTurns = eligibleItems.flatMap((item) => {
      const productTurnId = rowsById.get(item.rowId)?.productTurnId;
      return productTurnId ? [{ rowId: item.rowId, productTurnId }] : [];
    });
    return {
      items,
      eligibleItems,
      eligibleRowIds: new Set(eligibleItems.map((item) => item.rowId)),
      availableTurns,
      eligibleProductTurnIds: [...new Set(availableTurns.map((turn) => turn.productTurnId))],
    };
  };
}
