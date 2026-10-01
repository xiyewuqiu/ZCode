import assert from "node:assert/strict";
import test from "node:test";
import {
  runQueueCommandWithFeedback,
  queueCommandFailureMessage,
} from "../src/v4/queueCommandFeedback.js";

test("messages distinguish each action and never describe uncertain outcomes as rejection", () => {
  const ack = { commandId: "test", status: "rejected", revisionAtDecision: 1 } as const;
  for (const [command, expected] of [
    ["deleteQueueItem", "removeFailed"],
    ["sendQueuedNow", "sendFailed"],
    ["reorderQueueItem", "reorderFailed"],
    ["setAutoDrain", "resumeFailed"],
  ] as const) {
    assert.equal(
      queueCommandFailureMessage(command, { kind: "rejected", ack }),
      `chat.queue.${expected}`,
    );
    assert.equal(
      queueCommandFailureMessage(command, { kind: "unconfirmed", error: new Error("offline") }),
      "chat.queue.resultUnconfirmed",
    );
    assert.equal(
      queueCommandFailureMessage(command, {
        kind: "rejected",
        ack: { ...ack, status: "duplicate" },
      }),
      "chat.queue.resultUnconfirmed",
    );
  }
});

test("accepted/noop return the original ACK with no failure feedback", async () => {
  for (const status of ["accepted", "noop"] as const) {
    const ack = { commandId: "test", status, revisionAtDecision: 1 };
    assert.equal(
      await runQueueCommandWithFeedback({
        send: async () => ack,
        isCurrent: () => true,
        report: () => assert.fail("success reported as failure"),
      }),
      ack,
    );
  }
});
test("rejection reports once and never retries; an old pane does not notify", async () => {
  for (const status of ["rejected", "stale", "failed", "duplicate"] as const) {
    for (const current of [true, false]) {
      let sends = 0;
      const reports: unknown[] = [];
      const ack = { commandId: "test", status, revisionAtDecision: 1 };
      assert.equal(
        await runQueueCommandWithFeedback({
          send: async () => {
            sends++;
            return ack;
          },
          isCurrent: () => current,
          report: (...args) => reports.push(args),
        }),
        null,
      );
      assert.equal(sends, 1);
      assert.equal(reports.length, 1);
      assert.deepEqual(reports[0], [{ kind: "rejected", ack }, current]);
    }
  }
});
test("network uncertainty is handled without retry or fake success, including synchronous throws", async () => {
  const error = new Error("transport unavailable");
  for (const send of [
    () => Promise.reject(error),
    () => {
      throw error;
    },
  ]) {
    const reports: unknown[] = [];
    assert.equal(
      await runQueueCommandWithFeedback({
        send,
        isCurrent: () => true,
        report: (...args) => reports.push(args),
      }),
      null,
    );
    assert.deepEqual(reports, [[{ kind: "unconfirmed", error }, true]]);
  }
});
test("scope is checked at completion after a task switch", async () => {
  let current = true;
  let resolve!: (value: { commandId: string; status: "stale"; revisionAtDecision: number }) => void;
  const pending = new Promise<{ commandId: string; status: "stale"; revisionAtDecision: number }>(
    (done) => {
      resolve = done;
    },
  );
  const reports: unknown[] = [];
  const result = runQueueCommandWithFeedback({
    send: () => pending,
    isCurrent: () => current,
    report: (...args) => reports.push(args),
  });
  current = false;
  resolve({ commandId: "test", status: "stale", revisionAtDecision: 2 });
  assert.equal(await result, null);
  assert.equal((reports[0] as unknown[])[1], false);
});
