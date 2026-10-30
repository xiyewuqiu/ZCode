import { isAtBottom } from "@/v4/timelineScrollAnchor.js";

// 滚动跟随控制器：把「跟随意图」与「原生滚动动画」从 React 渲染中分离。
//
// 关键约束：
// - 只有 pinned（following=true）才允许发起原生 smooth follow；用户手势必须先
//   interrupt，否则动画中间帧会被误判成阅读移动。
// - smooth 动画的中间帧不改变跟随意图，由 scrollend（或兜底计时器）调用 settle
//   统一落账；动画被中途打断时以打断瞬间的位置为新的阅读起点。
// - instant 贴底（流式增长、完成态、恢复）不经过动画，保持既有手感。

export interface TimelineFollowMetrics {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
}

export type TimelineFollowBehavior = "instant" | "smooth";

/** 一次读取滚动容器几何，避免调用方各自拼装字段。 */
export function readTimelineFollowMetrics(
  element: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): TimelineFollowMetrics {
  return {
    scrollTop: element.scrollTop,
    viewportHeight: element.clientHeight,
    contentHeight: element.scrollHeight,
  };
}

function scrollFloor(metrics: TimelineFollowMetrics): number {
  return Math.max(0, metrics.contentHeight - metrics.viewportHeight);
}

function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 原生 smooth 只用于短距离跟随。超长距离（例如从历史中部回到底部）会让浏览器
 * 动画持续数秒，期间虚拟列表的每次分批测高都会触发内容 commit；若逐次重定向，
 * 原生动画永远到不了终点。超过该距离直接 instant。
 */
const MAX_SMOOTH_DISTANCE_VIEWPORTS = 2;

function writeScrollTop(element: HTMLElement, top: number, force = false): number {
  // 取消原生 smooth 时必须显式调用 scrollTo，即使落点与当前值相同：
  // 只赋相同 scrollTop 不会建立新的滚动指令，动画可能继续走向旧目标。
  if (force || Math.abs(element.scrollTop - top) >= 1) {
    element.scrollTo({ top, behavior: "instant" });
  }
  return element.scrollTop;
}

export class TimelineScrollFollow {
  private following: boolean;
  private target: number | null = null;
  private sampledTop: number | undefined;

  constructor(
    initial: boolean,
    private readonly epsilonPx: number = 48,
  ) {
    this.following = initial;
  }

  /** 跟随意图；pinned 为 true。 */
  get active(): boolean {
    return this.following;
  }

  /** 是否存在未完成的原生 smooth 动画。 */
  get animating(): boolean {
    return this.target !== null;
  }

  nearBottom(metrics: TimelineFollowMetrics): boolean {
    return isAtBottom(metrics, this.epsilonPx);
  }

  /** 外部提交跟随意图；解锁同时取消未完成的动画目标。 */
  setFollowing(active: boolean): void {
    this.following = active;
    if (!active) this.target = null;
  }

  /** 丢弃采样历史，下一次 sample 把当前位置当作阅读起点。 */
  reset(): void {
    this.following = false;
    this.target = null;
    this.sampledTop = undefined;
  }

  /**
   * 采样一次滚动；默认按与上次采样位置的差异判断是否由阅读者移动。
   * smooth 动画期间不改变跟随意图。
   */
  sample(metrics: TimelineFollowMetrics, movedByReader?: boolean): boolean {
    const moved =
      movedByReader ??
      (this.sampledTop === undefined || Math.abs(metrics.scrollTop - this.sampledTop) > 0.5);
    this.sampledTop = metrics.scrollTop;
    if (!this.animating && moved) this.following = this.nearBottom(metrics);
    return this.following;
  }

  /**
   * 原生平滑滚动结束（scrollend 或兜底）时落账。
   * 未到达目标附近视为阅读者接管，解除跟随。
   */
  settle(metrics: TimelineFollowMetrics): boolean {
    const target = this.target;
    this.target = null;
    if (target === null) return this.following;
    this.sampledTop = metrics.scrollTop;
    const reached = Math.min(target, scrollFloor(metrics));
    this.following = Math.abs(metrics.scrollTop - reached) <= this.epsilonPx;
    return this.following;
  }

  /** 立即定位并采用落点的跟随态（恢复、跳转、重置）。 */
  jump(element: HTMLElement, metrics: TimelineFollowMetrics, top: number): number {
    const cancelling = this.animating;
    this.target = null;
    const target = Math.max(0, Math.min(scrollFloor(metrics), top));
    const landed =
      cancelling || Math.abs(target - metrics.scrollTop) >= 1
        ? writeScrollTop(element, target, cancelling)
        : metrics.scrollTop;
    this.sampledTop = landed;
    this.following = isAtBottom({ ...metrics, scrollTop: landed }, this.epsilonPx);
    return landed;
  }

  /**
   * 贴底。只有调用时已经 pinned 且距离较近才接受 smooth；动画在途时内容再次变化
   * 会取消动画并按最新地板立即落位，避免原生动画被逐次重启而永远到不了终点。
   */
  toBottom(
    element: HTMLElement,
    metrics: TimelineFollowMetrics,
    behavior: TimelineFollowBehavior,
  ): void {
    const wasPinned = this.following;
    this.following = true;
    const floor = scrollFloor(metrics);
    const reduced = prefersReducedMotion();
    const distance = floor - metrics.scrollTop;
    const smooth =
      behavior === "smooth" &&
      wasPinned &&
      !reduced &&
      distance <= metrics.viewportHeight * MAX_SMOOTH_DISTANCE_VIEWPORTS;

    if (!this.animating && Math.abs(metrics.scrollTop - floor) < 1) {
      this.sampledTop = metrics.scrollTop;
      return;
    }
    if (!smooth) {
      const cancelling = this.animating;
      this.target = null;
      this.sampledTop = writeScrollTop(element, floor, cancelling);
      return;
    }
    if (this.target !== floor) {
      this.target = floor;
      element.scrollTo({ top: floor, behavior: "smooth" });
    }
  }

  /** 阅读手势打断原生动画：停在当前位置，后续滚动按真实位移重新判定跟随。 */
  interrupt(element: HTMLElement, metrics: TimelineFollowMetrics): void {
    if (!this.animating) return;
    this.target = null;
    this.sampledTop = metrics.scrollTop;
    writeScrollTop(element, metrics.scrollTop, true);
  }
}
