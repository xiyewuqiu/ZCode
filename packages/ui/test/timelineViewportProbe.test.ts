import assert from "node:assert/strict";
import test from "node:test";
import {
  createTimelineViewportProbe,
  type TimelineViewportProbe,
} from "../src/v4/timelineViewportProbe.js";

interface FakeStyle {
  maskImage: string;
  webkitMaskImage: string;
  maskPosition: string;
  webkitMaskPosition: string;
  maskSize: string;
  webkitMaskSize: string;
}

interface FakeRow {
  rowId: number;
  /** 行内容坐标（相对滚动内容顶部）。 */
  offsetTop: number;
  height: number;
}

interface FakeScrollElement {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  rows: FakeRow[];
  queryCount: number;
  getBoundingClientRect(): { top: number };
  querySelectorAll(): unknown[];
}

function createScrollElement(rows: FakeRow[]): FakeScrollElement {
  const element: FakeScrollElement = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 1000,
    rows,
    queryCount: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => {
      element.queryCount += 1;
      return element.rows.map((row) => ({
        dataset: { rowId: String(row.rowId) },
        // DOM 语义：行 rect 相对视口，容器 rect 是滚动视口顶部。
        getBoundingClientRect: () => ({
          top: row.offsetTop - element.scrollTop,
          height: row.height,
        }),
      }));
    },
  };
  return element;
}

function createMessageLayer(): { element: HTMLDivElement; style: FakeStyle } {
  const style: FakeStyle = {
    maskImage: "",
    webkitMaskImage: "",
    maskPosition: "",
    webkitMaskPosition: "",
    maskSize: "",
    webkitMaskSize: "",
  };
  return {
    element: { offsetTop: 0, style } as unknown as HTMLDivElement,
    style,
  };
}

function attach(
  probe: TimelineViewportProbe,
  scrollElement: FakeScrollElement,
  messageLayer: HTMLDivElement,
): void {
  probe.attach(scrollElement as unknown as HTMLDivElement, messageLayer);
}

test("rail 关闭时不做 DOM 扫描，只同步遮罩", () => {
  const probe = createTimelineViewportProbe();
  const scrollElement = createScrollElement([
    { rowId: 1, offsetTop: 0, height: 40 },
    { rowId: 2, offsetTop: 60, height: 40 },
  ]);
  const { element: messageLayer, style } = createMessageLayer();
  attach(probe, scrollElement, messageLayer);
  probe.setQueryRowIds(new Set([1, 2]));
  probe.setQueryTrackingEnabled(false);
  probe.flush();
  assert.equal(scrollElement.queryCount, 0, "关闭扫描后不能触碰 DOM");
  assert.equal(probe.getMetrics().activeQueryRowId, undefined);
  assert.notEqual(style.maskImage, "none", "离底时仍写入遮罩");
  scrollElement.scrollTop = 900;
  probe.flush();
  assert.equal(style.maskImage, "none", "贴底时保持无遮罩");
});

test("遮罩仅在取值变化时写入，活动项变化才通知", () => {
  const probe = createTimelineViewportProbe();
  const scrollElement = createScrollElement([
    { rowId: 1, offsetTop: 0, height: 40 },
    { rowId: 2, offsetTop: 60, height: 40 },
  ]);
  const { element: messageLayer, style } = createMessageLayer();
  attach(probe, scrollElement, messageLayer);
  probe.setQueryRowIds(new Set([1, 2]));
  probe.setQueryTrackingEnabled(true);

  let notifications = 0;
  probe.subscribe(() => {
    notifications += 1;
  });

  scrollElement.scrollTop = 400;
  probe.flush();
  assert.equal(notifications, 1);
  assert.notEqual(style.maskImage, "none", "离底时写入渐变遮罩");
  const maskAfterFirstFlush = style.maskImage;
  const scansAfterFirstFlush = scrollElement.queryCount;
  assert.equal(scansAfterFirstFlush, 1, "每次 flush 只做一次 DOM 扫描");

  probe.flush();
  assert.equal(notifications, 1, "无变化不应重复通知");
  assert.equal(style.maskImage, maskAfterFirstFlush, "遮罩取值不变不写 DOM");
  assert.equal(scrollElement.queryCount, 2, "扫描与 flush 一一对应，不随无关重渲染增长");
});

test("滚动到可视区内的 query 时活动项命中该行", () => {
  const probe = createTimelineViewportProbe();
  const scrollElement = createScrollElement([
    { rowId: 11, offsetTop: 0, height: 40 },
    { rowId: 22, offsetTop: 300, height: 40 },
  ]);
  const { element: messageLayer } = createMessageLayer();
  attach(probe, scrollElement, messageLayer);
  probe.setQueryRowIds(new Set([11, 22]));
  probe.setQueryTrackingEnabled(true);

  scrollElement.scrollTop = 280;
  probe.flush();
  assert.equal(probe.getMetrics().activeQueryRowId, 22);

  scrollElement.scrollTop = 0;
  probe.flush();
  assert.equal(probe.getMetrics().activeQueryRowId, 11);
  assert.equal(probe.getMetrics().scrollOffsetPx, 0);
  assert.equal(probe.getMetrics().viewportHeightPx, 100);
});

test("卸载后 flush 不再触碰 DOM", () => {
  const probe = createTimelineViewportProbe();
  const scrollElement = createScrollElement([{ rowId: 1, offsetTop: 0, height: 40 }]);
  const { element: messageLayer } = createMessageLayer();
  attach(probe, scrollElement, messageLayer);
  probe.setQueryRowIds(new Set([1]));
  probe.setQueryTrackingEnabled(true);
  probe.flush();
  const scansBeforeDispose = scrollElement.queryCount;
  probe.attach(null, null);
  probe.dispose();
  probe.flush();
  assert.equal(scrollElement.queryCount, scansBeforeDispose);
});
