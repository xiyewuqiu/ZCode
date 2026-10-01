import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZCodeSessionEndedSubagent, ZCodeSessionSubagentsResult } from "@zcode/shared";
import { SessionSubagentsQuery } from "../src/hooks/sessionSubagentsQuery.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const item = (id: number): ZCodeSessionEndedSubagent => ({
  childSessionId: `child-${id}`,
  subagentType: "test",
  title: `Agent ${id}`,
  status: "success",
});
function page(
  items = [item(1)],
  total = items.length,
  nextCursor?: string,
): ZCodeSessionSubagentsResult {
  return { revision: 1, running: [], childSessionIds: [], ended: { items, total, nextCursor } };
}

test("in-flight invalidations coalesce into one refresh without overlapping requests", async () => {
  const first = deferred<ZCodeSessionSubagentsResult>();
  let calls = 0;
  const query = new SessionSubagentsQuery(async () =>
    ++calls === 1 ? first.promise : page([item(2)]),
  );
  query.activate();
  const pending = query.refresh();
  void query.refresh();
  void query.refresh();
  assert.equal(calls, 1);
  first.resolve(page());
  await pending;
  assert.equal(calls, 2);
  assert.equal(query.getSnapshot().ended.items[0]?.childSessionId, "child-2");
  assert.equal(query.getSnapshot().loading, false);
});

test("a released generation neither publishes nor continues paging after reactivation", async () => {
  const old = deferred<ZCodeSessionSubagentsResult>();
  let calls = 0;
  const query = new SessionSubagentsQuery(async () =>
    ++calls === 1 ? old.promise : page([item(2)]),
  );
  query.activate();
  const pending = query.refresh();
  query.deactivate();
  query.activate();
  await query.refresh();
  old.resolve(page([item(1)], 100, "old-next"));
  await pending;
  assert.equal(calls, 2);
  assert.equal(query.getSnapshot().ended.items[0]?.childSessionId, "child-2");
});

test("invalidation between result publication and request cleanup is not lost", async () => {
  let calls = 0;
  const query = new SessionSubagentsQuery(async () => page([item(++calls)]));
  query.activate();
  query.subscribe(() => {
    if (!query.getSnapshot().loading && calls === 1) queueMicrotask(() => void query.refresh());
  });
  await query.refresh();
  assert.equal(calls, 2);
  assert.equal(query.getSnapshot().ended.items[0]?.childSessionId, "child-2");
});

test("old scope completion cannot unlock or overwrite another scope", async () => {
  const old = deferred<ZCodeSessionSubagentsResult>();
  const next = deferred<ZCodeSessionSubagentsResult>();
  const a = new SessionSubagentsQuery(() => old.promise);
  const b = new SessionSubagentsQuery(() => next.promise);
  a.activate();
  const pendingA = a.refresh();
  a.deactivate();
  b.activate();
  const pendingB = b.refresh();
  old.resolve(page());
  await pendingA;
  assert.equal(b.getSnapshot().loading, true);
  assert.equal(b.getSnapshot().ended.items.length, 0);
  next.resolve(page([item(3)]));
  await pendingB;
  assert.equal(b.getSnapshot().ended.items[0]?.childSessionId, "child-3");
});

test("refresh preserves loaded depth, batches 100 items, and reuses unchanged records", async () => {
  let data = Array.from({ length: 260 }, (_, index) => item(index));
  const limits: number[] = [];
  const query = new SessionSubagentsQuery(async (limit, cursor) => {
    limits.push(limit);
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + limit, data.length);
    return page(
      data.slice(start, end).map((value) => ({ ...value })),
      data.length,
      end < data.length ? String(end) : undefined,
    );
  });
  query.activate();
  await query.refresh();
  for (let i = 0; i < 11; i++) await query.loadMore();
  const original = query.getSnapshot().ended.items;
  limits.length = 0;
  await query.refresh();
  assert.deepEqual(limits, [100, 100, 40]);
  assert.equal(query.getSnapshot().ended.items, original);
  data = [item(1000), ...data];
  data[2] = { ...data[2]!, summary: "updated outcome" };
  await query.refresh();
  assert.equal(query.getSnapshot().ended.items.length, 241);
  assert.equal(query.getSnapshot().ended.items[1], original[0]);
  assert.equal(query.getSnapshot().ended.items[2]?.summary, "updated outcome");
  assert.equal(query.getSnapshot().ended.items[240], original[239]);
});

test("refresh arriving during loadMore is retained and duplicate page items are removed", async () => {
  const more = deferred<ZCodeSessionSubagentsResult>();
  const initial = Array.from({ length: 20 }, (_, index) => item(index));
  let calls = 0;
  const query = new SessionSubagentsQuery(async () => {
    calls++;
    if (calls === 1) return page(initial, 21, "next");
    if (calls === 2) return more.promise;
    return page([item(21), ...initial]);
  });
  query.activate();
  await query.refresh();
  const pending = query.loadMore();
  void query.refresh();
  more.resolve(page([item(19), item(21), item(21)], 21));
  await pending;
  assert.equal(calls, 3);
  assert.deepEqual(
    query.getSnapshot().ended.items.map((value) => value.childSessionId),
    ["child-21", ...initial.map((value) => value.childSessionId)],
  );
});

test("failure keeps readable records and retry recovers", async () => {
  let failed = false;
  const errors: string[] = [];
  const query = new SessionSubagentsQuery(
    async () => {
      if (failed) throw new Error("offline");
      return page();
    },
    (error) => errors.push(error),
  );
  query.activate();
  await query.refresh();
  const previous = query.getSnapshot().ended.items;
  failed = true;
  await query.refresh();
  assert.equal(query.getSnapshot().ended.items, previous);
  assert.equal(query.getSnapshot().error, "offline");
  assert.deepEqual(errors, ["offline"]);
  failed = false;
  await query.refresh();
  assert.equal(query.getSnapshot().error, null);
});

test("repeated cursors fail explicitly instead of entering an endless refresh", async () => {
  let calls = 0;
  const query = new SessionSubagentsQuery(async () => {
    calls++;
    return page([item(1)], 100, "same");
  });
  query.activate();
  await query.refresh();
  assert.equal(calls, 2);
  assert.match(query.getSnapshot().error ?? "", /cursor/);
  assert.equal(query.getSnapshot().loading, false);
});
