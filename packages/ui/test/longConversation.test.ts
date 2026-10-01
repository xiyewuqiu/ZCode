import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import {
  buildConversationTurnRenderUnits,
  createConversationTurnRenderer,
} from "../src/v4/conversationTurnRenderUnits.js";
import { buildConversationFindIndex } from "../src/v4/conversationFindIndex.js";
import { toolCallRowToLegacyNode } from "../src/v4/toolCallRowAdapter.js";
import { createConversationShareModel } from "../src/v4/conversationShareModel.js";
import { buildConversationTurnNavigatorItems } from "../src/v4/conversationTurnNavigatorHelpers.js";

const shareLabels = {
  assistantEmptyPreview: "Empty",
  assistantRunningPreview: "Running",
  userFallbackPreview: "Question",
};

test("closed sharing releases its projection and reopening uses the latest rows", () => {
  const project = createConversationShareModel();
  const dormant = project(null, shareLabels);
  assert.equal(dormant.items.length, 0);
  const rows = [...turn(1), ...turn(2, true)].map((row) => ({
    ...row,
    productTurnId: row.turnId,
  }));
  assert.equal(project(rows, shareLabels).items.length, 2);
  assert.equal(project(null, shareLabels), dormant);
  const replaced = turn(1).map((row) =>
    row.kind === "userInput" ? { ...row, text: "Replacement after rewind" } : row,
  );
  assert.equal(project(replaced, shareLabels).items[0]?.userPreview, "Replacement after rewind");
});

test("share projection preserves canonical candidates across streaming, pagination and locale", () => {
  const project = createConversationShareModel();
  const rows = [...turn(1), ...turn(2, true)].map((row) => ({
    ...row,
    productTurnId: row.turnId,
  }));
  const initial = project(rows, shareLabels);
  assert.deepEqual(
    initial.items,
    buildConversationTurnNavigatorItems(buildConversationTurnRenderUnits(rows), shareLabels),
  );
  assert.deepEqual([...initial.eligibleRowIds], [4]);
  assert.deepEqual(initial.availableTurns, [{ rowId: 4, productTurnId: "turn-1" }]);
  assert.deepEqual(initial.eligibleProductTurnIds, ["turn-1"]);
  const completed = [...turn(0), ...turn(1), ...turn(2)].map((row) => ({
    ...row,
    productTurnId: row.turnId,
  }));
  assert.deepEqual(project(completed, shareLabels).eligibleProductTurnIds, [
    "turn-0",
    "turn-1",
    "turn-2",
  ]);
  const emptyAnswer = turn(3).slice(0, 2);
  assert.equal(project(emptyAnswer, shareLabels).items[0]?.assistantPreview, "Empty");
  assert.equal(
    project(emptyAnswer, { ...shareLabels, assistantEmptyPreview: "暂无回复" }).items[0]
      ?.assistantPreview,
    "暂无回复",
  );
});

test("share projection deduplicates product turns without losing individual query candidates", () => {
  const rows = [...turn(1), ...turn(2)].map((row) => ({ ...row, productTurnId: "product-1" }));
  const result = createConversationShareModel()(rows, shareLabels);
  assert.equal(result.eligibleItems.length, 2);
  assert.equal(result.availableTurns.length, 2);
  assert.deepEqual(result.eligibleProductTurnIds, ["product-1"]);
});

function turn(id: number, running = false): ConversationRow[] {
  const base = { turnId: `turn-${id}`, createdAt: id, createdAtSeq: id };
  return [
    {
      ...base,
      rowId: id * 3,
      kind: "turnHeader",
      origin: "userInput",
      state: running ? "running" : "completedSuccess",
      startedAt: id,
      ...(running ? {} : { endedAt: id + 1 }),
    },
    {
      ...base,
      rowId: id * 3 + 1,
      kind: "userInput",
      origin: "realUser",
      text: `Question ${id}`,
      attachments: [],
    },
    {
      ...base,
      rowId: id * 3 + 2,
      kind: "assistantText",
      text: `Answer ${id}`,
      state: running ? "streaming" : "complete",
    },
  ];
}

test("streaming reuses completed turns and preserves canonical output", () => {
  const render = createConversationTurnRenderer();
  const rows = [...turn(1), ...turn(2, true)];
  const first = render(rows, { nowMs: 100 });
  const nextRows = rows.map((row) =>
    row.rowId === 8 && row.kind === "assistantText" ? { ...row, text: "updated" } : row,
  );
  const next = render(nextRows, { nowMs: 200 });
  assert.equal(next[0], first[0]);
  assert.notEqual(next[1], first[1]);
  assert.deepEqual(next, buildConversationTurnRenderUnits(nextRows, { nowMs: 200 }));
  const tick = render(nextRows, { nowMs: 300 });
  assert.equal(tick[0], next[0]);
  assert.equal(tick[1]!.renderRows, next[1]!.renderRows);
  assert.equal(tick[1]!.flowItems, next[1]!.flowItems);
  assert.deepEqual(tick, buildConversationTurnRenderUnits(nextRows, { nowMs: 300 }));
});

test("long-history projection benchmark keeps every historical unit stable", (t) => {
  const rows = Array.from({ length: 1000 }, (_, i) => turn(i + 1, i === 999)).flat();
  const render = createConversationTurnRenderer();
  const initial = render(rows, { nowMs: 10000 });
  const measure = (project: typeof render) => {
    const started = performance.now();
    let result = initial;
    for (let i = 0; i < 50; i++) {
      const next = rows.slice();
      const last = next.at(-1)!;
      if (last.kind === "assistantText") next[next.length - 1] = { ...last, text: `token ${i}` };
      result = project(next, { nowMs: 10000 + i });
    }
    return { duration: performance.now() - started, result };
  };
  const baseline = measure(buildConversationTurnRenderUnits);
  const cached = measure(render);
  for (let i = 0; i < 999; i++) assert.equal(cached.result[i], initial[i]);
  assert.deepEqual(cached.result, baseline.result);
  t.diagnostic(
    `1000 turns / 50 updates: canonical=${baseline.duration.toFixed(1)}ms cached=${cached.duration.toFixed(1)}ms`,
  );
});

test("cache handles pagination, corrections, rewind, hidden turns and phase changes", () => {
  const render = createConversationTurnRenderer();
  const rows = [...turn(2), ...turn(3, true)];
  const variants = [
    rows,
    [...turn(1), ...rows],
    [...turn(1), ...turn(2)],
    turn(1, true),
    turn(1),
    [],
    [...turn(4), turn(5)[0]!],
    turn(6).slice(1),
  ];
  for (const sessionPhase of ["running", "completedInterrupted", "completedSuccess"] as const) {
    for (const variant of variants) {
      const options = { nowMs: 1000, sessionPhase };
      assert.deepEqual(
        render(variant, options),
        buildConversationTurnRenderUnits(variant, options),
      );
    }
  }
});

test("guide clocks preserve historical segments and do not re-read message bodies", () => {
  const rows = turn(1, true);
  rows.push(
    {
      kind: "userInput",
      rowId: 6,
      turnId: "turn-1",
      createdAt: 10,
      createdAtSeq: 6,
      origin: "realUser",
      text: "guide",
      attachments: [],
      guided: true,
    },
    {
      kind: "assistantText",
      rowId: 7,
      turnId: "turn-1",
      createdAt: 11,
      createdAtSeq: 7,
      text: "working",
      state: "streaming",
    },
  );
  const render = createConversationTurnRenderer();
  const first = render(rows, { nowMs: 100 });
  const expected = buildConversationTurnRenderUnits(rows, { nowMs: 200 });
  for (const row of rows) {
    if (row.kind === "assistantText")
      Object.defineProperty(row, "text", {
        get() {
          throw new Error("clock read text");
        },
      });
  }
  const next = render(rows, { nowMs: 200 });
  assert.equal(next[0]!.workSegments![0], first[0]!.workSegments![0]);
  assert.equal(next[0]!.workSegments![1]!.flowItems, first[0]!.workSegments![1]!.flowItems);
  assert.deepEqual(next[0]!.workStatus, expected[0]!.workStatus);
  assert.deepEqual(
    next[0]!.workSegments!.map((segment) => segment.workStatus),
    expected[0]!.workSegments!.map((segment) => segment.workStatus),
  );
});

test("empty find query counts rows without reading or projecting their text", () => {
  const units = buildConversationTurnRenderUnits(turn(1));
  for (const row of [...units[0]!.visibleUserInputs, ...units[0]!.assistantTextRows]) {
    Object.defineProperty(row, "text", {
      get() {
        throw new Error("empty query read text");
      },
    });
  }
  assert.deepEqual(
    buildConversationFindIndex(units, "  ", { projectAssistantCodeComments: true }),
    {
      query: "",
      matches: [],
      matchCount: 0,
      loadedRowCount: 2,
    },
  );
});

test("tool conversion is cached by immutable row identity, not tool ID", () => {
  const row: ToolCallRow = {
    rowId: 1,
    turnId: "turn",
    createdAt: 1,
    createdAtSeq: 1,
    kind: "toolCall",
    toolCallId: "tool",
    toolName: "Read",
    status: "running",
    inputText: '{"path":"file.ts"}',
  };
  const first = toolCallRowToLegacyNode(row);
  assert.equal(toolCallRowToLegacyNode(row), first);
  const updated = toolCallRowToLegacyNode({
    ...row,
    status: "success",
    inputText: '{"path":"next.ts"}',
  });
  assert.notEqual(updated, first);
  assert.deepEqual(updated.toolCall.input, { path: "next.ts" });
  assert.equal(first.toolCall.status, "in_progress");
});
