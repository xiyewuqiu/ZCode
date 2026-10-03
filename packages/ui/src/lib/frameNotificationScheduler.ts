/**
 * 帧内通知合并：
 *
 * 高频外部 store（会话投影、会话索引）过去在每个 delta 帧同步通知全部 React 订阅者。
 * 一次流式 burst 内可能有多个 delta 帧落在同一动画帧里，于是同一个组件在同一帧被渲染
 * 多次，主线程把时间花在重复的 render/commit 上，滚动与切换因此变卡。
 *
 * 这里把「状态已更新」与「通知 React」分离：状态始终同步写入（`getState()` 读到的
 * 永远是最新事实），通知则合并到每个动画帧一次。没有 `requestAnimationFrame` 的环境
 * （Node 测试、最小 DOM 运行时）退化为同步通知，语义与过去一致。
 *
 * 单一机制：所有需要合并通知的 store 共用同一个调度器实例，同一帧内多个 store 的
 * 通知会合并进同一次 React 渲染。
 */

export interface FrameNotificationScheduler {
  /** 合并同一帧内的多次请求；返回是否可以取消（false 表示已同步执行）。 */
  schedule(notify: () => void): boolean;
  /** 立即执行挂起的通知。 */
  flush(): void;
  /** 丢弃挂起的通知。 */
  cancel(notify: () => void): void;
  /** 是否有挂起通知。 */
  hasPending(): boolean;
}

type FrameSchedulerDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

export interface FrameNotificationSchedulerOptions {
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  document?: FrameSchedulerDocument | null;
}

export function createFrameNotificationScheduler(
  options: FrameNotificationSchedulerOptions = {},
): FrameNotificationScheduler {
  const customRequestFrame = options.requestFrame ?? null;
  const customCancelFrame = options.cancelFrame ?? null;
  const hasFrameCapability =
    customRequestFrame !== null || typeof globalThis.requestAnimationFrame === "function";
  // 测试或非 DOM 运行时没有帧概念：保持同步通知，不改变既有语义。
  if (!hasFrameCapability) {
    return {
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
  }

  const pending = new Set<() => void>();
  let frame: number | null = null;
  let visibilityTarget: FrameSchedulerDocument | null = options.document ?? null;
  if (!visibilityTarget && typeof globalThis.document !== "undefined") {
    visibilityTarget = globalThis.document as unknown as FrameSchedulerDocument;
  }

  function isHidden(): boolean {
    return visibilityTarget?.visibilityState === "hidden";
  }

  function requestNextFrame(callback: () => void): number {
    if (customRequestFrame) return customRequestFrame(callback);
    return globalThis.requestAnimationFrame(callback);
  }

  function cancelScheduledFrame(handle: number): void {
    if (customCancelFrame) {
      customCancelFrame(handle);
      return;
    }
    // 只注入了 requestFrame 的调用方自行管理句柄生命周期；此时不能假设
    // 运行时一定存在全局 cancelAnimationFrame。迟到的帧回调会因为挂起队列已空而无副作用。
    if (customRequestFrame) return;
    globalThis.cancelAnimationFrame(handle);
  }

  function runPending(): void {
    frame = null;
    if (pending.size === 0) return;
    // 通知期间可能有新的 schedule：先取出快照，执行后再决定是否补一帧。
    const batch = [...pending];
    pending.clear();
    for (const notify of batch) notify();
    if (pending.size > 0) scheduleFrame();
  }

  function scheduleFrame(): void {
    if (frame !== null) return;
    // 文档隐藏时 rAF 被浏览器节流：保留挂起通知，等可见性恢复后一次送达。
    if (isHidden()) return;
    frame = requestNextFrame(runPending);
  }

  function handleVisibilityChange(): void {
    if (isHidden() || pending.size === 0) return;
    if (frame !== null) {
      cancelScheduledFrame(frame);
      frame = null;
    }
    // 隐藏期间的变更不能等下一帧：恢复可见时立刻把最新状态交给 React。
    runPending();
  }

  if (visibilityTarget) {
    visibilityTarget.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return {
    schedule(notify) {
      pending.add(notify);
      scheduleFrame();
      return true;
    },
    flush() {
      if (frame !== null) {
        cancelScheduledFrame(frame);
        frame = null;
      }
      runPending();
    },
    cancel(notify) {
      pending.delete(notify);
    },
    hasPending() {
      return pending.size > 0;
    },
  };
}

/** 应用内共享调度器：同一帧内多个 store 的变更合并为一次 React 通知。 */
export const appFrameNotificationScheduler = createFrameNotificationScheduler();
