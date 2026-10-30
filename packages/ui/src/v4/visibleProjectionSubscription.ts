import type { LayerActivity } from "@/lib/layerActivity.js";

type VisibilityDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

type StoreSubscribe = (listener: () => void) => () => void;

interface KeyedProjectionSource<K extends string> {
  subscribe: StoreSubscribe;
  subscribeKeys: (keys: Iterable<K>, listener: () => void) => () => void;
}

/**
 * 不通知 React 的两个来源：
 * - 文档隐藏（窗口最小化/切标签）；
 * - 层活动门控关闭（设置页覆盖工作区、主视图切到其它页面）。
 *
 * 两者都只抑制渲染通知：store 的归约、命令与恢复链路持续运行，重新可见/激活时
 * 一次通知最新快照。
 */
function subscribeToVisibleSource(
  subscribe: StoreSubscribe,
  listener: () => void,
  documentTarget: VisibilityDocument,
  activity?: LayerActivity,
): () => void {
  let pending = false;
  const shouldDefer = () =>
    documentTarget.visibilityState === "hidden" || (activity ? !activity.isActive() : false);
  const flushPending = () => {
    if (!pending || shouldDefer()) return;
    pending = false;
    listener();
  };
  const offStore = subscribe(() => {
    if (shouldDefer()) {
      pending = true;
      return;
    }
    pending = false;
    listener();
  });
  const handleVisibility = () => {
    if (documentTarget.visibilityState === "hidden") return;
    flushPending();
  };
  documentTarget.addEventListener("visibilitychange", handleVisibility);
  const offActivity = activity?.subscribe(flushPending);
  return () => {
    offStore();
    offActivity?.();
    documentTarget.removeEventListener("visibilitychange", handleVisibility);
  };
}

/** 整店订阅的可见性门控（兼容旧消费者）。 */
export function subscribeToVisibleProjection(
  store: { subscribe: StoreSubscribe },
  listener: () => void,
  documentTarget: VisibilityDocument,
  activity?: LayerActivity,
): () => void {
  return subscribeToVisibleSource(
    (next) => store.subscribe(next),
    listener,
    documentTarget,
    activity,
  );
}

/**
 * 按 key 订阅的可见性门控：只有登记的 key 真正变化才会进入 pending，
 * 隐藏/失活期间同样只保留一次补发。
 */
export function subscribeToVisibleProjectionKeys<K extends string>(
  store: KeyedProjectionSource<K>,
  keys: readonly K[],
  listener: () => void,
  documentTarget: VisibilityDocument,
  activity?: LayerActivity,
): () => void {
  return subscribeToVisibleSource(
    (next) => store.subscribeKeys(keys, next),
    listener,
    documentTarget,
    activity,
  );
}
