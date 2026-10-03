import type { LayerActivity } from "@/lib/layerActivity.js";

type VisibilityDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

/**
 * 不通知 React 的两个来源：
 * - 文档隐藏（窗口最小化/切标签）；
 * - 层活动门控关闭（设置页覆盖工作区、主视图切到其它页面）。
 *
 * 两者都只抑制渲染通知：store 的归约、命令与恢复链路持续运行，重新可见/激活时
 * 一次通知最新快照。
 */
export function subscribeToVisibleProjection(
  store: { subscribe: (listener: () => void) => () => void },
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
  const offStore = store.subscribe(() => {
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
