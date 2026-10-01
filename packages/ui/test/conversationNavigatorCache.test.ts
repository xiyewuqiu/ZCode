import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationTurnNavigatorItems,
  createConversationTurnNavigatorProjector,
} from "../src/v4/conversationTurnNavigatorHelpers.js";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.js";

const options = {
  assistantEmptyPreview: "Empty",
  assistantRunningPreview: "Running",
  userFallbackPreview: "Question",
};

function turn(id: number, text = `Answer ${id}`) {
  const base = { turnId: `turn-${id}`, createdAt: id, createdAtSeq: id };
  return buildConversationTurnRenderUnits([
    {
      ...base,
      rowId: id * 3,
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: id,
      endedAt: id + 1,
    },
    {
      ...base,
      rowId: id * 3 + 1,
      kind: "userInput",
      origin: "realUser",
      text: `Question ${id}`,
      attachments: [],
    },
    { ...base, rowId: id * 3 + 2, kind: "assistantText", text, state: "complete" },
  ])[0]!;
}

test("unchanged history reuses items without reading message bodies", () => {
  const project = createConversationTurnNavigatorProjector();
  const history = turn(1);
  const first = project([history, turn(2)], options);
  Object.defineProperty(history.visibleUserInputs[0]!, "text", {
    get() {
      throw new Error("unchanged history body was read");
    },
  });
  const next = project([history, turn(2, "updated")], options);
  assert.equal(next[0], first[0]);
  assert.equal(next[1]?.assistantPreview, "updated");
});

test("pagination, rewind, corrections, configuration and independent owners match full projection", () => {
  const project = createConversationTurnNavigatorProjector();
  const a = turn(1, "123456789 long answer\n\nsecond paragraph");
  const b = turn(2);
  for (const config of [
    options,
    { ...options, maxPreviewChars: 8 },
    { ...options, maxPreviewParagraphs: 1 },
    {
      ...options,
      assistantEmptyPreview: "空",
      userFallbackPreview: "问题",
      assistantRunningPreview: "运行中",
    },
  ]) {
    for (const units of [[b], [a, b], [a], [], [turn(1, "corrected"), b]]) {
      assert.deepEqual(project(units, config), buildConversationTurnNavigatorItems(units, config));
    }
  }
  const second = createConversationTurnNavigatorProjector();
  assert.notEqual(project([a], options)[0], second([a], options)[0]);
});

test("translated fallbacks, running state and hidden turns do not reuse stale output", () => {
  const project = createConversationTurnNavigatorProjector();
  const original = turn(1);
  const empty = {
    ...original,
    assistantTextRows: [],
    visibleUserInputs: original.visibleUserInputs.map((row) => ({ ...row, text: "" })),
  };
  const translated = {
    assistantEmptyPreview: "空",
    assistantRunningPreview: "运行中",
    userFallbackPreview: "问题",
  };
  assert.equal(project([empty], options)[0]?.assistantPreview, "Empty");
  const localized = project([empty], translated)[0]!;
  assert.equal(localized.assistantPreview, "空");
  assert.equal(localized.userPreview, "问题");
  const running = { ...empty, isRunning: true };
  assert.equal(project([running], translated)[0]?.assistantPreview, "运行中");
  assert.deepEqual(project([{ ...running, timelineOnly: true }], translated), []);
  assert.deepEqual(
    project([original], options),
    buildConversationTurnNavigatorItems([original], options),
  );
});

test("1000-turn navigation benchmark preserves all historical items", (t) => {
  const history = Array.from({ length: 999 }, (_, i) => turn(i + 1));
  const frames = Array.from({ length: 50 }, (_, i) => [...history, turn(1000, `token ${i}`)]);
  const project = createConversationTurnNavigatorProjector();
  const first = project(frames[0]!, options);
  const measure = (build: typeof project) => {
    const start = performance.now();
    let result = first;
    for (const frame of frames) result = build(frame, options);
    return { ms: performance.now() - start, result };
  };
  const full = measure(buildConversationTurnNavigatorItems);
  const cached = measure(project);
  assert.deepEqual(cached.result, full.result);
  for (let i = 0; i < history.length; i++) assert.equal(cached.result[i], first[i]);
  t.diagnostic(
    `1000 turns / 50 updates: full=${full.ms.toFixed(1)}ms cached=${cached.ms.toFixed(1)}ms`,
  );
});
