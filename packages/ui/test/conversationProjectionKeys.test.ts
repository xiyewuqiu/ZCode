import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationSnapshotSchema,
  type ConversationRow,
  type ConversationSnapshot,
  type ConversationTopicFrame,
} from "@ycode/shared/ycode-protocol-v4";
import type { FrameNotificationScheduler } from "../src/lib/frameNotificationScheduler.js";
import {
  ConversationProjectionStore,
  type ConversationProjectionKey,
} from "../src/v4/conversationProjectionStore.js";
import {
  CONVERSATION_TIMELINE_KEYS,
  SESSION_PANE_PROJECTION_KEYS,
} from "../src/v4/useConversationProjection.js";
import type { ConversationTransport } from "../src/v4/transport.js";

/**
 * per-key 订阅的通知计数验证。
 *
 * 直接驱动真实 store 的 snapshot / delta / status / optimistic 写入路径，
 * 统计整店兼容订阅与各 key 子集订阅被唤醒的次数：时间线只登记的 key
 * （rows.window / loadingOlder / turnNavigatorDirectoryRevision）在 queue、
 * status、optimistic 写入时不应被唤醒，在 rows.window 变化时必须被唤醒。
 */

const TOPIC = "conversation/synthetic-session";
const SUBSCRIPTION_ID = "sub-synthetic-1";

// store 的 connect/close 会打生命周期日志；通知计数测试不需要日志噪音。
(
  globalThis as { __YCODE_RENDERER_DISABLE_LOGGING__?: boolean }
).__YCODE_RENDERER_DISABLE_LOGGING__ = true;

function createManualScheduler(): FrameNotificationScheduler {
  const pending = new Set<() => void>();
  return {
    schedule(notify) {
      pending.add(notify);
      return true;
    },
    flush() {
      const batch = [...pending];
      pending.clear();
      for (const notify of batch) notify();
    },
    cancel(notify) {
      pending.delete(notify);
    },
    hasPending() {
      return pending.size > 0;
    },
  };
}

function rowsFixture(): ConversationRow[] {
  return [
    {
      kind: "turnHeader",
      rowId: 1,
      turnId: "turn-1",
      createdAt: 1,
      createdAtSeq: 1,
      origin: "userInput",
      state: "running",
      startedAt: 1,
    },
    {
      kind: "userInput",
      rowId: 2,
      turnId: "turn-1",
      createdAt: 2,
      createdAtSeq: 2,
      origin: "realUser",
      text: "hello",
      attachments: [],
    },
    {
      kind: "assistantText",
      rowId: 3,
      turnId: "turn-1",
      createdAt: 3,
      createdAtSeq: 3,
      text: "streaming answer",
      state: "streaming",
    },
  ];
}

function snapshotFixture(
  seq = 5,
  identity: { sessionId?: string; logEpoch?: string } = {},
): ConversationSnapshot {
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId: identity.sessionId ?? "synthetic-session",
    logEpoch: identity.logEpoch ?? "epoch-1",
    seq,
    revision: 1,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: true,
      stopState: "stoppable",
      stopTargetKind: "assistant",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: Object.fromEntries(
      [
        "fork",
        "compact",
        "switchModelConfig",
        "setFollowupMode",
        "queueEdit",
        "sendQueuedNow",
        "pauseGoal",
        "resumeGoal",
      ].map((key) => [key, { allowed: true }]),
    ),
    inputRouting: { mode: "guide" },
    config: { provider: "synthetic", model: "synthetic-model", thought: "", followupMode: "queue" },
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: rowsFixture(), totalCount: 3, firstRowId: 1 },
  });
}

function snapshotFrame(snapshot: ConversationSnapshot): ConversationTopicFrame {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq: 0,
    toSeq: snapshot.seq,
    sentAt: 1,
    payload: { kind: "snapshot", snapshot },
  };
}

function deltaFrame(
  fromSeq: number,
  toSeq: number,
  deltas: Extract<ConversationTopicFrame["payload"], { kind: "deltas" }>["deltas"],
): ConversationTopicFrame {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq,
    toSeq,
    sentAt: toSeq,
    payload: { kind: "deltas", deltas },
  };
}

function createTransport(options: {
  subscribe: () => Promise<{
    ack: { subscriptionId: string; mode: "snapshot" | "resume"; logEpoch: string };
  }>;
}): ConversationTransport {
  return {
    subscribe: options.subscribe,
    activate: () => {},
    unsubscribe: async () => {},
    resync: async () => {
      throw new Error("synthetic transport has no resync");
    },
    sendCommand: async () => {
      throw new Error("synthetic transport has no sendCommand");
    },
    queryCommands: async () => {
      throw new Error("synthetic transport has no queryCommands");
    },
    rowsRange: async () => {
      throw new Error("synthetic transport has no rowsRange");
    },
    plans: async () => {
      throw new Error("synthetic transport has no plans");
    },
    onFrame: () => () => {},
    onAssemblyFault: () => () => {},
    onRuntimeRestart: () => () => {},
  } as unknown as ConversationTransport;
}

interface Counts {
  whole: number;
  rows: number;
  timeline: number;
  queue: number;
  status: number;
  optimistic: number;
  loadingOlder: number;
}

function countNotifications(
  store: ConversationProjectionStore,
  counters: Counts,
): Array<() => void> {
  const track = (bump: () => void) => () => bump();
  return [
    store.subscribe(track(() => (counters.whole += 1))),
    store.subscribeKeys(
      ["rows.window"],
      track(() => (counters.rows += 1)),
    ),
    store.subscribeKeys(
      CONVERSATION_TIMELINE_KEYS,
      track(() => (counters.timeline += 1)),
    ),
    store.subscribeKeys(
      ["queue"],
      track(() => (counters.queue += 1)),
    ),
    store.subscribeKeys(
      ["status"],
      track(() => (counters.status += 1)),
    ),
    store.subscribeKeys(
      ["optimistic"],
      track(() => (counters.optimistic += 1)),
    ),
    store.subscribeKeys(
      ["loadingOlder"],
      track(() => (counters.loadingOlder += 1)),
    ),
  ];
}

function createCounters(): Counts {
  return {
    whole: 0,
    rows: 0,
    timeline: 0,
    queue: 0,
    status: 0,
    optimistic: 0,
    loadingOlder: 0,
  };
}

test("keyed subscribers ignore unrelated snapshot field, status and optimistic writes", async (t) => {
  const scheduler = createManualScheduler();
  let failNextSubscribe = false;
  const store = new ConversationProjectionStore(
    TOPIC,
    createTransport({
      subscribe: async () => {
        if (failNextSubscribe) throw new Error("synthetic subscribe failure");
        return { ack: { subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: "epoch-1" } };
      },
    }),
    { scheduler },
  );
  t.after(async () => {
    await store.close();
  });

  await store.connect();
  scheduler.flush();

  const counters = createCounters();
  const offs = countNotifications(store, counters);
  t.after(() => {
    for (const off of offs) off();
  });

  // 1. snapshot：整体替换，凡是登记 snapshot 派生的 key 都必须收到一次通知。
  store.handleFrame(snapshotFrame(snapshotFixture(5)), { deliveryKind: "initial" });
  scheduler.flush();
  assert.deepEqual(counters, {
    whole: 1,
    rows: 1,
    timeline: 1,
    queue: 1,
    status: 0,
    optimistic: 0,
    loadingOlder: 0,
  });

  // 2. state.updated(queue)：只写 queue 字段；rows 引用不变，时间线不得被唤醒。
  const queuedSnapshot = store.getState().snapshot!;
  store.handleFrame(
    deltaFrame(5, 6, [{ op: "state.updated", patch: { queue: { items: [], autoDrain: false } } }]),
    { deliveryKind: "online" },
  );
  scheduler.flush();
  assert.notEqual(store.getState().snapshot?.queue, queuedSnapshot.queue);
  assert.deepEqual(counters, {
    whole: 2,
    rows: 1,
    timeline: 1,
    queue: 2,
    status: 0,
    optimistic: 0,
    loadingOlder: 0,
  });

  // 3. row.delta：rows.window 必须在同一帧内唤醒时间线。
  store.handleFrame(
    deltaFrame(6, 7, [{ op: "row.delta", rowId: 3, path: "text", append: " + token" }]),
    { deliveryKind: "online" },
  );
  scheduler.flush();
  assert.deepEqual(counters, {
    whole: 3,
    rows: 2,
    timeline: 2,
    queue: 2,
    status: 0,
    optimistic: 0,
    loadingOlder: 0,
  });

  // 4. status：订阅失败只写 status/lastError；时间线不受影响，也不应重渲染。
  failNextSubscribe = true;
  await store.retry();
  scheduler.flush();
  assert.equal(store.getState().status, "error");
  assert.deepEqual(counters, {
    whole: 4,
    rows: 2,
    timeline: 2,
    queue: 2,
    status: 1,
    optimistic: 0,
    loadingOlder: 0,
  });

  // 5. optimistic：本地 pending overlay 只写 optimistic key。
  store.markCommandPending({ commandId: "cmd-1", type: "sendText", issuedAt: 1 });
  scheduler.flush();
  assert.deepEqual(counters, {
    whole: 5,
    rows: 2,
    timeline: 2,
    queue: 2,
    status: 1,
    optimistic: 1,
    loadingOlder: 0,
  });

  // 时间线 key 集合只含高频行窗口相关项：queue/status/optimistic 不在其中。
  assert.deepEqual([...CONVERSATION_TIMELINE_KEYS].sort(), [
    "loadingOlder",
    "rows.window",
    "turnNavigatorDirectoryRevision",
  ]);
});

test("state.updated with unchanged references does not wake keyed subscribers", async (t) => {
  const scheduler = createManualScheduler();
  const store = new ConversationProjectionStore(
    TOPIC,
    createTransport({
      subscribe: async () => ({
        ack: { subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: "epoch-1" },
      }),
    }),
    { scheduler },
  );
  t.after(async () => {
    await store.close();
  });

  await store.connect();
  scheduler.flush();
  store.handleFrame(snapshotFrame(snapshotFixture(5)), { deliveryKind: "initial" });
  scheduler.flush();

  const counters = createCounters();
  const offs = countNotifications(store, counters);
  t.after(() => {
    for (const off of offs) off();
  });

  const queue = store.getState().snapshot!.queue;
  store.handleFrame(deltaFrame(5, 6, [{ op: "state.updated", patch: { queue } }]), {
    deliveryKind: "online",
  });
  scheduler.flush();

  // snapshot 身份变了（seq 推进），整店兼容订阅仍收到一次；queue/rows 引用未变，keyed 订阅静默。
  assert.equal(counters.whole, 1);
  assert.equal(counters.queue, 0);
  assert.equal(counters.rows, 0);
  assert.equal(counters.timeline, 0);
  assert.equal(counters.status, 0);
  assert.equal(counters.optimistic, 0);
  assert.equal(counters.loadingOlder, 0);
});

test("timeline keys cover row window and navigator revision changes", async (t) => {
  const scheduler = createManualScheduler();
  const store = new ConversationProjectionStore(
    TOPIC,
    createTransport({
      subscribe: async () => ({
        ack: { subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: "epoch-1" },
      }),
    }),
    { scheduler },
  );
  t.after(async () => {
    await store.close();
  });

  await store.connect();
  scheduler.flush();
  store.handleFrame(snapshotFrame(snapshotFixture(5)), { deliveryKind: "initial" });
  scheduler.flush();

  const keys: ConversationProjectionKey[] = [...CONVERSATION_TIMELINE_KEYS];
  let timelineNotifications = 0;
  const off = store.subscribeKeys(keys, () => (timelineNotifications += 1));
  t.after(off);

  // 改写导航目录 revision（real-user query 增删）必须让时间线重新读取目录。
  store.handleFrame(
    deltaFrame(5, 6, [
      {
        op: "row.appended",
        row: {
          kind: "userInput",
          rowId: 4,
          turnId: "turn-2",
          createdAt: 4,
          createdAtSeq: 4,
          origin: "realUser",
          text: "second question",
          attachments: [],
        },
      },
    ]),
    { deliveryKind: "online" },
  );
  scheduler.flush();
  assert.equal(timelineNotifications, 1);
  assert.ok(store.getState().turnNavigatorDirectoryRevision >= 2);
});

test("session identity and seq keys advance independently", async (t) => {
  const scheduler = createManualScheduler();
  const store = new ConversationProjectionStore(
    TOPIC,
    createTransport({
      subscribe: async () => ({
        ack: { subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: "epoch-1" },
      }),
    }),
    { scheduler },
  );
  t.after(async () => {
    await store.close();
  });

  await store.connect();
  scheduler.flush();
  store.handleFrame(snapshotFrame(snapshotFixture(5)), { deliveryKind: "initial" });
  scheduler.flush();

  const counts = { sessionId: 0, logEpoch: 0, seq: 0 };
  const offs = [
    store.subscribeKeys(["sessionId"], () => (counts.sessionId += 1)),
    store.subscribeKeys(["logEpoch"], () => (counts.logEpoch += 1)),
    store.subscribeKeys(["seq"], () => (counts.seq += 1)),
  ];
  t.after(() => {
    for (const off of offs) off();
  });

  // 1. 同引用 state.updated：只有 seq 水位推进，身份 key 必须保持静默。
  const queue = store.getState().snapshot!.queue;
  store.handleFrame(deltaFrame(5, 6, [{ op: "state.updated", patch: { queue } }]), {
    deliveryKind: "online",
  });
  scheduler.flush();
  assert.deepEqual(counts, { sessionId: 0, logEpoch: 0, seq: 1 });

  // 2. 新 logEpoch 的 snapshot 整体替换：logEpoch/seq 变化，sessionId 值未变故不通知
  //    （KeyedPublication 在 flush 时按值过滤，脏 key 不等于必然唤醒）。
  store.handleFrame(snapshotFrame(snapshotFixture(7, { logEpoch: "epoch-2" })), {
    deliveryKind: "initial",
  });
  scheduler.flush();
  assert.deepEqual(counts, { sessionId: 0, logEpoch: 1, seq: 2 });

  // 3. 换 session：sessionId 变化必须唤醒身份订阅者。
  store.handleFrame(
    snapshotFrame(snapshotFixture(8, { sessionId: "synthetic-session-2", logEpoch: "epoch-2" })),
    { deliveryKind: "initial" },
  );
  scheduler.flush();
  assert.deepEqual(counts, { sessionId: 1, logEpoch: 1, seq: 3 });
});

test("SessionPane key set is keyed, covers requested surfaces and never subscribes the whole snapshot", () => {
  const keys = new Set(SESSION_PANE_PROJECTION_KEYS);
  // 外壳不得回退到整快照身份 key；sessionId/logEpoch/seq 已独立成 key。
  assert.equal(keys.has("snapshot"), false);
  // 不在 pane 读面里的低频/诊断 key 不得登记，避免退化回整店订阅。
  assert.equal(keys.has("plansLoading"), false);
  assert.equal(keys.has("openTiming"), false);
  assert.equal(keys.has("rendererTiming"), false);
  // 需求列出的全部读面都必须存在。
  for (const key of [
    "sessionId",
    "logEpoch",
    "seq",
    "status",
    "config",
    "queue",
    "control",
    "usage",
    "subagents",
    "workflowRuns",
    "sessionPlans",
    "rows.window",
    "optimistic",
    "loadingOlder",
    "turnNavigatorDirectoryRevision",
    "lastError",
  ] as const) {
    assert.ok(keys.has(key), `missing SessionPane key: ${key}`);
  }
  // key 集合必须无重复，否则同一次 flush 会对同一订阅者重复读取。
  assert.equal(new Set(SESSION_PANE_PROJECTION_KEYS).size, SESSION_PANE_PROJECTION_KEYS.length);
});
