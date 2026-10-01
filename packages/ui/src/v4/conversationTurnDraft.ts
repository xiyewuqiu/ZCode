import type {
  ConversationRow,
  HookInvocationRow,
  TurnHeaderRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import type { AssistantWorkRow } from "@/v4/conversationTurnFlowItems.js";

export interface DraftTurnRenderUnit {
  key: string;
  turnId: string;
  header?: TurnHeaderRow;
  userInputs: UserInputRow[];
  assistantWorkRows: AssistantWorkRow[];
  hookInvocations: HookInvocationRow[];
  orderedRows: ConversationRow[];
}

/** 按协议 turnId 聚合并保持首次出现次序，允许后台行与其他轮次交错。 */
export function groupConversationRows(
  rows: readonly ConversationRow[],
): Map<string, DraftTurnRenderUnit> {
  const units = new Map<string, DraftTurnRenderUnit>();
  for (const row of rows) {
    let unit = units.get(row.turnId);
    if (!unit) {
      // 补页会改变首个 rowId；key 必须来自稳定的 turnId，避免丢失测高和展开状态。
      unit = {
        key: row.turnId,
        turnId: row.turnId,
        userInputs: [],
        assistantWorkRows: [],
        hookInvocations: [],
        orderedRows: [],
      };
      units.set(row.turnId, unit);
    }
    if (row.kind === "turnHeader") {
      unit.header = row;
      continue;
    }
    unit.orderedRows.push(row);
    if (row.kind === "userInput") unit.userInputs.push(row);
    else if (row.kind === "hookInvocation") unit.hookInvocations.push(row);
    else unit.assistantWorkRows.push(row);
  }
  return units;
}
