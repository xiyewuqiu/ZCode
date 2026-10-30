/* oxlint-disable eslint(max-lines) -- SessionPane/Timeline 的 per-key selector 与稳定 key 常量必须和 store key 契约相邻阅读；拆分会把同一读面规则散到多个模块。 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ConversationSnapshot, RowsWindow } from "@ycode/shared/ycode-protocol-v4";
import { useLayerActivity } from "@/lib/layerActivity.js";
import {
  hasOlderRowsInWindow,
  type ConversationProjectionKey,
  type ConversationStoreState,
  type ConversationStoreStatus,
} from "@/v4/conversationProjectionStore.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import {
  subscribeToVisibleProjection,
  subscribeToVisibleProjectionKeys,
} from "@/v4/visibleProjectionSubscription.js";

const CLOSED_STATE: ConversationStoreState = {
  status: "closed",
  snapshot: null,
  subscriptionId: null,
  lastError: null,
  optimisticCommands: [],
  loadingOlder: false,
  sessionPlans: [],
  planDirectoryRevision: 0,
  plansLoading: false,
  turnNavigatorDirectoryRevision: 0,
};

const selectState = (state: ConversationStoreState) => state;

/** 订阅完整 per-session projection。局部视图应使用 selector，避免无关 token 触发渲染。 */
export function useConversationProjection(lease: SessionLease | null): ConversationStoreState {
  return useConversationProjectionSelector(lease, selectState);
}

/**
 * selector 必须返回稳定引用或原始值；运行态仍由同一个 projection store 归约。
 *
 * `keys` 可选：传入 store 的 key 白名单后，只有这些 key 变脏才会触发重新读取。
 * 调用方必须传稳定的数组引用（模块级常量），否则每次渲染都会退订/重订阅。
 * 不传时保持整店订阅兼容语义。
 */
export function useConversationProjectionSelector<T>(
  lease: SessionLease | null,
  selector: (state: ConversationStoreState) => T,
  keys?: readonly ConversationProjectionKey[],
): T {
  const store = lease?.store ?? null;
  // 隐藏层（设置页覆盖、主视图切走）不接收通知，但订阅与 store 归约保持；
  // 重新激活时补一次最新快照。
  const activity = useLayerActivity();
  // 流式更新使父组件高频渲染；稳定函数身份避免每次提交都退订再订阅同一 store。
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!store) return () => {};
      return keys
        ? subscribeToVisibleProjectionKeys(store, keys, listener, document, activity)
        : subscribeToVisibleProjection(store, listener, document, activity);
    },
    [activity, keys, store],
  );
  const getSnapshot = useCallback(
    () => selector(store?.getState() ?? CLOSED_STATE),
    [selector, store],
  );
  const getServerSnapshot = useCallback(() => selector(CLOSED_STATE), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * ConversationTimeline 的只读投影 key。
 *
 * 时间线的数据面只有 rows 窗口、loadOlder 在途标记和问题导航失效代际：
 * - queue / control / usage / optimistic / status 等 `state.updated` 或本地写入
 *   不会变脏这些 key，因此不会唤醒时间线；
 * - 连接态、错误面板与整份 snapshot（composer 需要）仍由 SessionPane 的整店
 *   兼容订阅负责，避免把 spacer/follow 之外的读面拆散。
 */
export const CONVERSATION_TIMELINE_KEYS: readonly ConversationProjectionKey[] = [
  "rows.window",
  "loadingOlder",
  "turnNavigatorDirectoryRevision",
];

interface ConversationTimelineProjection {
  /** 尾部窗口（含 totalCount / firstRowId）；subscribeKeys 保证只在窗口变化时更新。 */
  rows: RowsWindow | null;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  turnNavigatorDirectoryRevision: number;
}

const selectTimelineRows = (state: ConversationStoreState): RowsWindow | null =>
  state.snapshot?.rows ?? null;

/**
 * 时间线只读投影：只订阅 rows.window / loadingOlder / turnNavigatorDirectoryRevision。
 * 返回对象按这几个输入做 memo，避免每次渲染产生新引用击穿下游 memo 边界。
 */
export function useConversationTimelineProjection(
  lease: SessionLease | null,
): ConversationTimelineProjection {
  // 一次订阅拿整店引用（`getState()` 的稳定引用），读取面由下面的 memo 收窄；
  // selector 若返回新对象会触发 useSyncExternalStore 的一致性重渲染。
  const state = useConversationProjectionSelector(lease, selectState, CONVERSATION_TIMELINE_KEYS);
  const rows = selectTimelineRows(state);
  const loadingOlder = state.loadingOlder;
  const turnNavigatorDirectoryRevision = state.turnNavigatorDirectoryRevision;
  return useMemo(
    () => ({
      rows,
      canLoadOlder: hasOlderRowsInWindow(rows),
      loadingOlder,
      turnNavigatorDirectoryRevision,
    }),
    [loadingOlder, rows, turnNavigatorDirectoryRevision],
  );
}

// ── SessionPane 外壳的 per-key 读面 ──

/**
 * SessionPane 外壳消费的投影切片。
 *
 * 与整店订阅的区别：每个字段只登记自己的 store key。例如 queue 写入只通知 queue
 * selector，不会触发 config/usage 等 selector 的 store 通知；未登记的 plansLoading /
 * 诊断 key 完全不进入通知集合。多个 selector 同处一个组件时，组件仍按自身读面的并集
 * 渲染；时间线等子读面应使用独立的更窄 key 集合。
 * `snapshot` 由这些 keyed slice 在 render 时重建，仍是 `ConversationProjectionStore`
 * 的派生物，不新增状态所有者。
 */
export interface SessionPaneProjection {
  /** 会话身份与帧水位：snapshot 替换与 delta 推进各自独立。 */
  sessionId: string | null;
  logEpoch: string | null;
  seq: number | null;
  status: ConversationStoreStatus;
  subscriptionId: string | null;
  lastError: string | null;
  /** 由 keyed slice 重建的完整快照；只有被订阅字段变化时才换引用。 */
  snapshot: ConversationSnapshot | null;
  config: ConversationSnapshot["config"] | null;
  queue: ConversationSnapshot["queue"] | null;
  control: ConversationSnapshot["control"] | null;
  usage: ConversationSnapshot["usage"] | null;
  subagents: ConversationSnapshot["subagents"];
  workflowRuns: ConversationSnapshot["workflowRuns"];
  goal: ConversationSnapshot["goal"] | undefined;
  plan: ConversationSnapshot["plan"] | undefined;
  availability: ConversationSnapshot["availability"] | null;
  pendingInteractions: ConversationSnapshot["pendingInteractions"];
  pendingCommands: ConversationSnapshot["pendingCommands"];
  backgroundWorks: ConversationSnapshot["backgroundWorks"];
  meta: ConversationSnapshot["meta"] | null;
  workspaceHookAdmission: ConversationSnapshot["workspaceHookAdmission"] | undefined;
  inputRouting: ConversationSnapshot["inputRouting"] | null;
  revision: number | null;
  rows: RowsWindow | null;
  sessionPlans: ConversationStoreState["sessionPlans"];
  planDirectoryRevision: number;
  loadingOlder: boolean;
  turnNavigatorDirectoryRevision: number;
  optimisticCommands: ConversationStoreState["optimisticCommands"];
}

const EMPTY_PENDING_INTERACTIONS: ConversationSnapshot["pendingInteractions"] = [];
const EMPTY_PENDING_COMMANDS: ConversationSnapshot["pendingCommands"] = [];
const EMPTY_BACKGROUND_WORKS: ConversationSnapshot["backgroundWorks"] = [];

const selectSessionId = (state: ConversationStoreState): string | null =>
  state.snapshot?.sessionId ?? null;
const selectLogEpoch = (state: ConversationStoreState): string | null =>
  state.snapshot?.logEpoch ?? null;
const selectSeq = (state: ConversationStoreState): number | null => state.snapshot?.seq ?? null;
const selectStatus = (state: ConversationStoreState): ConversationStoreStatus => state.status;
const selectSubscriptionId = (state: ConversationStoreState): string | null => state.subscriptionId;
const selectLastError = (state: ConversationStoreState): string | null => state.lastError;
const selectSnapshotConfig = (
  state: ConversationStoreState,
): ConversationSnapshot["config"] | null => state.snapshot?.config ?? null;
const selectSnapshotQueue = (state: ConversationStoreState): ConversationSnapshot["queue"] | null =>
  state.snapshot?.queue ?? null;
const selectSnapshotControl = (
  state: ConversationStoreState,
): ConversationSnapshot["control"] | null => state.snapshot?.control ?? null;
const selectSnapshotUsage = (state: ConversationStoreState): ConversationSnapshot["usage"] | null =>
  state.snapshot?.usage ?? null;
const selectSnapshotSubagents = (
  state: ConversationStoreState,
): ConversationSnapshot["subagents"] => state.snapshot?.subagents;
const selectSnapshotWorkflowRuns = (
  state: ConversationStoreState,
): ConversationSnapshot["workflowRuns"] => state.snapshot?.workflowRuns;
const selectSnapshotGoal = (
  state: ConversationStoreState,
): ConversationSnapshot["goal"] | undefined => state.snapshot?.goal;
const selectSnapshotPlan = (
  state: ConversationStoreState,
): ConversationSnapshot["plan"] | undefined => state.snapshot?.plan;
const selectSnapshotAvailability = (
  state: ConversationStoreState,
): ConversationSnapshot["availability"] | null => state.snapshot?.availability ?? null;
const selectSnapshotPendingInteractions = (
  state: ConversationStoreState,
): ConversationSnapshot["pendingInteractions"] =>
  state.snapshot?.pendingInteractions ?? EMPTY_PENDING_INTERACTIONS;
const selectSnapshotPendingCommands = (
  state: ConversationStoreState,
): ConversationSnapshot["pendingCommands"] =>
  state.snapshot?.pendingCommands ?? EMPTY_PENDING_COMMANDS;
const selectSnapshotBackgroundWorks = (
  state: ConversationStoreState,
): ConversationSnapshot["backgroundWorks"] =>
  state.snapshot?.backgroundWorks ?? EMPTY_BACKGROUND_WORKS;
const selectSnapshotMeta = (state: ConversationStoreState): ConversationSnapshot["meta"] | null =>
  state.snapshot?.meta ?? null;
const selectSnapshotSharedContextImport = (
  state: ConversationStoreState,
): ConversationSnapshot["sharedContextImport"] => state.snapshot?.sharedContextImport;
const selectSnapshotModelTransition = (
  state: ConversationStoreState,
): ConversationSnapshot["modelTransition"] => state.snapshot?.modelTransition ?? null;
const selectSnapshotWorkspaceHookAdmission = (
  state: ConversationStoreState,
): ConversationSnapshot["workspaceHookAdmission"] | undefined =>
  state.snapshot ? state.snapshot.workspaceHookAdmission : undefined;
const selectSnapshotInputRouting = (
  state: ConversationStoreState,
): ConversationSnapshot["inputRouting"] | null => state.snapshot?.inputRouting ?? null;
const selectSnapshotRevision = (state: ConversationStoreState): number | null =>
  state.snapshot?.revision ?? null;
const selectRows = (state: ConversationStoreState): RowsWindow | null =>
  state.snapshot?.rows ?? null;
const selectSessionPlans = (
  state: ConversationStoreState,
): ConversationStoreState["sessionPlans"] => state.sessionPlans;
const selectPlanDirectoryRevision = (state: ConversationStoreState): number =>
  state.planDirectoryRevision;
const selectLoadingOlder = (state: ConversationStoreState): boolean => state.loadingOlder;
const selectTurnNavigatorRevision = (state: ConversationStoreState): number =>
  state.turnNavigatorDirectoryRevision;
const selectOptimisticCommands = (
  state: ConversationStoreState,
): ConversationStoreState["optimisticCommands"] => state.optimisticCommands;

/**
 * 每个切片使用独立、稳定的 key 数组。数组必须是模块级常量，否则
 * `useConversationProjectionSelector` 每次渲染都会退订/重订阅。
 */
const KEY_SESSION_ID: readonly ConversationProjectionKey[] = ["sessionId"];
const KEY_LOG_EPOCH: readonly ConversationProjectionKey[] = ["logEpoch"];
const KEY_SEQ: readonly ConversationProjectionKey[] = ["seq"];
const KEY_STATUS: readonly ConversationProjectionKey[] = ["status"];
const KEY_SUBSCRIPTION_ID: readonly ConversationProjectionKey[] = ["subscriptionId"];
const KEY_LAST_ERROR: readonly ConversationProjectionKey[] = ["lastError"];
const KEY_CONFIG: readonly ConversationProjectionKey[] = ["config"];
const KEY_QUEUE: readonly ConversationProjectionKey[] = ["queue"];
const KEY_CONTROL: readonly ConversationProjectionKey[] = ["control"];
const KEY_USAGE: readonly ConversationProjectionKey[] = ["usage"];
const KEY_SUBAGENTS: readonly ConversationProjectionKey[] = ["subagents"];
const KEY_WORKFLOW_RUNS: readonly ConversationProjectionKey[] = ["workflowRuns"];
const KEY_GOAL: readonly ConversationProjectionKey[] = ["goal"];
const KEY_PLAN: readonly ConversationProjectionKey[] = ["plan"];
const KEY_AVAILABILITY: readonly ConversationProjectionKey[] = ["availability"];
const KEY_PENDING_INTERACTIONS: readonly ConversationProjectionKey[] = ["pendingInteractions"];
const KEY_PENDING_COMMANDS: readonly ConversationProjectionKey[] = ["pendingCommands"];
const KEY_BACKGROUND_WORKS: readonly ConversationProjectionKey[] = ["backgroundWorks"];
const KEY_META: readonly ConversationProjectionKey[] = ["meta"];
const KEY_SHARED_CONTEXT_IMPORT: readonly ConversationProjectionKey[] = ["sharedContextImport"];
const KEY_MODEL_TRANSITION: readonly ConversationProjectionKey[] = ["modelTransition"];
const KEY_WORKSPACE_HOOK_ADMISSION: readonly ConversationProjectionKey[] = [
  "workspaceHookAdmission",
];
const KEY_INPUT_ROUTING: readonly ConversationProjectionKey[] = ["inputRouting"];
const KEY_REVISION: readonly ConversationProjectionKey[] = ["revision"];
const KEY_ROWS: readonly ConversationProjectionKey[] = ["rows.window"];
const KEY_SESSION_PLANS: readonly ConversationProjectionKey[] = ["sessionPlans"];
const KEY_PLAN_DIRECTORY_REVISION: readonly ConversationProjectionKey[] = ["planDirectoryRevision"];
const KEY_LOADING_OLDER: readonly ConversationProjectionKey[] = ["loadingOlder"];
const KEY_TURN_NAVIGATOR_REVISION: readonly ConversationProjectionKey[] = [
  "turnNavigatorDirectoryRevision",
];
const KEY_OPTIMISTIC: readonly ConversationProjectionKey[] = ["optimistic"];

/**
 * SessionPane 外壳实际登记的全部 key；用于测试/诊断确认外壳没有回退到整店订阅。
 * 注意：这些都是 snapshot 字段、身份字段或独立状态字段，不包含 `snapshot` 整身份 key。
 */
export const SESSION_PANE_PROJECTION_KEYS: readonly ConversationProjectionKey[] = [
  ...KEY_SESSION_ID,
  ...KEY_LOG_EPOCH,
  ...KEY_SEQ,
  ...KEY_STATUS,
  ...KEY_SUBSCRIPTION_ID,
  ...KEY_LAST_ERROR,
  ...KEY_CONFIG,
  ...KEY_QUEUE,
  ...KEY_CONTROL,
  ...KEY_USAGE,
  ...KEY_SUBAGENTS,
  ...KEY_WORKFLOW_RUNS,
  ...KEY_GOAL,
  ...KEY_PLAN,
  ...KEY_AVAILABILITY,
  ...KEY_PENDING_INTERACTIONS,
  ...KEY_PENDING_COMMANDS,
  ...KEY_BACKGROUND_WORKS,
  ...KEY_META,
  ...KEY_SHARED_CONTEXT_IMPORT,
  ...KEY_MODEL_TRANSITION,
  ...KEY_WORKSPACE_HOOK_ADMISSION,
  ...KEY_INPUT_ROUTING,
  ...KEY_REVISION,
  ...KEY_ROWS,
  ...KEY_SESSION_PLANS,
  ...KEY_PLAN_DIRECTORY_REVISION,
  ...KEY_LOADING_OLDER,
  ...KEY_TURN_NAVIGATOR_REVISION,
  ...KEY_OPTIMISTIC,
];

/**
 * `ConversationProjectionStore` 的 SessionPane 读面。
 *
 * 所有 keyed slice 都来自同一个 store；`snapshot` 是 render 时的派生对象，
 * 不写回 store，也不新增第二份会话事实。命令回调继续通过 `snapshotRef` 读取
 * 本 hook 返回的最新快照，避免捕获渲染时的陈旧闭包。
 */
export function useSessionPaneProjection(lease: SessionLease | null): SessionPaneProjection {
  const sessionId = useConversationProjectionSelector(lease, selectSessionId, KEY_SESSION_ID);
  const logEpoch = useConversationProjectionSelector(lease, selectLogEpoch, KEY_LOG_EPOCH);
  const seq = useConversationProjectionSelector(lease, selectSeq, KEY_SEQ);
  const status = useConversationProjectionSelector(lease, selectStatus, KEY_STATUS);
  const subscriptionId = useConversationProjectionSelector(
    lease,
    selectSubscriptionId,
    KEY_SUBSCRIPTION_ID,
  );
  const lastError = useConversationProjectionSelector(lease, selectLastError, KEY_LAST_ERROR);
  const config = useConversationProjectionSelector(lease, selectSnapshotConfig, KEY_CONFIG);
  const queue = useConversationProjectionSelector(lease, selectSnapshotQueue, KEY_QUEUE);
  const control = useConversationProjectionSelector(lease, selectSnapshotControl, KEY_CONTROL);
  const usage = useConversationProjectionSelector(lease, selectSnapshotUsage, KEY_USAGE);
  const subagents = useConversationProjectionSelector(
    lease,
    selectSnapshotSubagents,
    KEY_SUBAGENTS,
  );
  const workflowRuns = useConversationProjectionSelector(
    lease,
    selectSnapshotWorkflowRuns,
    KEY_WORKFLOW_RUNS,
  );
  const goal = useConversationProjectionSelector(lease, selectSnapshotGoal, KEY_GOAL);
  const plan = useConversationProjectionSelector(lease, selectSnapshotPlan, KEY_PLAN);
  const availability = useConversationProjectionSelector(
    lease,
    selectSnapshotAvailability,
    KEY_AVAILABILITY,
  );
  const pendingInteractions = useConversationProjectionSelector(
    lease,
    selectSnapshotPendingInteractions,
    KEY_PENDING_INTERACTIONS,
  );
  const pendingCommands = useConversationProjectionSelector(
    lease,
    selectSnapshotPendingCommands,
    KEY_PENDING_COMMANDS,
  );
  const backgroundWorks = useConversationProjectionSelector(
    lease,
    selectSnapshotBackgroundWorks,
    KEY_BACKGROUND_WORKS,
  );
  const meta = useConversationProjectionSelector(lease, selectSnapshotMeta, KEY_META);
  const sharedContextImport = useConversationProjectionSelector(
    lease,
    selectSnapshotSharedContextImport,
    KEY_SHARED_CONTEXT_IMPORT,
  );
  const modelTransition = useConversationProjectionSelector(
    lease,
    selectSnapshotModelTransition,
    KEY_MODEL_TRANSITION,
  );
  const workspaceHookAdmission = useConversationProjectionSelector(
    lease,
    selectSnapshotWorkspaceHookAdmission,
    KEY_WORKSPACE_HOOK_ADMISSION,
  );
  const inputRouting = useConversationProjectionSelector(
    lease,
    selectSnapshotInputRouting,
    KEY_INPUT_ROUTING,
  );
  const revision = useConversationProjectionSelector(lease, selectSnapshotRevision, KEY_REVISION);
  const rows = useConversationProjectionSelector(lease, selectRows, KEY_ROWS);
  const sessionPlans = useConversationProjectionSelector(
    lease,
    selectSessionPlans,
    KEY_SESSION_PLANS,
  );
  const planDirectoryRevision = useConversationProjectionSelector(
    lease,
    selectPlanDirectoryRevision,
    KEY_PLAN_DIRECTORY_REVISION,
  );
  const loadingOlder = useConversationProjectionSelector(
    lease,
    selectLoadingOlder,
    KEY_LOADING_OLDER,
  );
  const turnNavigatorDirectoryRevision = useConversationProjectionSelector(
    lease,
    selectTurnNavigatorRevision,
    KEY_TURN_NAVIGATOR_REVISION,
  );
  const optimisticCommands = useConversationProjectionSelector(
    lease,
    selectOptimisticCommands,
    KEY_OPTIMISTIC,
  );

  // snapshot 只由 keyed slice 组合，不再读取 `state.snapshot` 整身份 key。
  // 任一字段变化都会换引用；未登记的 store key（如 plansLoading）不会触发。
  const snapshot = useMemo<ConversationSnapshot | null>(() => {
    if (
      sessionId === null ||
      logEpoch === null ||
      seq === null ||
      revision === null ||
      control === null ||
      availability === null ||
      inputRouting === null ||
      meta === null ||
      config === null ||
      usage === null ||
      queue === null ||
      rows === null
    ) {
      return null;
    }
    return {
      protocolVersion: 1,
      sessionId,
      logEpoch,
      seq,
      revision,
      control,
      availability,
      inputRouting,
      meta,
      ...(sharedContextImport === undefined ? {} : { sharedContextImport }),
      config,
      modelTransition: modelTransition ?? null,
      usage,
      queue,
      pendingInteractions,
      pendingCommands,
      backgroundWorks,
      ...(subagents === undefined ? {} : { subagents }),
      ...(workflowRuns === undefined ? {} : { workflowRuns }),
      goal: goal ?? null,
      plan: plan ?? null,
      workspaceHookAdmission: workspaceHookAdmission ?? null,
      rows,
    };
  }, [
    availability,
    backgroundWorks,
    config,
    control,
    goal,
    inputRouting,
    logEpoch,
    meta,
    modelTransition,
    pendingCommands,
    pendingInteractions,
    plan,
    queue,
    revision,
    rows,
    seq,
    sessionId,
    sharedContextImport,
    subagents,
    usage,
    workflowRuns,
    workspaceHookAdmission,
  ]);

  return useMemo(
    () => ({
      sessionId,
      logEpoch,
      seq,
      status,
      subscriptionId,
      lastError,
      snapshot,
      config,
      queue,
      control,
      usage,
      subagents,
      workflowRuns,
      goal,
      plan,
      availability,
      pendingInteractions,
      pendingCommands,
      backgroundWorks,
      meta,
      workspaceHookAdmission,
      inputRouting,
      revision,
      rows,
      sessionPlans,
      planDirectoryRevision,
      loadingOlder,
      turnNavigatorDirectoryRevision,
      optimisticCommands,
    }),
    [
      availability,
      backgroundWorks,
      config,
      control,
      goal,
      inputRouting,
      lastError,
      loadingOlder,
      logEpoch,
      meta,
      optimisticCommands,
      pendingCommands,
      pendingInteractions,
      plan,
      planDirectoryRevision,
      queue,
      revision,
      rows,
      seq,
      sessionId,
      sessionPlans,
      snapshot,
      status,
      subagents,
      subscriptionId,
      turnNavigatorDirectoryRevision,
      usage,
      workflowRuns,
      workspaceHookAdmission,
    ],
  );
}
