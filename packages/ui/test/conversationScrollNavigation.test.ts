import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveConversationTurnNavigatorActiveUnitIndex as resolveActive,
  type ConversationTurnNavigatorItem,
} from "../src/v4/conversationTurnNavigatorHelpers.js";

type Options = Parameters<typeof resolveActive>[0];
const finite = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
// 保留优化前的线性定义作为语义参照，覆盖稀疏回合和同回合多 query。
function reference({ items, virtualItems, scrollOffsetPx, viewportHeightPx }: Options) {
  if (!items.length) return undefined;
  const byIndex = new Map(items.map((item) => [item.unitIndex, item]));
  const start = finite(scrollOffsetPx);
  const end = start + Math.max(1, finite(viewportHeightPx));
  let active: number | undefined;
  let distance = Infinity;
  for (const row of virtualItems) {
    const item = byIndex.get(row.index);
    if (!item) continue;
    const top = finite(row.start);
    if (top + Math.max(1, finite(row.size)) < start || top > end) continue;
    const delta = top <= start ? 0 : top - start;
    if (delta < distance) {
      active = item.unitIndex;
      distance = delta;
    }
  }
  if (active !== undefined) return active;
  const top = virtualItems.find(
    (row) => finite(row.start) + Math.max(1, finite(row.size)) >= start && finite(row.start) <= end,
  )?.index;
  if (top === undefined) return items[0]?.unitIndex;
  return (
    items.find((item) => item.unitIndex >= top)?.unitIndex ??
    items.findLast((item) => item.unitIndex <= top)?.unitIndex ??
    items[0]?.unitIndex
  );
}
function item(unitIndex: number): ConversationTurnNavigatorItem {
  return {
    key: String(unitIndex),
    unitIndex,
    rowId: unitIndex,
    turnId: String(unitIndex),
    userText: "q",
    userPreview: "q",
    assistantPreview: "a",
    assistantPreviewKind: "text",
    isRunning: false,
  };
}

test("scroll selection preserves linear semantics for sparse and repeated query units", () => {
  for (const indexes of [[], [0], [1, 1, 5, 9], [2, 8, 20]]) {
    const items = indexes.map(item);
    for (const offset of [-10, 0, 9, 10, 39, 40, 90, 200, Infinity, NaN]) {
      for (const height of [0, 1, 35, NaN]) {
        for (const virtualItems of [
          [],
          Array.from({ length: 15 }, (_, index) => ({ index, start: index * 10, size: 10 })),
          [{ index: 25, start: 0, size: 20 }],
        ]) {
          const options = { items, virtualItems, scrollOffsetPx: offset, viewportHeightPx: height };
          assert.equal(resolveActive(options), reference(options));
        }
      }
    }
  }
});

test("scrolling inspects logarithmic history entries, not the full directory", () => {
  let reads = 0;
  const items = Array.from({ length: 10000 }, (_, index) => {
    const row = item(index * 2);
    Object.defineProperty(row, "unitIndex", {
      get() {
        reads++;
        return index * 2;
      },
    });
    return row;
  });
  assert.equal(
    resolveActive({
      items,
      virtualItems: [{ index: 14000, start: 100, size: 20 }],
      scrollOffsetPx: 101,
      viewportHeightPx: 10,
    }),
    14000,
  );
  assert.ok(reads < 40, `expected bounded directory reads; got ${reads}`);
});

test("large-directory scroll benchmark matches previous output", (t) => {
  const items = Array.from({ length: 10000 }, (_, index) => item(index * 2));
  const frames = Array.from({ length: 500 }, (_, index) => ({
    items,
    virtualItems: [{ index: index * 3, start: 100, size: 20 }],
    scrollOffsetPx: 101,
    viewportHeightPx: 10,
  }));
  const measure = (resolve: typeof resolveActive) => {
    const start = performance.now();
    const results = frames.map(resolve);
    return { results, ms: performance.now() - start };
  };
  const before = measure(reference);
  const after = measure(resolveActive);
  assert.deepEqual(after.results, before.results);
  t.diagnostic(
    `10000 items / 500 scrolls: full=${before.ms.toFixed(1)}ms indexed=${after.ms.toFixed(1)}ms`,
  );
});
