import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// 需要 `vite --config packages/ui/test/browser/vite.config.mjs` 已在 5199 端口运行。
// 不需要 Electron、真实 Host 或 Agent：fixture 用真实 KeyedPublication + 真实 hook
// 在浏览器里比较整店订阅（改造前）、SessionPane keyed 外壳与时间线 keyed 订阅
// （改造后）的通知/渲染次数。
const perKind = 12;
const browser = await chromium.launch({
  channel: process.env.YCODE_TEST_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5199/packages/ui/test/browser/keyedPublicationBench.html");
  await page.locator('[data-testid="timeline-consumer"]').waitFor({ state: "attached" });

  // 1. 逐类写入：显式验证时间线只读面对 queue/status/optimistic 零渲染，rows 才渲染。
  const writeKinds = ["rows", "queue", "status", "optimistic"];
  for (const kind of writeKinds) {
    const result = await page.evaluate(
      (writeKind) => globalThis.__keyedBench.runStep(writeKind),
      kind,
    );
    assert.equal(result.deltas.wholeRenders, 1, `${kind} 写入必须唤醒整店消费者一次`);
    assert.equal(result.deltas.paneRenders, 1, `${kind} 写入必须唤醒 keyed 外壳一次`);
    if (kind === "rows") {
      assert.equal(result.deltas.timelineRenders, 1, "rows 写入必须重新渲染时间线只读面");
      assert.equal(
        result.deltas.timelineOnlyRenders,
        1,
        "rows 写入必须重新渲染外壳内嵌的 timeline-only 读面",
      );
      assert.equal(result.deltas.timelineNotifications, 1, "rows 写入必须通知时间线 keyed 订阅");
    } else {
      assert.equal(result.deltas.timelineRenders, 0, `${kind} 写入不得重新渲染时间线只读面`);
      assert.equal(
        result.deltas.timelineOnlyRenders,
        0,
        `${kind} 写入不得通过外壳重渲染连带 timeline-only 读面`,
      );
      assert.equal(result.deltas.timelineNotifications, 0, `${kind} 写入不得通知时间线 keyed 订阅`);
    }
  }

  // 2. 混合批次：统计总通知/渲染次数与抑制率。
  const baseline = await page.evaluate(() => globalThis.__keyedBench.snapshot());
  const final = await page.evaluate(
    (count) => globalThis.__keyedBench.runMixedBatch(count),
    perKind,
  );

  const writes = perKind * 4;
  const wholeNotifications = final.wholeNotifications - baseline.wholeNotifications;
  const wholeRenders = final.wholeRenders - baseline.wholeRenders;
  const paneNotifications = final.paneNotifications - baseline.paneNotifications;
  const paneRenders = final.paneRenders - baseline.paneRenders;
  const timelineNotifications = final.timelineNotifications - baseline.timelineNotifications;
  const timelineRenders = final.timelineRenders - baseline.timelineRenders;
  const timelineOnlyRenders = final.timelineOnlyRenders - baseline.timelineOnlyRenders;

  assert.equal(final.rowsWrites, baseline.rowsWrites + perKind, "rows 写入次数必须完整");
  assert.equal(
    wholeNotifications,
    writes,
    `整店订阅必须收到每次写入（实际 ${wholeNotifications}/${writes}）`,
  );
  assert.equal(
    wholeRenders,
    writes,
    `整店消费者每次通知都应渲染一次（实际 ${wholeRenders}/${writes}）`,
  );
  assert.equal(
    timelineNotifications,
    perKind,
    `时间线 keyed 订阅只应收到 rows 写入（实际 ${timelineNotifications}/${perKind}）`,
  );
  assert.equal(
    timelineRenders,
    perKind,
    `时间线消费者只应在 rows 写入时渲染（实际 ${timelineRenders}/${perKind}）`,
  );
  assert.equal(
    timelineOnlyRenders,
    perKind,
    `外壳内嵌 timeline-only 读面只应在 rows 写入时渲染（实际 ${timelineOnlyRenders}/${perKind}）`,
  );
  // keyed 外壳读 queue/status/optimistic/seq/rows，因此四类写入都会让它渲染一次；
  // 它不再是整店订阅，但也不声称对自身读面做抑制。真实收益在时间线只读面。
  assert.equal(
    paneNotifications,
    writes,
    `keyed 外壳应按自身读面收到每次写入（实际 ${paneNotifications}/${writes}）`,
  );
  assert.equal(
    paneRenders,
    writes,
    `keyed 外壳应按自身读面渲染每次写入（实际 ${paneRenders}/${writes}）`,
  );

  const dom = await page.evaluate(() => {
    const timeline = document.querySelector('[data-testid="timeline-consumer"]');
    const pane = document.querySelector('[data-testid="pane-consumer"]');
    const whole = document.querySelector('[data-testid="whole-consumer"]');
    return {
      timelineRows: Number(timeline.dataset.rows),
      paneQueue: Number(pane.dataset.queue),
      paneSeq: Number(pane.dataset.seq),
      wholeQueue: Number(whole.dataset.queue),
    };
  });
  // 逐类预热步骤各写入一次，因此 DOM 中的最终计数是 perKind + 1。
  assert.equal(dom.timelineRows, perKind + 1, "时间线必须读到最新 rows 窗口");
  assert.equal(dom.paneQueue, perKind + 1, "keyed 外壳必须读到最新 queue");
  assert.equal(dom.paneSeq, perKind + 1, "keyed 外壳必须读到最新 seq 水位");
  assert.equal(dom.wholeQueue, perKind + 1, "整店消费者必须读到最新 queue");
  assert.deepEqual(errors, [], "基准页面不能抛未处理异常");

  const timelineSuppression = ((1 - timelineRenders / wholeRenders) * 100).toFixed(1);
  console.log(
    `keyed publication bench: ${writes} writes (${perKind} rows/queue/status/optimistic)`,
  );
  console.log(
    `  before (whole-store): notifications=${wholeNotifications} renders=${wholeRenders}`,
  );
  console.log(
    `  after  (SessionPane keyed surfaces): notifications=${paneNotifications} renders=${paneRenders}`,
  );
  console.log(
    `  after  (timeline keys: rows.window/loadingOlder/turnNavigatorDirectoryRevision): ` +
      `notifications=${timelineNotifications} renders=${timelineRenders}`,
  );
  console.log(
    `  after  (timeline-only surface nested in keyed pane shell): ` +
      `renders=${timelineOnlyRenders}`,
  );
  console.log(`  timeline render suppression: ${timelineSuppression}%`);
} finally {
  await browser.close();
}
