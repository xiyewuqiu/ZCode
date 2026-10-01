import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToVisibleProjection } from "../src/v4/visibleProjectionSubscription.js";

test("hidden projection keeps receiving data, emits latest view on restore and releases subscriptions", () => {
  let visibilityState: DocumentVisibilityState = "visible";
  const documentEvents = new EventTarget();
  const documentTarget = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  };
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
    documentTarget,
  );
  revision++;
  listener?.();
  visibilityState = "hidden";
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  for (let i = 0; i < 1000; i++) {
    revision++;
    listener?.();
  }
  assert.deepEqual(seen, [1]);
  assert.equal(revision, 1001);
  visibilityState = "visible";
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(seen, [1, 1001]);
  revision++;
  listener?.();
  assert.deepEqual(seen, [1, 1001, 1002]);
  off();
  assert.equal(listener, undefined);
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(seen, [1, 1001, 1002]);
});
