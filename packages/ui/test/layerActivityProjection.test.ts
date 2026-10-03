import assert from "node:assert/strict";
import test from "node:test";
import { createLayerActivityController } from "../src/lib/layerActivity.js";
import { subscribeToVisibleProjection } from "../src/v4/visibleProjectionSubscription.js";

function createDocumentTarget(): {
  target: {
    visibilityState: DocumentVisibilityState;
    addEventListener: EventTarget["addEventListener"];
    removeEventListener: EventTarget["removeEventListener"];
  };
  events: EventTarget;
} {
  const events = new EventTarget();
  return {
    target: {
      visibilityState: "visible",
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
    events,
  };
}

test("隐藏层不接收通知，激活时一次读到最新状态", () => {
  const documentTarget = createDocumentTarget();
  const activity = createLayerActivityController(true);
  let listener: (() => void) | undefined;
  let revision = 0;
  const seen: number[] = [];
  const off = subscribeToVisibleProjection(
    {
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    () => seen.push(revision),
    documentTarget.target,
    activity,
  );

  revision += 1;
  listener?.();
  assert.deepEqual(seen, [1], "活动层必须立刻通知");

  activity.setActive(false);
  assert.deepEqual(seen, [1], "失活本身不产生渲染通知");
  for (let index = 0; index < 1000; index++) {
    revision += 1;
    listener?.();
  }
  assert.deepEqual(seen, [1], "失活期间不通知");

  activity.setActive(true);
  assert.deepEqual(seen, [1, 1001], "激活时一次送达最新状态");

  revision += 1;
  listener?.();
  assert.deepEqual(seen, [1, 1001, 1002]);

  off();
  assert.equal(listener, undefined);
  activity.setActive(false);
  activity.setActive(true);
  assert.deepEqual(seen, [1, 1001, 1002], "退订后不再通知");
});

test("文档隐藏与层失活叠加时，两者都恢复才送达", () => {
  const events = new EventTarget();
  let visibilityState: DocumentVisibilityState = "hidden";
  const documentTarget = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const activity = createLayerActivityController(false);
  let listener: (() => void) | undefined;
  let notifications = 0;
  const off = subscribeToVisibleProjection(
    {
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    () => {
      notifications += 1;
    },
    documentTarget,
    activity,
  );

  listener?.();
  assert.equal(notifications, 0);
  visibilityState = "visible";
  events.dispatchEvent(new Event("visibilitychange"));
  assert.equal(notifications, 0, "层仍失活时不能送达");
  activity.setActive(true);
  assert.equal(notifications, 1);
  off();
});
