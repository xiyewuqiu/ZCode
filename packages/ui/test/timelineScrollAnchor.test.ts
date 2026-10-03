import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorActionAfterContentChange,
  countNewMessageRowsSince,
  distanceToBottom,
  historyPrefetchTriggerPx,
  initialFollowing,
  isAtBottom,
  prependScrollAdjustment,
  prependVirtualAnchorAdjustment,
  reconcileFollowingForContentAnchor,
  resolveFollowingAfterScroll,
  resolveScrollOwnership,
  shouldAdjustVirtualizerForItemSizeChange,
  shouldShowBackToBottom,
  shouldTriggerLoadOlder,
  timelineKeyboardScrollIntent,
  timelineTouchScrollIntent,
  timelineWheelScrollIntent,
} from "../src/v4/timelineScrollAnchor.js";

// 滚动所有权（pinned / unlocked / jumping）与 prepend 锚定是时间线的单一写入者：
// 一旦回归，用户上滑会被流式拽回、前插历史会跳位、新消息计数会算错。
// 这里锁定纯逻辑分支，浏览器 fixture 只能覆盖其中一小部分真实交互路径。

const metrics = (scrollTop: number, contentHeight = 1000, viewportHeight = 200) => ({
  scrollTop,
  contentHeight,
  viewportHeight,
});

test("distanceToBottom clamps to zero when content fits the viewport", () => {
  assert.equal(distanceToBottom(metrics(0, 180, 200)), 0);
  assert.equal(distanceToBottom(metrics(800)), 0);
  assert.equal(distanceToBottom(metrics(700)), 100);
});

test("isAtBottom honours the epsilon so sub-pixel and padding tails still count as bottom", () => {
  // distanceToBottom = 1000 - 200 - scrollTop = 800 - scrollTop
  assert.equal(isAtBottom(metrics(752)), true); // 距底 48，正好命中容差
  assert.equal(isAtBottom(metrics(760)), true); // 距底 40 < 48
  assert.equal(isAtBottom(metrics(770)), true); // 距底 30 < 48
  assert.equal(isAtBottom(metrics(700)), false); // 距底 100 > 48
});

test("only user scroll may change following; programmatic and layout writes preserve it", () => {
  assert.equal(
    resolveFollowingAfterScroll({ following: true, metrics: metrics(0), source: "user" }),
    false,
  );
  assert.equal(
    resolveFollowingAfterScroll({ following: false, metrics: metrics(800), source: "user" }),
    true,
  );
  assert.equal(
    resolveFollowingAfterScroll({ following: true, metrics: metrics(0), source: "programmatic" }),
    true,
  );
  assert.equal(
    resolveFollowingAfterScroll({ following: false, metrics: metrics(800), source: "layout" }),
    false,
  );
});

test("content change sticks to bottom only while following and not mid width resize", () => {
  assert.equal(anchorActionAfterContentChange(true), "stickToBottom");
  assert.equal(anchorActionAfterContentChange(true, true), "hold");
  assert.equal(anchorActionAfterContentChange(false), "hold");
});

test("virtualizer size compensation is suppressed while following or during a width change", () => {
  const base = { itemEnd: 100, scrollTop: 200 };
  assert.equal(
    shouldAdjustVirtualizerForItemSizeChange({
      ...base,
      following: true,
      suppressAdjustment: false,
      contentWidthChanging: false,
    }),
    false,
  );
  assert.equal(
    shouldAdjustVirtualizerForItemSizeChange({
      ...base,
      following: false,
      suppressAdjustment: true,
      contentWidthChanging: false,
    }),
    false,
  );
  assert.equal(
    shouldAdjustVirtualizerForItemSizeChange({
      ...base,
      following: false,
      suppressAdjustment: false,
      contentWidthChanging: true,
    }),
    false,
  );
  // 只有「已解除跟随」且改动发生在视口上方时补偿，避免把用户顶过目标位置。
  assert.equal(
    shouldAdjustVirtualizerForItemSizeChange({
      ...base,
      following: false,
      suppressAdjustment: false,
      contentWidthChanging: false,
    }),
    true,
  );
  assert.equal(
    shouldAdjustVirtualizerForItemSizeChange({
      ...base,
      itemEnd: 300,
      following: false,
      suppressAdjustment: false,
      contentWidthChanging: false,
    }),
    false,
  );
});

test("wheel/touch intent maps physical direction to reading direction", () => {
  assert.equal(timelineWheelScrollIntent(-100), "awayFromBottom");
  assert.equal(timelineWheelScrollIntent(100), "towardBottom");
  assert.equal(timelineWheelScrollIntent(0), "none");
  // 手指下移表示阅读更早内容。
  assert.equal(timelineTouchScrollIntent(100, 140), "awayFromBottom");
  assert.equal(timelineTouchScrollIntent(140, 100), "towardBottom");
  assert.equal(timelineTouchScrollIntent(100, 100), "none");
});

test("keyboard scroll intent ignores editable targets and maps navigation keys", () => {
  const key = (k: string, shiftKey = false, editableTarget = false) =>
    timelineKeyboardScrollIntent({ key: k, shiftKey, editableTarget });
  assert.equal(key("ArrowUp"), "awayFromBottom");
  assert.equal(key("PageUp"), "awayFromBottom");
  assert.equal(key("Home"), "awayFromBottom");
  assert.equal(key("ArrowDown"), "towardBottom");
  assert.equal(key("PageDown"), "towardBottom");
  assert.equal(key("End"), "towardBottom");
  assert.equal(key(" "), "towardBottom");
  assert.equal(key(" ", true), "awayFromBottom");
  assert.equal(key("a"), "none");
  assert.equal(key("ArrowUp", false, true), "none");
});

test("reconcile: explicit upward intent always yields the scroll right to the user", () => {
  assert.equal(
    reconcileFollowingForContentAnchor({
      following: true,
      metrics: metrics(800),
      lastObservedScrollTop: 800,
      userScrollIntent: "awayFromBottom",
    }),
    false,
  );
});

test("reconcile: absence of user input preserves following across measurement commits", () => {
  assert.equal(
    reconcileFollowingForContentAnchor({
      following: true,
      metrics: metrics(600),
      lastObservedScrollTop: 800,
      userScrollIntent: "none",
    }),
    true,
  );
});

test("reconcile: downward intent re-pins only when the commit actually lands at the bottom", () => {
  assert.equal(
    reconcileFollowingForContentAnchor({
      following: false,
      metrics: metrics(800),
      lastObservedScrollTop: 800,
      userScrollIntent: "towardBottom",
    }),
    true,
  );
  // 明显回退（未观察到的上滚）判定为解除跟随，其余保持原值。
  assert.equal(
    reconcileFollowingForContentAnchor({
      following: true,
      metrics: metrics(700),
      lastObservedScrollTop: 800,
      userScrollIntent: "towardBottom",
    }),
    false,
  );
  assert.equal(
    reconcileFollowingForContentAnchor({
      following: true,
      metrics: metrics(799),
      lastObservedScrollTop: 800,
      userScrollIntent: "towardBottom",
    }),
    true,
  );
});

test("back-to-bottom entry appears only when unfollowed with content present", () => {
  assert.equal(shouldShowBackToBottom(false, 3), true);
  assert.equal(shouldShowBackToBottom(false, 0), false);
  assert.equal(shouldShowBackToBottom(true, 3), false);
  assert.equal(initialFollowing(), true);
});

test("ownership projects jumping over pinned/unlocked", () => {
  assert.equal(resolveScrollOwnership({ following: true, jumping: false }), "pinned");
  assert.equal(resolveScrollOwnership({ following: false, jumping: false }), "unlocked");
  assert.equal(resolveScrollOwnership({ following: true, jumping: true }), "jumping");
  assert.equal(resolveScrollOwnership({ following: false, jumping: true }), "jumping");
});

const rows = [
  { rowId: 1, kind: "userInput" },
  { rowId: 2, kind: "toolCall" },
  { rowId: 3, kind: "assistantText" },
  { rowId: 4, kind: "reasoning" },
  { rowId: 5, kind: "userInput" },
  { rowId: 6, kind: "assistantText" },
];

test("new-message count only counts user/assistant message rows after the unlock anchor", () => {
  assert.equal(countNewMessageRowsSince(rows, 1), 3); // 3 / 5 / 6
  assert.equal(countNewMessageRowsSince(rows, 3), 2); // 5 / 6
  assert.equal(countNewMessageRowsSince(rows, 5), 1); // 6
  assert.equal(countNewMessageRowsSince(rows, 6), 0);
});

test("new-message count refuses to guess when the anchor is missing or rewind dropped it", () => {
  assert.equal(countNewMessageRowsSince(rows, null), 0);
  assert.equal(countNewMessageRowsSince(rows, undefined), 0);
  assert.equal(countNewMessageRowsSince(rows, 999), 0);
});

test("prependVirtualAnchorAdjustment restores the exact reading offset in absolute terms", () => {
  const previous = { key: "turn-a", offsetTop: 120, start: 500 };
  assert.equal(
    prependVirtualAnchorAdjustment(previous, { key: "turn-a", offsetTop: 120, start: 700 }, 620),
    -40, // next.start(700) - previous.offsetTop(120) - currentScrollTop(620)
  );
  // key 变化（rewind / 换会话）不能当作前插。
  assert.equal(
    prependVirtualAnchorAdjustment(previous, { key: "turn-b", offsetTop: 120, start: 700 }, 620),
    null,
  );
  assert.equal(
    prependVirtualAnchorAdjustment(
      { key: "turn-a", offsetTop: NaN, start: 500 },
      { key: "turn-a", offsetTop: 120, start: 700 },
      620,
    ),
    null,
  );
});

test("prependScrollAdjustment shifts only for a real prepend with grown total size", () => {
  assert.equal(
    prependScrollAdjustment({
      prevFirstRowId: 10,
      nextFirstRowId: 4,
      prevTotalSize: 1000,
      nextTotalSize: 1400,
    }),
    400,
  );
  // 追加 / 替换 / 清空 / 首帧都不动滚动位置。
  assert.equal(
    prependScrollAdjustment({
      prevFirstRowId: 10,
      nextFirstRowId: 12,
      prevTotalSize: 1000,
      nextTotalSize: 1400,
    }),
    null,
  );
  assert.equal(
    prependScrollAdjustment({
      prevFirstRowId: null,
      nextFirstRowId: 4,
      prevTotalSize: 0,
      nextTotalSize: 1400,
    }),
    null,
  );
  assert.equal(
    prependScrollAdjustment({
      prevFirstRowId: 10,
      nextFirstRowId: 4,
      prevTotalSize: 1400,
      nextTotalSize: 1000,
    }),
    null,
  );
});

test("history prefetch widens with viewport but keeps a floor and rejects bad input", () => {
  assert.equal(historyPrefetchTriggerPx(0), 64);
  assert.equal(historyPrefetchTriggerPx(NaN), 64);
  assert.equal(historyPrefetchTriggerPx(-10), 64);
  assert.equal(historyPrefetchTriggerPx(20), 64); // 40 < 64 下限
  assert.equal(historyPrefetchTriggerPx(600), 1200);
});

test("loadOlder triggers only at the top when more pages exist and none is in flight", () => {
  assert.equal(
    shouldTriggerLoadOlder({ scrollTop: 0, canLoadOlder: true, loadingOlder: false }),
    true,
  );
  assert.equal(
    shouldTriggerLoadOlder({ scrollTop: 0, canLoadOlder: false, loadingOlder: false }),
    false,
  );
  assert.equal(
    shouldTriggerLoadOlder({ scrollTop: 0, canLoadOlder: true, loadingOlder: true }),
    false,
  );
  assert.equal(
    shouldTriggerLoadOlder({ scrollTop: 500, canLoadOlder: true, loadingOlder: false }),
    false,
  );
  assert.equal(
    shouldTriggerLoadOlder({
      scrollTop: 500,
      canLoadOlder: true,
      loadingOlder: false,
      triggerPx: 1000,
    }),
    true,
  );
});
