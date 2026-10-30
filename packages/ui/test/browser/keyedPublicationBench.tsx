import { createRoot } from "react-dom/client";
import { memo } from "react";
import type { ConversationRow, ConversationSnapshot } from "@ycode/shared/ycode-protocol-v4";
import type {
  ConversationProjectionKey,
  ConversationProjectionStore,
  ConversationStoreState,
} from "../../src/v4/conversationProjectionStore.js";
import {
  CONVERSATION_TIMELINE_KEYS,
  SESSION_PANE_PROJECTION_KEYS,
  useConversationProjection,
  useConversationTimelineProjection,
  useSessionPaneProjection,
} from "../../src/v4/useConversationProjection.js";
import type { FrameNotificationScheduler } from "../../src/lib/frameNotificationScheduler.js";
import { KeyedPublication } from "../../src/lib/keyedPublication.js";
import type { SessionLease } from "../../src/v4/sessionDataLayer.js";

/**
 * per-key 订阅的浏览器基准（无需 Electron / 真实 Host）。
 *
 * 同一个合成 projection store 上挂三个真实 hook 消费者：
 * - whole：`useConversationProjection`（改造前的整店兼容订阅）；
 * - pane：`useSessionPaneProjection`（SessionPane 外壳的 keyed 读面）；
 * - timeline：`useConversationTimelineProjection`（只登记 rows.window /
 *   loadingOlder / turnNavigatorDirectoryRevision）。
 *
 * 脚本按 frame 逐条推送 rows / queue / status / optimistic 四类写入，分别统计
 * 通知次数与 React 渲染次数。timeline 消费者只应在 rows 写入时被唤醒；
 * pane 消费者按自己的 keyed 读面被唤醒。这样可以同时验证「外壳不再整店订阅」
 * 与「时间线只读面不被 queue/status/optimistic 唤醒」。
 */

const BENCH_KEYS: readonly ConversationProjectionKey[] = [
  "snapshot",
  ...SESSION_PANE_PROJECTION_KEYS,
];

const NO_SNAPSHOT = Symbol("bench.no-snapshot");

function createInitialSnapshot(): ConversationSnapshot {
  // 只构造 hook 读取的字段；浏览器基准不消费协议校验，也不连真实 Host。
  return {
    protocolVersion: 1,
    sessionId: "synthetic-bench",
    logEpoch: "bench-epoch",
    seq: 0,
    revision: 0,
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
    inputRouting: { mode: "startNow" },
    meta: { title: "", titleSource: "default" },
    config: { provider: "synthetic", model: "synthetic-model", thought: "", followupMode: "queue" },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  } as unknown as ConversationSnapshot;
}

function createInitialState(): ConversationStoreState {
  return {
    status: "live",
    snapshot: createInitialSnapshot(),
    subscriptionId: "bench-subscription",
    lastError: null,
    optimisticCommands: [],
    loadingOlder: false,
    sessionPlans: [],
    planDirectoryRevision: 0,
    plansLoading: false,
    turnNavigatorDirectoryRevision: 0,
  };
}

// 同步调度器：一次写入即一次通知，便于把「通知次数」与「渲染次数」对齐比较。
const synchronousScheduler: FrameNotificationScheduler = {
  schedule(notify) {
    notify();
    return false;
  },
  flush() {},
  cancel() {},
  hasPending() {
    return false;
  },
};

let state = createInitialState();

function readBenchKey(key: ConversationProjectionKey): unknown {
  switch (key) {
    case "snapshot":
      return state.snapshot;
    case "sessionId":
      return state.snapshot?.sessionId ?? NO_SNAPSHOT;
    case "logEpoch":
      return state.snapshot?.logEpoch ?? NO_SNAPSHOT;
    case "seq":
      return state.snapshot?.seq ?? NO_SNAPSHOT;
    case "rows.window":
      return state.snapshot?.rows ?? NO_SNAPSHOT;
    case "status":
      return state.status;
    case "subscriptionId":
      return state.subscriptionId;
    case "lastError":
      return state.lastError;
    case "optimistic":
      return state.optimisticCommands;
    case "sessionPlans":
      return state.sessionPlans;
    case "planDirectoryRevision":
      return state.planDirectoryRevision;
    case "plansLoading":
      return state.plansLoading;
    case "loadingOlder":
      return state.loadingOlder;
    case "openTiming":
      return state.openTiming;
    case "rendererTiming":
      return state.rendererTiming;
    case "turnNavigatorDirectoryRevision":
      return state.turnNavigatorDirectoryRevision;
    default:
      return state.snapshot ? state.snapshot[key] : NO_SNAPSHOT;
  }
}

const publication = new KeyedPublication<ConversationProjectionKey>({
  allKeys: BENCH_KEYS,
  readKey: readBenchKey,
  scheduler: synchronousScheduler,
});

const fakeStore = {
  subscribe: (listener: () => void) => publication.subscribe(listener),
  subscribeKeys: (keys: Iterable<ConversationProjectionKey>, listener: () => void) =>
    publication.subscribeKeys(keys, listener),
  getState: () => state,
} as unknown as ConversationProjectionStore;

const lease: SessionLease = {
  sessionId: "synthetic-bench",
  store: fakeStore,
  startedAt: 0,
  release: () => {},
};

interface BenchCounters {
  wholeNotifications: number;
  paneNotifications: number;
  timelineNotifications: number;
  wholeRenders: number;
  paneRenders: number;
  timelineRenders: number;
  timelineOnlyRenders: number;
  rowsWrites: number;
}

const counters: BenchCounters = {
  wholeNotifications: 0,
  paneNotifications: 0,
  timelineNotifications: 0,
  wholeRenders: 0,
  paneRenders: 0,
  timelineRenders: 0,
  timelineOnlyRenders: 0,
  rowsWrites: 0,
};

// 与 React 订阅并行登记一份纯通知计数，区分「通知」与「渲染」。
publication.subscribe(() => {
  counters.wholeNotifications += 1;
});
publication.subscribeKeys(SESSION_PANE_PROJECTION_KEYS, () => {
  counters.paneNotifications += 1;
});
publication.subscribeKeys(CONVERSATION_TIMELINE_KEYS, () => {
  counters.timelineNotifications += 1;
});

function publish(next: ConversationStoreState, dirtyKeys: ConversationProjectionKey[]): void {
  state = next;
  publication.markDirty(dirtyKeys);
  publication.publish("animation-frame");
}

type BenchWriteKind = "rows" | "queue" | "status" | "optimistic";

function pushRows(): void {
  const snapshot = state.snapshot!;
  const rowId = snapshot.rows.window.length + 1;
  const row = {
    kind: "assistantText",
    rowId,
    turnId: "bench-turn",
    createdAt: rowId,
    createdAtSeq: rowId,
    text: `token ${rowId}`,
    state: "streaming",
  } as unknown as ConversationRow;
  const rows = {
    window: [...snapshot.rows.window, row],
    totalCount: snapshot.rows.totalCount + 1,
    firstRowId: snapshot.rows.firstRowId ?? rowId,
  };
  // delta 帧：rows 与 seq 同步推进；sessionId/logEpoch 引用保持不变。
  publish({ ...state, snapshot: { ...snapshot, rows, seq: snapshot.seq + 1 } }, [
    "snapshot",
    "rows.window",
    "seq",
  ]);
  counters.rowsWrites += 1;
}

function pushQueue(): void {
  const snapshot = state.snapshot!;
  const items = [
    ...snapshot.queue.items,
    {
      queueItemId: `queue-${snapshot.queue.items.length}`,
    } as unknown as (typeof snapshot.queue.items)[number],
  ];
  // state.updated(queue)：只改 queue 字段；rows 引用不变，时间线不得被唤醒。
  publish({ ...state, snapshot: { ...snapshot, queue: { ...snapshot.queue, items } } }, [
    "snapshot",
    "queue",
  ]);
}

function pushStatus(): void {
  publish({ ...state, status: state.status === "live" ? "connecting" : "live" }, ["status"]);
}

function pushOptimistic(): void {
  publish(
    {
      ...state,
      optimisticCommands: [
        ...state.optimisticCommands,
        {
          commandId: `command-${state.optimisticCommands.length}`,
          type: "sendText",
          issuedAt: state.optimisticCommands.length,
        },
      ],
    },
    ["optimistic"],
  );
}

function push(kind: BenchWriteKind): void {
  switch (kind) {
    case "rows":
      pushRows();
      return;
    case "queue":
      pushQueue();
      return;
    case "status":
      pushStatus();
      return;
    case "optimistic":
      pushOptimistic();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function WholeConsumer() {
  const wholeState = useConversationProjection(lease);
  counters.wholeRenders += 1;
  return (
    <div
      data-testid="whole-consumer"
      data-renders={counters.wholeRenders}
      data-status={wholeState.status}
      data-queue={wholeState.snapshot?.queue.items.length ?? 0}
    />
  );
}

function PaneConsumer() {
  const projection = useSessionPaneProjection(lease);
  counters.paneRenders += 1;
  return (
    <div
      data-testid="pane-consumer"
      data-renders={counters.paneRenders}
      data-status={projection.status}
      data-queue={projection.queue?.items.length ?? 0}
      data-seq={projection.seq ?? ""}
    >
      {/* 真实 ConversationTimeline 是 memo；这里用无 prop 的 memo 子组件模拟
          「timeline-only 读面」：外壳因 queue/status/optimistic 重渲染时不应连带重渲染。 */}
      <TimelineOnlySurface />
    </div>
  );
}

const TimelineOnlySurface = memo(function TimelineOnlySurface() {
  const projection = useConversationTimelineProjection(lease);
  counters.timelineOnlyRenders += 1;
  return (
    <div
      data-testid="timeline-only-surface"
      data-renders={counters.timelineOnlyRenders}
      data-rows={projection.rows?.window.length ?? 0}
    />
  );
});

function TimelineConsumer() {
  const projection = useConversationTimelineProjection(lease);
  counters.timelineRenders += 1;
  return (
    <div
      data-testid="timeline-consumer"
      data-renders={counters.timelineRenders}
      data-rows={projection.rows?.window.length ?? 0}
    />
  );
}

interface StepResult extends BenchCounters {
  deltas: {
    wholeRenders: number;
    paneRenders: number;
    timelineRenders: number;
    timelineOnlyRenders: number;
    timelineNotifications: number;
  };
}

interface BenchApi {
  runStep: (kind: BenchWriteKind) => Promise<StepResult>;
  runMixedBatch: (perKind: number) => Promise<BenchCounters>;
  snapshot: () => BenchCounters;
}

const benchApi: BenchApi = {
  async runStep(kind) {
    const before = { ...counters };
    push(kind);
    await nextFrame();
    return {
      ...counters,
      deltas: {
        wholeRenders: counters.wholeRenders - before.wholeRenders,
        paneRenders: counters.paneRenders - before.paneRenders,
        timelineRenders: counters.timelineRenders - before.timelineRenders,
        timelineOnlyRenders: counters.timelineOnlyRenders - before.timelineOnlyRenders,
        timelineNotifications: counters.timelineNotifications - before.timelineNotifications,
      },
    };
  },
  async runMixedBatch(perKind) {
    for (let index = 0; index < perKind; index += 1) {
      push("rows");
      await nextFrame();
      push("queue");
      await nextFrame();
      push("status");
      await nextFrame();
      push("optimistic");
      await nextFrame();
    }
    return { ...counters };
  },
  snapshot: () => ({ ...counters }),
};

(globalThis as typeof globalThis & { __keyedBench?: BenchApi }).__keyedBench = benchApi;

function Fixture() {
  return (
    <div style={{ fontFamily: "monospace", padding: 12 }}>
      <WholeConsumer />
      <PaneConsumer />
      <TimelineConsumer />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
