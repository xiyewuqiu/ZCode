import { useCallback, useSyncExternalStore } from "react";
import type { ConversationStoreState } from "@/v4/conversationProjectionStore.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { subscribeToVisibleProjection } from "@/v4/visibleProjectionSubscription.js";

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

/** selector 必须返回稳定引用或原始值；运行态仍由同一个 projection store 归约。 */
export function useConversationProjectionSelector<T>(
  lease: SessionLease | null,
  selector: (state: ConversationStoreState) => T,
): T {
  const store = lease?.store ?? null;
  // 流式更新使父组件高频渲染；稳定函数身份避免每次提交都退订再订阅同一 store。
  const subscribe = useCallback(
    (listener: () => void) =>
      store ? subscribeToVisibleProjection(store, listener, document) : () => {},
    [store],
  );
  const getSnapshot = useCallback(
    () => selector(store?.getState() ?? CLOSED_STATE),
    [selector, store],
  );
  const getServerSnapshot = useCallback(() => selector(CLOSED_STATE), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
