// Side Pane 完整视图的对话宿主（spec：specs/conversation/side-pane-full-view.md）。
// 它包住 conversation-column 里唯一的 SessionPane 实例，只改变定位方式，不移动 DOM、不重挂载：
// - normal：静态布局，与原三栏一致；
// - conversation：fixed 铺满面板内容区（slot），对话全宽；
// - floating：fixed 浮在 slot 右下角，收起态只露出底部输入区。
// 几何值是 DOM 布局投影，直接写到宿主 style，不进入 React state，避免每次测量重渲染对话树。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import {
  TID_SIDE_PANE_FULL_VIEW_CLOSE,
  TID_SIDE_PANE_FULL_VIEW_EXPAND,
  TID_SIDE_PANE_FULL_VIEW_HEADER,
  TID_SIDE_PANE_FULL_VIEW_HOST,
} from "@ycode/shared";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import {
  FLOATING_FALLBACK_DOCK_HEIGHT_PX,
  resolveFloatingFrame,
  type FloatingRect,
} from "@/side-pane-full-view/model.js";
import type {
  ConversationPanePresentationValue,
  SidePaneFullViewFloating,
  SidePaneFullViewHostMode,
} from "@/side-pane-full-view/contract.js";
import { ConversationPanePresentationContext } from "@/side-pane-full-view/conversationPanePresentation.js";

const GEOMETRY_PROPERTIES = ["left", "top", "width", "height"] as const;
const GEOMETRY_VARIABLES = [
  "--side-pane-full-view-content-height",
  "--side-pane-full-view-clip-height",
] as const;

function readSlotRect(slot: HTMLElement): FloatingRect {
  const rect = slot.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function SidePaneFullViewConversationHost({
  mode,
  floating,
  slotElement,
  onFloatingChange,
  onExit,
  children,
}: {
  mode: SidePaneFullViewHostMode;
  floating: SidePaneFullViewFloating;
  slotElement: HTMLElement | null;
  onFloatingChange: (floating: SidePaneFullViewFloating) => void;
  onExit: () => void;
  children: ReactNode;
}) {
  const { intl } = useYCodeIntl();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const isFloating = mode === "floating";
  const isExpanded = isFloating && floating === "expanded";
  const [focusWithin, setFocusWithin] = useState(false);
  const headerVisible = isFloating && (isExpanded || focusWithin);
  const dockHeightRef = useRef(FLOATING_FALLBACK_DOCK_HEIGHT_PX);
  const applyGeometryRef = useRef<() => void>(() => {});
  /** 形态切换前记录时间线滚动位置；布局裁剪后显式恢复，避免浏览器钳制丢失阅读位置。 */
  const scrollPositionsRef = useRef(new Map<HTMLElement, number>());

  const reportComposerDockHeight = useCallback((heightPx: number) => {
    if (dockHeightRef.current === heightPx) return;
    dockHeightRef.current = heightPx;
    applyGeometryRef.current();
  }, []);

  const presentationValue = useMemo<ConversationPanePresentationValue>(
    () => ({
      presentation: isFloating ? "floating" : "docked",
      reportComposerDockHeight,
    }),
    [isFloating, reportComposerDockHeight],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (mode === "normal" || !slotElement) {
      for (const property of GEOMETRY_PROPERTIES) host.style.removeProperty(property);
      for (const variable of GEOMETRY_VARIABLES) host.style.removeProperty(variable);
      applyGeometryRef.current = () => {};
      return;
    }
    const apply = () => {
      const slot = readSlotRect(slotElement);
      if (mode === "conversation") {
        host.style.left = `${slot.left}px`;
        host.style.top = `${slot.top}px`;
        host.style.width = `${slot.width}px`;
        host.style.height = `${slot.height}px`;
        host.style.setProperty("--side-pane-full-view-content-height", `${slot.height}px`);
        host.style.setProperty("--side-pane-full-view-clip-height", `${slot.height}px`);
        return;
      }
      const frame = resolveFloatingFrame({
        slot,
        expanded: isExpanded,
        headerVisible,
        dockHeightPx: dockHeightRef.current,
      });
      host.style.left = `${frame.left}px`;
      host.style.top = `${frame.top}px`;
      host.style.width = `${frame.width}px`;
      host.style.height = `${frame.height}px`;
      host.style.setProperty("--side-pane-full-view-content-height", `${frame.contentHeight}px`);
      host.style.setProperty("--side-pane-full-view-clip-height", `${frame.clipHeight}px`);
    };
    applyGeometryRef.current = apply;
    apply();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    resizeObserver?.observe(slotElement);
    window.addEventListener("resize", apply);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [headerVisible, isExpanded, mode, slotElement]);

  // 布局变化可能让浏览器把 scrollTop 钳到新高度内；下一帧恢复原值，保持阅读位置。
  useLayoutEffect(() => {
    if (mode === "normal") return;
    const frameId = window.requestAnimationFrame(() => {
      for (const [element, top] of scrollPositionsRef.current) {
        if (!element.isConnected) {
          scrollPositionsRef.current.delete(element);
          continue;
        }
        if (Math.abs(element.scrollTop - top) > 1) element.scrollTop = top;
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [mode]);

  // 浮窗形态下观测底部输入区实际高度；浮窗收起态按它裁剪。
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isFloating) return;
    const dock = host.querySelector<HTMLElement>("[data-v4-composer-dock]");
    if (!dock) return;
    const sync = () => reportComposerDockHeight(dock.getBoundingClientRect().height);
    sync();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    resizeObserver?.observe(dock);
    return () => resizeObserver?.disconnect();
  }, [isFloating, reportComposerDockHeight]);

  // 原生 capture 才能收到后代滚动容器的 scroll（scroll 不冒泡，React 合成事件到不了祖先）。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.hasAttribute("data-v4-timeline-scroll")) return;
      scrollPositionsRef.current.set(target, target.scrollTop);
    };
    host.addEventListener("scroll", handleScroll, true);
    return () => host.removeEventListener("scroll", handleScroll, true);
  }, []);

  const handleFocusCapture = useCallback(() => setFocusWithin(true), []);
  const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setFocusWithin(false);
  }, []);
  const handleToggleExpanded = useCallback(() => {
    for (const element of hostRef.current?.querySelectorAll<HTMLElement>(
      "[data-v4-timeline-scroll]",
    ) ?? []) {
      scrollPositionsRef.current.set(element, element.scrollTop);
    }
    onFloatingChange(isExpanded ? "collapsed" : "expanded");
  }, [isExpanded, onFloatingChange]);

  const expandLabel = intl.formatMessage({
    id: isExpanded ? "sidePane.fullView.collapseMessages" : "sidePane.fullView.expandMessages",
  });
  const closeLabel = intl.formatMessage({ id: "sidePane.fullView.close" });
  const ExpandIcon = isExpanded ? ChevronDownIcon : ChevronUpIcon;

  return (
    <div
      ref={hostRef}
      data-testid={TID_SIDE_PANE_FULL_VIEW_HOST}
      role={isFloating ? "region" : undefined}
      aria-label={
        isFloating ? intl.formatMessage({ id: "sidePane.fullView.conversationRegion" }) : undefined
      }
      data-side-pane-full-view-host={mode}
      data-floating={isFloating ? floating : undefined}
      data-header-visible={headerVisible ? "true" : "false"}
      onFocusCapture={isFloating ? handleFocusCapture : undefined}
      onBlurCapture={isFloating ? handleBlurCapture : undefined}
      className={cn(
        mode === "normal" && "relative h-full w-full",
        mode === "conversation" && "fixed z-30 flex flex-col bg-background",
        isFloating &&
          "fixed z-30 flex flex-col transition-[left,top,width,height] duration-150 ease-out motion-reduce:transition-none",
      )}
    >
      <ConversationPanePresentationContext.Provider value={presentationValue}>
        {isFloating && headerVisible ? (
          <div
            data-testid={TID_SIDE_PANE_FULL_VIEW_HEADER}
            data-expanded={isExpanded ? "true" : "false"}
            className="flex h-10 shrink-0 items-center gap-1 rounded-t-2xl border border-b-0 border-border bg-background px-2"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-testid={TID_SIDE_PANE_FULL_VIEW_EXPAND}
              aria-label={expandLabel}
              aria-expanded={isExpanded}
              title={expandLabel}
              onClick={handleToggleExpanded}
            >
              <ExpandIcon className="size-4" />
            </Button>
            <div className="min-w-0 flex-1" />
            <ControlHintTooltip title={closeLabel} side="top" align="end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid={TID_SIDE_PANE_FULL_VIEW_CLOSE}
                aria-label={closeLabel}
                onClick={onExit}
              >
                <XIcon className="size-4" />
              </Button>
            </ControlHintTooltip>
          </div>
        ) : null}
        {isFloating ? (
          <div
            className={cn(
              "relative min-h-0 flex-1 overflow-hidden",
              headerVisible
                ? "rounded-b-2xl border border-t-0 border-border bg-background"
                : "rounded-2xl shadow-lg",
            )}
            style={{ height: "var(--side-pane-full-view-clip-height)" }}
          >
            <div
              className="absolute inset-x-0 bottom-0"
              style={{ height: "var(--side-pane-full-view-content-height)" }}
            >
              {children}
            </div>
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 flex-col">
            <div className="h-full min-h-0 flex-1">{children}</div>
          </div>
        )}
      </ConversationPanePresentationContext.Provider>
    </div>
  );
}
