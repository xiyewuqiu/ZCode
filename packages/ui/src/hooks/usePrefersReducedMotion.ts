import { useSyncExternalStore } from "react";

let query: MediaQueryList | undefined;
const listeners = new Set<() => void>();
function getQuery() {
  if (typeof window === "undefined" || !window.matchMedia) return undefined;
  return (query ??= window.matchMedia("(prefers-reduced-motion: reduce)"));
}

function subscribe(listener: () => void) {
  const media = getQuery();
  if (listeners.size === 0) media?.addEventListener("change", notifyListeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) media?.removeEventListener("change", notifyListeners);
  };
}

function notifyListeners() {
  for (const listener of listeners) listener();
}

function getSnapshot() {
  return getQuery()?.matches ?? false;
}

/** 同步读取首帧偏好，运行中切换系统动画设置也立即更新。 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
