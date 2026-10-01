import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  useVirtualizer,
} from "@tanstack/react-virtual";
import type { ConversationAssistantWorkRenderItem } from "@/v4/conversationAssistantWorkItems.js";

// 查找保留的是模型行身份，不是另一份消息状态；作用域随 Timeline 卸载释放。
export const ConversationFindRowContext = createContext<number | undefined>(undefined);

function containsRow(item: ConversationAssistantWorkRenderItem, rowId: number): boolean {
  if (item.kind === "row" || item.kind === "agentToolCall") return item.row.rowId === rowId;
  if (item.kind === "cuaGroup") return item.events.some((event) => event.row.rowId === rowId);
  return item.rows.some((row) => row.rowId === rowId);
}

export function ConversationWorkWindow({
  items,
  renderItem,
}: {
  items: readonly ConversationAssistantWorkRenderItem[];
  renderItem: (item: ConversationAssistantWorkRenderItem) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const notifyOffsetRef = useRef<(() => void) | undefined>(undefined);
  const [retained, setRetained] = useState<string[]>([]);
  const retainedIndices = useMemo(() => {
    if (retained.length === 0) return [];
    const keys = new Set(retained);
    return items.flatMap((item, index) => (keys.has(item.key) ? [index] : []));
  }, [items, retained]);
  const forcedRowId = useContext(ConversationFindRowContext);
  const forcedIndex = useMemo(
    () =>
      forcedRowId === undefined ? -1 : items.findIndex((item) => containsRow(item, forcedRowId)),
    [forcedRowId, items],
  );
  const getScrollElement = useCallback(
    () => listRef.current?.closest<HTMLElement>('[data-v4-timeline-scroll="true"]') ?? null,
    [],
  );
  const origin = useCallback(() => {
    const scroller = getScrollElement();
    const list = listRef.current;
    return scroller && list
      ? scroller.scrollTop + list.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      : 0;
  }, [getScrollElement]);
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: items.length,
    getScrollElement,
    getItemKey: useCallback((index: number) => items[index]!.key, [items]),
    estimateSize: () => 80,
    gap: 16,
    overscan: 6,
    rangeExtractor: useCallback(
      (range) => {
        const indices = new Set(defaultRangeExtractor(range));
        for (const index of retainedIndices) indices.add(index);
        if (forcedIndex >= 0) indices.add(forcedIndex);
        return [...indices].sort((a, b) => a - b);
      },
      [forcedIndex, retainedIndices],
    ),
    // 内层共享外层滚动容器，但测量使用列表局部坐标；不能把整页 offset 当作工作项 offset。
    observeElementOffset: useCallback(
      (instance, callback) => {
        notifyOffsetRef.current = () =>
          callback((instance.scrollElement?.scrollTop ?? 0) - origin(), false);
        const cleanup = observeElementOffset(instance, (offset, scrolling) =>
          callback(offset - origin(), scrolling),
        );
        return () => {
          notifyOffsetRef.current = undefined;
          cleanup?.();
        };
      },
      [origin],
    ),
    scrollToFn: useCallback(
      (offset, options, instance) => elementScroll(offset + origin(), options, instance),
      [origin],
    ),
  });
  useEffect(() => {
    const list = listRef.current;
    const scroller = getScrollElement();
    if (!list || !scroller) return;
    let width = list.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== list.clientWidth) {
        width = list.clientWidth;
        virtualizer.measure();
      }
      notifyOffsetRef.current?.();
    });
    observer.observe(list);
    const column = list.closest("[data-v4-timeline-content-column]");
    if (column) observer.observe(column);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [getScrollElement, virtualizer]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let dragging = false;
    const update = () => {
      const selection = document.getSelection();
      const range =
        selection && !selection.isCollapsed && selection.rangeCount
          ? selection.getRangeAt(0)
          : null;
      const keys: string[] = [];
      for (const row of list.querySelectorAll<HTMLElement>("[data-work-index]")) {
        if (
          dragging ||
          row.contains(document.activeElement) ||
          (range && range.intersectsNode(row))
        )
          keys.push(row.dataset.workKey!);
      }
      // 选择中的 DOM 不能回收，否则浏览器会静默截断 Range；清空选择后立即释放。
      setRetained((previous) =>
        previous.length === keys.length && previous.every((key, i) => key === keys[i])
          ? previous
          : keys,
      );
    };
    const start = () => {
      dragging = true;
      update();
    };
    const end = () => {
      dragging = false;
      update();
    };
    list.addEventListener("pointerdown", start);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    document.addEventListener("selectionchange", update);
    document.addEventListener("focusin", update);
    return () => {
      list.removeEventListener("pointerdown", start);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("focusin", update);
    };
  }, []);

  return (
    <div
      ref={listRef}
      data-work-window="true"
      data-work-count={items.length}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          ref={virtualizer.measureElement}
          data-index={row.index}
          data-work-index={row.index}
          data-work-key={items[row.index]!.key}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${row.start}px)` }}
        >
          {renderItem(items[row.index]!)}
        </div>
      ))}
    </div>
  );
}
