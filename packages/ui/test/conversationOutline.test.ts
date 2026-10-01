import assert from "node:assert/strict";
import test from "node:test";
import {
  filterConversationOutlineItems,
  resolveConversationOutlineSelection,
} from "../src/v4/conversationOutlineModel.js";
import {
  buildConversationTurnNavigatorItems,
  type ConversationTurnNavigatorItem,
} from "../src/v4/conversationTurnNavigatorHelpers.js";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.js";

function item(id: number, userText = `Question ${id}`): ConversationTurnNavigatorItem {
  return {
    key: `q-${id}`,
    rowId: id,
    unitIndex: id,
    turnId: `turn-${id}`,
    userText,
    userPreview: userText.slice(0, 20),
    assistantPreview: `Answer ${id} 数据库`,
    assistantPreviewKind: "text",
    isRunning: false,
  };
}

test("outline searches full questions and answer previews using literal AND terms", () => {
  const items = [item(1, `${"long question ".repeat(40)}深层关键词 A+B`), item(2)];
  assert.deepEqual(filterConversationOutlineItems(items, "深层关键词 a+b"), [items[0]]);
  assert.deepEqual(filterConversationOutlineItems(items, "数据库 ANSWER 2"), [items[1]]);
  assert.deepEqual(filterConversationOutlineItems(items, "absent"), []);
  assert.equal(filterConversationOutlineItems(items, "  "), items);
});

test("outline ordinal search is exact, bounded and uses loaded order", () => {
  const items = [item(200), item(900)];
  assert.deepEqual(filterConversationOutlineItems(items, "#2"), [items[1]]);
  for (const q of ["#0", "#3", "#999999999999999999999", "#-1"])
    assert.deepEqual(filterConversationOutlineItems(items, q), []);
});

test("selection survives prepending, falls back after filtering and handles empty results", () => {
  const items = [item(1), item(2)];
  assert.equal(resolveConversationOutlineSelection(items, "q-2", "q-1"), 1);
  assert.equal(resolveConversationOutlineSelection([item(0), ...items], "q-2", "q-1"), 2);
  assert.equal(resolveConversationOutlineSelection(items, "removed", "q-2"), 1);
  assert.equal(resolveConversationOutlineSelection(items, "removed", "gone"), 0);
  assert.equal(resolveConversationOutlineSelection([], "q-2", "q-1"), -1);
});

test("outline inherits canonical real-user query boundaries and retains untruncated text", () => {
  const text = "前言".repeat(300) + "隐藏关键词";
  const base = { turnId: "t", createdAt: 1, createdAtSeq: 1 };
  const units = buildConversationTurnRenderUnits([
    {
      ...base,
      rowId: 1,
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: 1,
      endedAt: 2,
    },
    { ...base, rowId: 2, kind: "userInput", origin: "realUser", text, attachments: [] },
    {
      ...base,
      rowId: 3,
      kind: "userInput",
      origin: "backgroundResult",
      text: "system secret",
      attachments: [],
    },
  ]);
  const items = buildConversationTurnNavigatorItems(units, {
    assistantEmptyPreview: "Empty",
    assistantRunningPreview: "Running",
    userFallbackPreview: "Question",
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.userText, text);
  assert.ok(!items[0]?.userPreview.includes("隐藏关键词"));
  assert.equal(filterConversationOutlineItems(items, "隐藏关键词").length, 1);
});
