import assert from "node:assert/strict";
import test from "node:test";
import { readTimelineFollowMetrics, TimelineScrollFollow } from "../src/v4/timelineScrollFollow.js";

// 滚动跟随控制器决定「原生 smooth 动画是否算阅读者移动」：
// 一旦中间帧被误判为用户上滚，或无 scrollend 兜底，贴底会停在半途或所有权卡住。

interface FakeScroller {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  scrollToCalls: Array<{ top: number; behavior: ScrollBehavior }>;
  scrollTo(options: ScrollToOptions): void;
}

function createScroller(scrollTop: number, contentHeight = 1000, clientHeight = 200): FakeScroller {
  return {
    scrollTop,
    clientHeight,
    scrollHeight: contentHeight,
    scrollToCalls: [],
    scrollTo(options: ScrollToOptions) {
      this.scrollToCalls.push({ top: options.top ?? 0, behavior: options.behavior ?? "auto" });
      const max = Math.max(0, this.scrollHeight - this.clientHeight);
      this.scrollTop = Math.max(0, Math.min(options.top ?? 0, max));
    },
  };
}

const metricsOf = (element: FakeScroller) =>
  readTimelineFollowMetrics(element as unknown as HTMLElement);
const node = (element: FakeScroller) => element as unknown as HTMLElement;

function stubReducedMotion(matches: boolean): () => void {
  const scope = globalThis as { matchMedia?: (query: string) => MediaQueryList };
  const previous = scope.matchMedia;
  scope.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as (query: string) => MediaQueryList;
  return () => {
    if (previous === undefined) delete scope.matchMedia;
    else scope.matchMedia = previous;
  };
}

test("instant 贴底立即落到底并登记跟随", () => {
  const element = createScroller(100);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "instant");
  assert.equal(element.scrollTop, 800);
  assert.equal(follow.animating, false);
  assert.equal(follow.active, true);
});

test("pinned 时 smooth 贴底发起原生动画，scrollend 命中目标才保持跟随", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  assert.equal(follow.animating, true);
  assert.equal(element.scrollToCalls.at(-1)?.behavior, "smooth");
  // 动画中间帧不改变跟随意图。
  assert.equal(follow.sample(metricsOf(element)), true);
  assert.equal(follow.settle(metricsOf(element)), true);
  assert.equal(follow.animating, false);
  restore();
});

test("未 pinned 时 smooth 请求降级为 instant", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(false);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  assert.equal(follow.animating, false);
  assert.equal(element.scrollTop, 800);
  assert.equal(follow.active, true);
  restore();
});

test("reduced-motion 下 smooth 请求仍立即落底", () => {
  const restore = stubReducedMotion(true);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  assert.equal(follow.animating, false);
  assert.equal(element.scrollTop, 800);
  restore();
});

test("动画未到达目标附近时 scrollend 解除跟随", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  element.scrollTop = 200; // 用户接管 / 动画被中断在远处
  assert.equal(follow.settle(metricsOf(element)), false);
  assert.equal(follow.animating, false);
  restore();
});

test("阅读手势 interrupt 停在当前位置，后续真实上滚才解锁", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  element.scrollTop = 300;
  follow.interrupt(node(element), metricsOf(element));
  assert.equal(follow.animating, false);
  assert.equal(follow.active, true);
  element.scrollTop = 120;
  assert.equal(follow.sample(metricsOf(element), true), false);
  restore();
});

test("超长距离的 smooth 请求降级为 instant，避免原生动画被逐次重启", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(100); // 距底 700 > 2 个视口
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  assert.equal(follow.animating, false);
  assert.equal(element.scrollTop, 800);
  restore();
});

test("动画在途时内容变化取消动画并立即落到最新地板", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  assert.equal(follow.animating, true);
  element.scrollHeight = 1200;
  follow.toBottom(node(element), metricsOf(element), "instant");
  assert.equal(follow.animating, false);
  assert.equal(element.scrollTop, 1000);
  restore();
});

test("jump 把目标钳到可滚动范围，并按落点决定跟随", () => {
  const element = createScroller(100);
  const follow = new TimelineScrollFollow(false);
  follow.jump(node(element), metricsOf(element), 9999);
  assert.equal(element.scrollTop, 800);
  assert.equal(follow.active, true);
  follow.jump(node(element), metricsOf(element), 0);
  assert.equal(element.scrollTop, 0);
  assert.equal(follow.active, false);
});

test("setFollowing(false) 取消未完成的原生目标", () => {
  const restore = stubReducedMotion(false);
  const element = createScroller(600);
  const follow = new TimelineScrollFollow(true);
  follow.toBottom(node(element), metricsOf(element), "smooth");
  assert.equal(follow.animating, true);
  follow.setFollowing(false);
  assert.equal(follow.animating, false);
  assert.equal(follow.active, false);
  restore();
});
