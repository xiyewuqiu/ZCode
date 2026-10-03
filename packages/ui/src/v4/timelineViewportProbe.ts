import { useCallback, useRef, useSyncExternalStore } from "react";
import { isAtBottom as isScrollAtBottom } from "@/v4/timelineScrollAnchor.js";
import { resolveConversationTurnNavigatorActiveQueryRowId } from "@/v4/conversationTurnNavigatorHelpers.js";

/**
 * 时间线视口度量探针：
 *
 * 过去每个 scroll 事件都会在 `ConversationTimeline` 里 `setState` 视口快照，于是
 * 一次滚动会把 1,900 行的 Timeline（导航、虚拟行、dock 全量）重渲染一遍，帧间隔直接
 * 翻倍。这里把「滚动驱动的视觉」从 Timeline 渲染中剥离出来：
 *
 * - 度量与消息层遮罩按帧（rAF）合并，滚动事件只登记失效，不触发 React 写入；
 * - 只有滚动驱动的组件（ConversationTurnNavigator）订阅探针，并把度量折叠成
 *   「活动项是否变化」的稳定快照，跨轮次移动时才重渲染；
 * - 探针是视口度量的唯一来源，不再保留 `virtualizer.scrollOffset ?? state` 双读路径。
 */

export interface TimelineViewportMetrics {
  scrollOffsetPx: number;
  viewportHeightPx: number;
  activeQueryRowId: number | undefined;
}

const INITIAL_METRICS: TimelineViewportMetrics = {
  scrollOffsetPx: 0,
  viewportHeightPx: 0,
  activeQueryRowId: undefined,
};

/** 贴底时遮罩保持关闭；离底时按 composer 高度淡出消息层末尾。 */
const COMPOSER_MESSAGE_MASK_FADE_PX = 24;
const COMPOSER_MESSAGE_MASK_TRANSPARENT_HEIGHT_PX = 96;

export interface TimelineViewportProbe {
  subscribe(listener: () => void): () => void;
  getMetrics(): TimelineViewportMetrics;
  /** 绑定滚动容器与消息层；null 表示卸载。 */
  attach(element: HTMLDivElement | null, messageLayer: HTMLDivElement | null): void;
  /** 可导航 query 行集合；活动项判定只在这些行上做 DOM 测量。 */
  setQueryRowIds(ids: ReadonlySet<number>): void;
  /** 导航 rail 是否需要活动项：关闭或容器过窄时跳过度量扫描。 */
  setQueryTrackingEnabled(enabled: boolean): void;
  /** 滚动事件路径：一帧内合并刷新。 */
  invalidate(): void;
  /** 程序化滚动/布局补偿后立即落地（绘制前完成）。 */
  flush(): void;
  dispose(): void;
}

/** 遮罩描述：签名相同即跳过 DOM 写入（贴底时用 null 表示不遮罩）。 */
function resolveMessageLayerMaskSignature(
  element: HTMLDivElement,
  messageLayer: HTMLDivElement,
): string | null {
  const scrollTop = element.scrollTop;
  const viewportHeight = element.clientHeight;
  if (
    isScrollAtBottom({
      scrollTop,
      viewportHeight,
      contentHeight: element.scrollHeight,
    })
  ) {
    return null;
  }
  const transparentStart = Math.max(
    0,
    viewportHeight - COMPOSER_MESSAGE_MASK_TRANSPARENT_HEIGHT_PX,
  );
  const opaqueEnd = Math.max(0, transparentStart - COMPOSER_MESSAGE_MASK_FADE_PX);
  const viewportTopInLayer = Math.max(0, scrollTop - messageLayer.offsetTop);
  return `linear-gradient(to bottom, black 0, black ${opaqueEnd}px, transparent ${transparentStart}px, transparent 100%)|${viewportTopInLayer}|${viewportHeight}`;
}

function applyMessageLayerMask(messageLayer: HTMLDivElement, signature: string | null): void {
  if (signature === null) {
    // 贴底时消息已经位于正常文档流末尾，不会经过 sticky composer；
    // 继续保留 mask 会无意义地淡出最后一条消息，只有离底滚动时才需要遮罩。
    messageLayer.style.maskImage = "none";
    messageLayer.style.webkitMaskImage = "none";
    return;
  }
  const [gradient, viewportTopInLayer, viewportHeight] = signature.split("|");
  messageLayer.style.maskImage = gradient!;
  messageLayer.style.webkitMaskImage = gradient!;
  messageLayer.style.maskPosition = `0 ${viewportTopInLayer}px`;
  messageLayer.style.webkitMaskPosition = `0 ${viewportTopInLayer}px`;
  messageLayer.style.maskSize = `100% ${viewportHeight}px`;
  messageLayer.style.webkitMaskSize = `100% ${viewportHeight}px`;
}

export function createTimelineViewportProbe(): TimelineViewportProbe {
  const listeners = new Set<() => void>();
  let element: HTMLDivElement | null = null;
  let messageLayer: HTMLDivElement | null = null;
  let queryRowIds: ReadonlySet<number> = new Set<number>();
  let queryTrackingEnabled = false;
  let metrics: TimelineViewportMetrics = INITIAL_METRICS;
  // undefined = 尚未写入过；null = 已写入「无遮罩」；字符串 = 已写入的遮罩描述。
  let maskSignature: string | null | undefined;
  let frame: number | null = null;
  let disposed = false;

  function resolveActiveQueryRowId(target: HTMLDivElement): number | undefined {
    if (!queryTrackingEnabled || queryRowIds.size === 0) return undefined;
    const viewportRect = target.getBoundingClientRect();
    const queryPositions = [];
    for (const rowElement of target.querySelectorAll<HTMLElement>("[data-row-id]")) {
      const rowId = Number(rowElement.dataset.rowId);
      if (!Number.isSafeInteger(rowId) || !queryRowIds.has(rowId)) continue;
      const rowRect = rowElement.getBoundingClientRect();
      const start = target.scrollTop + rowRect.top - viewportRect.top;
      queryPositions.push({ rowId, start, end: start + rowRect.height });
    }
    return resolveConversationTurnNavigatorActiveQueryRowId({
      positions: queryPositions,
      scrollOffsetPx: target.scrollTop,
      viewportHeightPx: target.clientHeight,
    });
  }

  function compute(): void {
    const target = element;
    if (!target) return;
    if (messageLayer) {
      const signature = resolveMessageLayerMaskSignature(target, messageLayer);
      if (signature !== maskSignature) {
        applyMessageLayerMask(messageLayer, signature);
        maskSignature = signature;
      }
    }
    const next: TimelineViewportMetrics = {
      scrollOffsetPx: target.scrollTop,
      viewportHeightPx: target.clientHeight,
      activeQueryRowId: resolveActiveQueryRowId(target),
    };
    if (
      metrics.scrollOffsetPx === next.scrollOffsetPx &&
      metrics.viewportHeightPx === next.viewportHeightPx &&
      metrics.activeQueryRowId === next.activeQueryRowId
    ) {
      return;
    }
    metrics = next;
    for (const listener of listeners) listener();
  }

  function runFrame(): void {
    frame = null;
    if (disposed) return;
    compute();
  }

  function cancelFrame(): void {
    if (frame === null) return;
    globalThis.cancelAnimationFrame?.(frame);
    frame = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getMetrics() {
      return metrics;
    },
    attach(nextElement, nextMessageLayer) {
      element = nextElement;
      messageLayer = nextMessageLayer;
      // 换滚动容器/消息层后遮罩缓存失效：新节点上的既有样式不能当作已写入。
      if (!nextElement || !nextMessageLayer) {
        maskSignature = undefined;
      }
    },
    setQueryRowIds(ids) {
      queryRowIds = ids;
    },
    setQueryTrackingEnabled(enabled) {
      queryTrackingEnabled = enabled;
    },
    invalidate() {
      if (disposed || frame !== null) return;
      if (typeof globalThis.requestAnimationFrame !== "function") {
        compute();
        return;
      }
      frame = globalThis.requestAnimationFrame(runFrame);
    },
    flush() {
      cancelFrame();
      compute();
    },
    dispose() {
      disposed = true;
      cancelFrame();
      listeners.clear();
      element = null;
      messageLayer = null;
    },
  };
}

/**
 * 滚动驱动的稳定订阅：selector 在渲染期用最新度量求值，值不变则返回缓存引用，
 * React 因此不会向下传播重渲染。
 */
export function useTimelineViewportSelector<T>(
  probe: TimelineViewportProbe,
  select: (metrics: TimelineViewportMetrics) => T,
): T {
  const cacheRef = useRef<{ value: T } | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;
  const getSnapshot = useCallback(() => {
    const value = selectRef.current(probe.getMetrics());
    const cached = cacheRef.current;
    if (cached && Object.is(cached.value, value)) return cached.value;
    cacheRef.current = { value };
    return value;
  }, [probe]);
  return useSyncExternalStore(probe.subscribe, getSnapshot, getSnapshot);
}
