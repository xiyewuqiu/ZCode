type VisibilityDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

/** 仅抑制不可见 Renderer 的 React 通知；原 store 的归约、命令和恢复链路持续运行。 */
export function subscribeToVisibleProjection(
  store: { subscribe: (listener: () => void) => () => void },
  listener: () => void,
  documentTarget: VisibilityDocument,
): () => void {
  let pending = false;
  const offStore = store.subscribe(() => {
    if (documentTarget.visibilityState === "hidden") {
      pending = true;
      return;
    }
    pending = false;
    listener();
  });
  const handleVisibility = () => {
    if (documentTarget.visibilityState === "hidden" || !pending) return;
    pending = false;
    listener();
  };
  documentTarget.addEventListener("visibilitychange", handleVisibility);
  return () => {
    offStore();
    documentTarget.removeEventListener("visibilitychange", handleVisibility);
  };
}
