import assert from "node:assert/strict";
import test from "node:test";
import {
  captureTimelineClosingBaseline,
  isTimelineClosingBaselineFresh,
  planTimelineClosingAnchor,
  reclaimTimelineClosingSpacer,
  shouldCaptureTimelineClosingBaseline,
  type TimelineClosingAnchorUnit,
} from "../src/v4/timelineClosingAnchor.js";

// 收起锚点是「贴底阅读时内容变短不跳位」的唯一几何决策：
// 一旦 fromEnd 基准或半屏上限回归，完成态收起、live tail 迁移和 Radix 折叠
// 都会把正文拽离阅读位置。这里锁定纯计算，浏览器 fixture 只覆盖真实 DOM 路径。

const units = (...specs: Array<[string, number, number]>): TimelineClosingAnchorUnit[] =>
  specs.map(([key, top, bottom]) => ({ key, top, bottom }));

const baseUnits = () => units(["a", 0, 100], ["b", 120, 220], ["c", 240, 340], ["d", 360, 460]);

test("捕获首个可见行、其下方屏幕内行，再向前补一屏", () => {
  // scrollTop=150 / viewport=200 → 绘制视口 150..350，首行是 b。
  const baseline = captureTimelineClosingBaseline({
    units: baseUnits(),
    contentHeight: 460,
    viewportHeight: 200,
    scrollTop: 150,
    capturedAt: 1,
  });
  assert.ok(baseline);
  assert.equal(baseline.contentHeight, 460);
  assert.equal(baseline.capturedAt, 1);
  assert.deepEqual(
    baseline.anchors.map((anchor) => anchor.key),
    ["b", "c", "a"],
  );
  // fromEnd 以绘制视口底部（350）为基准，而非内容末尾（460）：
  // 这样即使贴底容差内未精确到底，也不会在收起后额外上移。
  assert.equal(baseline.anchors[0]!.fromEnd, 230);
  assert.equal(baseline.anchors[1]!.fromEnd, 110);
  assert.equal(baseline.anchors[2]!.fromEnd, 350);
});

test("没有可见行或参数非法时不生成基准", () => {
  assert.equal(
    captureTimelineClosingBaseline({
      units: units(["a", 0, 100]),
      contentHeight: 100,
      viewportHeight: 200,
      scrollTop: 500,
    }),
    null,
  );
  assert.equal(
    captureTimelineClosingBaseline({
      units: baseUnits(),
      contentHeight: 460,
      viewportHeight: 0,
      scrollTop: 0,
    }),
    null,
  );
});

test("内容未变短时保持基准（hold），不提前改写位置", () => {
  const baseline = captureTimelineClosingBaseline({
    units: baseUnits(),
    contentHeight: 460,
    viewportHeight: 200,
    scrollTop: 150,
  })!;
  const plan = planTimelineClosingAnchor({
    baseline,
    surviving: new Map([["b", { top: 120, height: 100 }]]),
    contentHeight: 460,
    viewportHeight: 200,
  });
  assert.deepEqual(plan, { kind: "hold" });
});

test("内容增长时判定 grow，旧屏幕基准失效", () => {
  const baseline = captureTimelineClosingBaseline({
    units: baseUnits(),
    contentHeight: 460,
    viewportHeight: 200,
    scrollTop: 150,
  })!;
  assert.deepEqual(
    planTimelineClosingAnchor({
      baseline,
      surviving: new Map([["b", { top: 120, height: 100 }]]),
      contentHeight: 520,
      viewportHeight: 200,
    }),
    { kind: "grow" },
  );
});

test("首个锚点消失时按顺序回退到后续/上方存活行", () => {
  const baseline = captureTimelineClosingBaseline({
    units: baseUnits(),
    contentHeight: 460,
    viewportHeight: 200,
    scrollTop: 150,
  })!;
  const plan = planTimelineClosingAnchor({
    baseline,
    surviving: new Map([
      ["c", { top: 200, height: 100 }],
      ["a", { top: -30, height: 100 }],
    ]),
    contentHeight: 300,
    viewportHeight: 200,
  });
  // b 已不存在，回退到顺序中的 c：屏幕顶部保持 240-150=90。
  assert.equal(plan.kind, "apply");
  if (plan.kind !== "apply") return;
  assert.equal(plan.scrollTop, 110); // c.top(200) - (200 - 110)
  assert.equal(plan.spacerHeight, 10); // 110 + 200 - 300
});

test("所有候选行都没挂载时判定 lost，不做猜测", () => {
  const baseline = captureTimelineClosingBaseline({
    units: baseUnits(),
    contentHeight: 460,
    viewportHeight: 200,
    scrollTop: 150,
  })!;
  assert.deepEqual(
    planTimelineClosingAnchor({
      baseline,
      surviving: new Map(),
      contentHeight: 200,
      viewportHeight: 200,
    }),
    { kind: "lost" },
  );
});

test("留白最多半个视口，超出后内容尾部停在视口中线", () => {
  const baseline = captureTimelineClosingBaseline({
    units: units(["a", 0, 150], ["b", 150, 250]),
    contentHeight: 400,
    viewportHeight: 200,
    scrollTop: 200, // 视口 200..400，首行 b（top 150，fromEnd 250）
  })!;
  const plan = planTimelineClosingAnchor({
    baseline,
    // b 收起后内容只剩 300，按原屏幕位置需要 200 的留白，超过半屏上限。
    surviving: new Map([["b", { top: 250, height: 50 }]]),
    contentHeight: 300,
    viewportHeight: 200,
  });
  assert.equal(plan.kind, "apply");
  if (plan.kind !== "apply") return;
  assert.equal(plan.spacerHeight, 100);
  assert.equal(plan.scrollTop, 200); // content(300) + cap(100) - viewport(200)
});

test("内容增长按新增高度抵扣留白，填满后回到常规贴底", () => {
  assert.deepEqual(
    reclaimTimelineClosingSpacer({
      spacerHeight: 100,
      contentHeight: 900,
      scrollTop: 650,
      viewportHeight: 200,
      contentGrowth: 40,
    }),
    { spacerHeight: 60, reachedContentBottom: false },
  );
  assert.deepEqual(
    reclaimTimelineClosingSpacer({
      spacerHeight: 100,
      contentHeight: 1100,
      scrollTop: 900,
      viewportHeight: 200,
      contentGrowth: 220,
    }),
    { spacerHeight: 0, reachedContentBottom: true },
  );
  // 负增长（再次变短）不能反向撑大留白。
  assert.equal(
    reclaimTimelineClosingSpacer({
      spacerHeight: 100,
      contentHeight: 800,
      scrollTop: 700,
      viewportHeight: 200,
      contentGrowth: -50,
    }).spacerHeight,
    100,
  );
});

test("只在贴底、空闲、无上滚意图且宽度稳定时捕获", () => {
  const base = {
    following: true,
    jumping: false,
    animating: false,
    contentWidthChanging: false,
    userIntent: "none" as const,
  };
  assert.equal(shouldCaptureTimelineClosingBaseline(base), true);
  assert.equal(shouldCaptureTimelineClosingBaseline({ ...base, following: false }), false);
  assert.equal(shouldCaptureTimelineClosingBaseline({ ...base, jumping: true }), false);
  assert.equal(shouldCaptureTimelineClosingBaseline({ ...base, animating: true }), false);
  assert.equal(
    shouldCaptureTimelineClosingBaseline({ ...base, contentWidthChanging: true }),
    false,
  );
  assert.equal(
    shouldCaptureTimelineClosingBaseline({ ...base, userIntent: "awayFromBottom" }),
    false,
  );
});

test("过期的收起基准不再使用", () => {
  const baseline = captureTimelineClosingBaseline({
    units: baseUnits(),
    contentHeight: 460,
    viewportHeight: 200,
    scrollTop: 150,
    capturedAt: 1000,
  });
  assert.equal(isTimelineClosingBaselineFresh(baseline, 1500, 1000), true);
  assert.equal(isTimelineClosingBaselineFresh(baseline, 2001, 1000), false);
  assert.equal(isTimelineClosingBaselineFresh(null, 1000, 1000), false);
});
