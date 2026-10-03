import assert from "node:assert/strict";
import test from "node:test";
import { createFrameNotificationScheduler } from "../src/lib/frameNotificationScheduler.js";

interface ManualFrames {
  pending: (() => void)[];
  requestFrame: (callback: () => void) => number;
  runFrame: () => void;
}

function createManualFrames(): ManualFrames {
  const pending: (() => void)[] = [];
  return {
    pending,
    requestFrame(callback) {
      pending.push(callback);
      return pending.length;
    },
    runFrame() {
      const batch = pending.splice(0, pending.length);
      for (const callback of batch) callback();
    },
  };
}

function createDocumentTarget(): {
  target: {
    visibilityState: DocumentVisibilityState;
    addEventListener: EventTarget["addEventListener"];
    removeEventListener: EventTarget["removeEventListener"];
  };
  events: EventTarget;
  setVisibility: (next: DocumentVisibilityState) => void;
} {
  let visibilityState: DocumentVisibilityState = "visible";
  const events = new EventTarget();
  return {
    target: {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
    events,
    setVisibility: (next) => {
      visibilityState = next;
      events.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

test("同一帧内的多次请求合并为一次通知", () => {
  const frames = createManualFrames();
  const documentTarget = createDocumentTarget();
  const scheduler = createFrameNotificationScheduler({
    requestFrame: frames.requestFrame,
    document: documentTarget.target,
  });
  let notifications = 0;
  const notify = () => {
    notifications += 1;
  };
  scheduler.schedule(notify);
  scheduler.schedule(notify);
  scheduler.schedule(notify);
  assert.equal(notifications, 0, "未到帧边界不应通知");
  assert.equal(frames.pending.length, 1, "同一帧只应登记一个帧回调");
  frames.runFrame();
  assert.equal(notifications, 1);
});

test("通知期间的新请求进入下一帧，不丢失也不递归", () => {
  const frames = createManualFrames();
  const documentTarget = createDocumentTarget();
  const scheduler = createFrameNotificationScheduler({
    requestFrame: frames.requestFrame,
    document: documentTarget.target,
  });
  const seen: number[] = [];
  let round = 0;
  const notify = () => {
    round += 1;
    seen.push(round);
    if (round < 3) scheduler.schedule(notify);
  };
  scheduler.schedule(notify);
  frames.runFrame();
  assert.deepEqual(seen, [1], "同一帧内不应重复进入");
  frames.runFrame();
  frames.runFrame();
  assert.deepEqual(seen, [1, 2, 3]);
});

test("文档隐藏期间保留挂起，恢复可见时一次送达", () => {
  const frames = createManualFrames();
  const documentTarget = createDocumentTarget();
  const scheduler = createFrameNotificationScheduler({
    requestFrame: frames.requestFrame,
    document: documentTarget.target,
  });
  let notifications = 0;
  const notify = () => {
    notifications += 1;
  };
  documentTarget.setVisibility("hidden");
  scheduler.schedule(notify);
  assert.equal(frames.pending.length, 0, "隐藏时不应登记帧回调");
  frames.runFrame();
  assert.equal(notifications, 0);
  scheduler.schedule(notify);
  documentTarget.setVisibility("visible");
  assert.equal(notifications, 1, "恢复可见必须立刻补一次通知");
  assert.ok(scheduler.hasPending() === false);
});

test("取消后不再通知，flush 可强制送达", () => {
  const frames = createManualFrames();
  const documentTarget = createDocumentTarget();
  const scheduler = createFrameNotificationScheduler({
    requestFrame: frames.requestFrame,
    document: documentTarget.target,
  });
  let first = 0;
  let second = 0;
  const notifyFirst = () => {
    first += 1;
  };
  const notifySecond = () => {
    second += 1;
  };
  scheduler.schedule(notifyFirst);
  scheduler.cancel(notifyFirst);
  frames.runFrame();
  assert.equal(first, 0);
  scheduler.schedule(notifySecond);
  scheduler.flush();
  assert.equal(second, 1, "flush 必须同步送达");
  frames.runFrame();
  assert.equal(second, 1, "flush 后不应重复送达");
});

test("没有帧能力时保持同步通知", () => {
  const scheduler = createFrameNotificationScheduler({
    requestFrame: null as unknown as ((callback: () => void) => number) | undefined,
    cancelFrame: null as unknown as ((handle: number) => void) | undefined,
    document: null,
  });
  let notifications = 0;
  const scheduled = scheduler.schedule(() => {
    notifications += 1;
  });
  assert.equal(notifications, 1);
  assert.equal(scheduled, false);
  assert.equal(scheduler.hasPending(), false);
});
