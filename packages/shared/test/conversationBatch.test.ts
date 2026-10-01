import assert from "node:assert/strict";
import test from "node:test";
import { applyConversationDelta, applyConversationDeltas } from "../src/zcode-protocol-v4/apply.js";
import { conversationSnapshotSchema } from "../src/zcode-protocol-v4/snapshot.js";
import type { ConversationDelta } from "../src/zcode-protocol-v4/delta.js";
import type { ConversationRow } from "../src/zcode-protocol-v4/rows.js";

function textRow(rowId: number): ConversationRow {
  return {
    kind: "assistantText",
    rowId,
    turnId: "turn",
    createdAt: rowId,
    createdAtSeq: rowId,
    text: `row-${rowId}`,
    state: "streaming",
  };
}

function snapshotWithRows(count: number) {
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId: "synthetic",
    logEpoch: "epoch",
    seq: 0,
    revision: 0,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: true,
      stopState: "stoppable",
      stopTargetKind: "assistant",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: Object.fromEntries(
      [
        "fork",
        "compact",
        "switchModelConfig",
        "setFollowupMode",
        "queueEdit",
        "sendQueuedNow",
        "pauseGoal",
        "resumeGoal",
      ].map((key) => [key, { allowed: true }]),
    ),
    inputRouting: { mode: "guide" },
    config: { provider: "", model: "", thought: "", followupMode: "queue" },
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: {
      window: Array.from({ length: count }, (_, i) => textRow(i + 1)),
      totalCount: count,
      firstRowId: count ? 1 : null,
    },
  });
}

function freezeDeep(value: unknown) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
}

test("batched frames preserve ordered reducer semantics without mutating published snapshots", () => {
  const snapshot = snapshotWithRows(2000);
  const original = structuredClone(snapshot);
  freezeDeep(snapshot);
  const deltas: ConversationDelta[] = [];
  for (let i = 0; i < 100; i++) {
    deltas.push({ op: "row.delta", rowId: 2000 - i, path: "text", append: " delta" });
    deltas.push({ op: "row.appended", row: textRow(2001 + i) });
    deltas.push({ op: "row.upserted", row: textRow(1999 - i) });
  }
  deltas.push(
    { op: "state.updated", patch: { meta: { title: "new", titleSource: "custom" } } },
    { op: "row.removed", fromRowId: 2050 },
    { op: "row.delta", rowId: 2099, path: "text", append: "not loaded" },
    { op: "row.upserted", row: textRow(9999) },
    { op: "row.appended", row: textRow(3000) },
  );
  const expected = deltas.reduce(applyConversationDelta, snapshot);
  const result = applyConversationDeltas(snapshot, deltas);
  assert.deepEqual(result, expected);
  assert.deepEqual(snapshot, original);
  assert.equal(result.rows.window[0], snapshot.rows.window[0]);
  assert.deepEqual(
    applyConversationDeltas(result, [
      { op: "row.removed", fromRowId: 1 },
      { op: "row.appended", row: textRow(4000) },
    ]).rows,
    { window: [textRow(4000)], firstRowId: 4000, totalCount: 1 },
  );
});

test("empty and state-only batches preserve the row window identity", () => {
  const snapshot = snapshotWithRows(3);
  assert.equal(applyConversationDeltas(snapshot, []), snapshot);
  const result = applyConversationDeltas(snapshot, [
    { op: "state.updated", patch: { revision: 2 } },
    { op: "state.updated", patch: { queue: { items: [], autoDrain: false } } },
  ]);
  assert.equal(result.rows, snapshot.rows);
  assert.equal(snapshot.queue.autoDrain, true);
});

test("all stream paths and missing targets agree with the reference reducer", () => {
  const snapshot = snapshotWithRows(1);
  const deltas: ConversationDelta[] = [
    {
      op: "row.appended",
      row: {
        rowId: 2,
        turnId: "turn",
        createdAt: 2,
        createdAtSeq: 2,
        kind: "toolCall",
        toolCallId: "tool",
        toolName: "Bash",
        status: "running",
        inputText: "",
        output: { text: "", truncated: false },
      },
    },
    {
      op: "row.appended",
      row: {
        rowId: 3,
        turnId: "turn",
        createdAt: 3,
        createdAtSeq: 3,
        kind: "subagent",
        subagentType: "general",
        status: "running",
        summaryText: "",
      },
    },
    ...(["text", "inputText", "output.text", "summaryText"] as const).flatMap((path) =>
      [1, 2, 3, 99].map((rowId) => ({ op: "row.delta" as const, rowId, path, append: "fragment" })),
    ),
  ];
  assert.deepEqual(
    applyConversationDeltas(snapshot, deltas),
    deltas.reduce(applyConversationDelta, snapshot),
  );
});

test("large-frame benchmark agrees with single-delta semantics", (t) => {
  const snapshot = snapshotWithRows(20000);
  const deltas: ConversationDelta[] = Array.from({ length: 256 }, (_, i) => ({
    op: "row.delta",
    rowId: 20000 - i,
    path: "text",
    append: "token",
  }));
  const start = performance.now();
  const reference = deltas.reduce(applyConversationDelta, snapshot);
  const middle = performance.now();
  const result = applyConversationDeltas(snapshot, deltas);
  const end = performance.now();
  assert.deepEqual(result, reference);
  t.diagnostic(
    `20000 rows / 256 deltas: sequential=${(middle - start).toFixed(1)}ms batch=${(end - middle).toFixed(1)}ms`,
  );
});
