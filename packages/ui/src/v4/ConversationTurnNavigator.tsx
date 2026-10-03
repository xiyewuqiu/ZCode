import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion.js";
import { ConversationOutline } from "@/v4/ConversationOutline.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  TID_V4_TURN_NAVIGATOR,
  TID_V4_TURN_NAVIGATOR_ITEM,
  TID_V4_TURN_NAVIGATOR_TOOLTIP,
  testId,
} from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  createConversationTurnNavigatorProjector,
  resolveConversationTurnNavigatorActiveUnitIndex,
  resolveConversationTurnNavigatorBarVisualState,
  resolveConversationTurnNavigatorVisualFocusItemIndex,
  type ConversationTurnNavigatorVirtualItem,
  type ConversationTurnNavigatorHydrationResult,
} from "@/v4/conversationTurnNavigatorHelpers.js";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnits.js";
import {
  useTimelineViewportSelector,
  type TimelineViewportProbe,
} from "@/v4/timelineViewportProbe.js";

interface ConversationTurnNavigatorProps {
  renderUnits: readonly ConversationTurnRenderUnit[];
  virtualItems: readonly ConversationTurnNavigatorVirtualItem[];
  /**
   * 视口度量探针：rail 是唯一受滚动驱动的视觉，直接订阅探针而不是让
   * Timeline 每帧重渲染；探针也是 scrollOffset/viewportHeight 的唯一来源。
   */
  viewportProbe: TimelineViewportProbe;
  isHydratingDirectory?: boolean;
  canLoadOlder?: boolean;
  onLoadAllOlder?: () => Promise<ConversationTurnNavigatorHydrationResult>;
  onJumpToQuery: (target: { unitIndex: number; rowId: number }, behavior: ScrollBehavior) => void;
}

function ConversationTurnNavigatorImpl({
  renderUnits,
  virtualItems,
  viewportProbe,
  isHydratingDirectory = false,
  canLoadOlder = false,
  onLoadAllOlder,
  onJumpToQuery,
}: ConversationTurnNavigatorProps) {
  const { intl } = useZCodeIntl();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [interactionItemIndex, setInteractionItemIndex] = useState<number | undefined>(undefined);
  const [projectNavigatorItems] = useState(createConversationTurnNavigatorProjector);
  const items = useMemo(
    () =>
      projectNavigatorItems(renderUnits, {
        assistantEmptyPreview: intl.formatMessage({
          id: "chat.turnNavigator.emptyAssistant",
        }),
        assistantRunningPreview: intl.formatMessage({
          id: "chat.turnNavigator.runningAssistant",
        }),
        userFallbackPreview: intl.formatMessage({
          id: "chat.turnNavigator.userFallback",
        }),
      }),
    [intl, renderUnits, projectNavigatorItems],
  );

  const itemIndexes = useMemo(() => {
    const byRowId = new Map<number, number>();
    const firstByUnitIndex = new Map<number, number>();
    items.forEach((item, index) => {
      byRowId.set(item.rowId, index);
      if (!firstByUnitIndex.has(item.unitIndex)) {
        firstByUnitIndex.set(item.unitIndex, index);
      }
    });
    return { byRowId, firstByUnitIndex };
  }, [items]);
  // 滚动度量经 getSnapshot 在渲染期读取，输入经 ref 保持最新：同一轮次内滚动的每一帧
  // 都只更新缓存值，React 不向下传播重渲染；跨轮次时才产生一次真实提交。
  const viewportInputsRef = useRef({ items, itemIndexes, virtualItems });
  viewportInputsRef.current = { items, itemIndexes, virtualItems };
  const activeItemIndex = useTimelineViewportSelector(viewportProbe, (metrics) => {
    const inputs = viewportInputsRef.current;
    const unitIndex = resolveConversationTurnNavigatorActiveUnitIndex({
      items: inputs.items,
      scrollOffsetPx: metrics.scrollOffsetPx,
      viewportHeightPx: metrics.viewportHeightPx,
      virtualItems: inputs.virtualItems,
    });
    return (
      (metrics.activeQueryRowId === undefined
        ? undefined
        : inputs.itemIndexes.byRowId.get(metrics.activeQueryRowId)) ??
      (unitIndex === undefined ? undefined : inputs.itemIndexes.firstByUnitIndex.get(unitIndex)) ??
      -1
    );
  });
  const visualFocusItemIndex = resolveConversationTurnNavigatorVisualFocusItemIndex({
    activeItemIndex,
    interactionItemIndex,
  });
  const railScrollRef = useRef<HTMLDivElement>(null);
  const getRailScrollElement = useCallback(() => railScrollRef.current, []);
  const getRailItemKey = useCallback((index: number) => items[index]?.key ?? index, [items]);
  const railVirtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 10,
    getItemKey: getRailItemKey,
    getScrollElement: getRailScrollElement,
    overscan: 6,
  });
  const virtualRows = railVirtualizer.getVirtualItems();

  useEffect(() => {
    if (activeItemIndex < 0 || items.length < 2) return;
    railVirtualizer.scrollToIndex(activeItemIndex, { align: "auto" });
    const element = railScrollRef.current;
    if (!element) return;
    window.queueMicrotask(() => {
      if (railScrollRef.current !== element) return;
      // 目录从 tail 一次扩展到上千项时，scrollToIndex 与 virtualizer 的
      // measurement 更新处于同一个 commit，Chromium 可能合并 scroll 通知。补发通知
      // 只同步 rail observer，确保活动项对应的可视窗口立即挂载。
      element.dispatchEvent(new Event("scroll"));
    });
  }, [activeItemIndex, items.length, railVirtualizer]);

  if (items.length === 0 && !canLoadOlder) {
    return null;
  }

  return (
    <>
      <ConversationOutline
        items={items}
        currentKey={items[activeItemIndex]?.key}
        canLoadOlder={canLoadOlder}
        loadingOlder={isHydratingDirectory}
        onLoadAllOlder={onLoadAllOlder}
        onJumpToQuery={onJumpToQuery}
      />
      {items.length >= 2 && (
        <nav
          aria-label={intl.formatMessage({ id: "chat.turnNavigator.label" })}
          aria-busy={isHydratingDirectory}
          data-testid={TID_V4_TURN_NAVIGATOR}
          data-item-count={items.length}
          data-rendered-item-count={virtualRows.length}
          className="pointer-events-none invisible absolute inset-y-0 left-0 z-10 w-12 -translate-x-2 opacity-0 transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none @min-[864px]/conversation:visible @min-[864px]/conversation:translate-x-0 @min-[864px]/conversation:opacity-100"
        >
          <div
            ref={railScrollRef}
            // 只声明 overflow-y-auto 时，浏览器会把 overflow-x 计算为 auto；
            // hover 山峰横向放大后便可能触发横向滚动条，因此 rail 必须只开放纵向滚动。
            className="!scrollbar-hide pointer-events-auto absolute left-3 top-1/2 max-h-[calc(100%-6rem)] w-9 -translate-y-1/2 overflow-x-hidden overflow-y-auto py-1"
            onPointerLeave={() => setInteractionItemIndex(undefined)}
            onScroll={() => setInteractionItemIndex(undefined)}
          >
            <div className="relative w-9" style={{ height: `${railVirtualizer.getTotalSize()}px` }}>
              {virtualRows.map((virtualRow) => {
                const itemIndex = virtualRow.index;
                const item = items[itemIndex];
                if (!item) return null;
                const active = itemIndex === activeItemIndex;
                const visualState = resolveConversationTurnNavigatorBarVisualState({
                  itemIndex,
                  visualFocusItemIndex,
                });
                const showScrollActiveColor = visualFocusItemIndex === undefined && active;
                return (
                  <div
                    key={item.key}
                    className="absolute left-0 top-0 h-2.5 w-9"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <HoverCard closeDelay={80} openDelay={120}>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          aria-current={active ? "location" : undefined}
                          aria-label={intl.formatMessage(
                            { id: "chat.turnNavigator.jumpToQuery" },
                            { index: String(itemIndex + 1) },
                          )}
                          aria-posinset={itemIndex + 1}
                          aria-setsize={items.length}
                          data-testid={testId(TID_V4_TURN_NAVIGATOR_ITEM, item.key)}
                          data-item-index={itemIndex}
                          data-unit-index={item.unitIndex}
                          data-turn-id={item.turnId}
                          data-query-row-id={item.rowId}
                          data-active={active ? "true" : "false"}
                          data-running={item.isRunning ? "true" : "false"}
                          data-visual-color-tone={visualState.colorTone}
                          data-visual-scale={String(visualState.scaleX)}
                          data-visual-tone={visualState.tone}
                          onBlur={() => setInteractionItemIndex(undefined)}
                          onClick={() =>
                            onJumpToQuery(
                              { unitIndex: item.unitIndex, rowId: item.rowId },
                              prefersReducedMotion ? "auto" : "smooth",
                            )
                          }
                          onFocus={() => setInteractionItemIndex(itemIndex)}
                          onPointerEnter={() => setInteractionItemIndex(itemIndex)}
                          onPointerLeave={() => setInteractionItemIndex(undefined)}
                          className="flex h-2.5 w-9 items-center justify-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          <span
                            className={cn(
                              "block h-0.5 w-3 origin-left rounded-full transition-[height,opacity,transform,background-color] duration-150 ease-out motion-reduce:transition-none",
                              visualState.colorTone === "focus" && "bg-foreground",
                              visualState.colorTone === "muted" &&
                                (showScrollActiveColor
                                  ? "bg-foreground"
                                  : "bg-foreground-subtlest"),
                            )}
                            style={{
                              opacity: showScrollActiveColor
                                ? 0.9
                                : item.isRunning
                                  ? Math.max(visualState.opacity, 0.72)
                                  : visualState.opacity,
                              transform: `scaleX(${visualState.scaleX})`,
                            }}
                          />
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent
                        align="start"
                        side="right"
                        sideOffset={8}
                        data-testid={testId(TID_V4_TURN_NAVIGATOR_TOOLTIP, item.key)}
                        className="w-80 max-w-[calc(100vw-2rem)] border border-popover-border bg-popover p-3 text-popover-foreground shadow-lg"
                      >
                        <div className="space-y-2">
                          <p className="line-clamp-2 whitespace-pre-line text-ui-base font-medium leading-5">
                            {item.userPreview}
                          </p>
                          <p
                            className={cn(
                              "line-clamp-3 whitespace-pre-line text-ui-base leading-5",
                              item.assistantPreviewKind === "text"
                                ? "text-popover-foreground/80"
                                : "text-foreground-subtle",
                            )}
                          >
                            {item.assistantPreview}
                          </p>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  </div>
                );
              })}
            </div>
          </div>
        </nav>
      )}
    </>
  );
}

export const ConversationTurnNavigator = memo(ConversationTurnNavigatorImpl);
