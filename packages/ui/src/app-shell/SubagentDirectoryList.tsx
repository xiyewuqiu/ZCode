import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { ZCodeSessionEndedSubagent } from "@zcode/shared";
import type { RunningSubagentSummary } from "@zcode/shared/zcode-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SubagentDirectoryRow, type SubagentDirectoryItem } from "./SubagentDirectoryRow.js";

type Entry =
  | { key: string; kind: "item"; item: SubagentDirectoryItem }
  | { key: string; kind: "heading"; label: string; count: number }
  | { key: string; kind: "empty"; label: string };

export const SubagentDirectoryList = memo(function SubagentDirectoryList({
  running,
  ended,
  endedTotal,
  loading,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  onOpen,
}: {
  running: readonly RunningSubagentSummary[];
  ended: readonly ZCodeSessionEndedSubagent[];
  endedTotal: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onOpen: (item: SubagentDirectoryItem) => void;
}) {
  const { intl } = useZCodeIntl();
  const hintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 目录固定为两行，仅观察字体标尺；逐行测量会与插入锚点补偿争用 scrollTop。
  const sizeRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(66);
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);
  const focusRequested = useRef(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const showEndedEmpty = !ended.length && !loading && !error;
  const entries = useMemo(() => {
    const rows: Entry[] = [
      {
        key: "running-heading",
        kind: "heading",
        label: "subagentDirectory.running",
        count: running.length,
      },
    ];
    const runningIds = new Set(running.map((item) => item.childSessionId));
    running.forEach((item) => rows.push({ key: item.childSessionId, kind: "item", item }));
    if (!running.length)
      rows.push({ key: "running-empty", kind: "empty", label: "subagentDirectory.runningEmpty" });
    rows.push({
      key: "ended-heading",
      kind: "heading",
      label: "subagentDirectory.ended",
      count: endedTotal,
    });
    ended.forEach((item) => {
      // 运行态来自实时投影；历史 query 尚未刷新时不能把恢复运行的同一 Agent 重复挂载。
      if (!runningIds.has(item.childSessionId))
        rows.push({ key: item.childSessionId, kind: "item", item });
    });
    if (showEndedEmpty)
      rows.push({ key: "ended-empty", kind: "empty", label: "subagentDirectory.endedEmpty" });
    return rows;
  }, [ended, endedTotal, showEndedEmpty, running]);
  const { itemIndices, indexByKey } = useMemo(() => {
    const itemIndices: number[] = [];
    const indexByKey = new Map<string, number>();
    entries.forEach((entry, index) => {
      indexByKey.set(entry.key, index);
      if (entry.kind === "item") itemIndices.push(index);
    });
    return { itemIndices, indexByKey };
  }, [entries]);
  const focusedIndex =
    (focusedKey ? indexByKey.get(focusedKey) : undefined) ?? itemIndices[0] ?? -1;
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: useCallback((index: number) => entries[index]!.key, [entries]),
    estimateSize: (index) => (entries[index]?.kind === "heading" ? 36 : rowHeight),
    overscan: 5,
    rangeExtractor: useCallback(
      (range) => {
        const indices = new Set(defaultRangeExtractor(range));
        // 虚拟滚动不能回收正在聚焦的按钮，否则键盘焦点会掉到 body。
        if (focusedIndex >= 0) indices.add(focusedIndex);
        return [...indices].sort((a, b) => a - b);
      },
      [focusedIndex],
    ),
  });
  useLayoutEffect(() => {
    const element = sizeRef.current;
    if (!element) return;
    const resize = () => setRowHeight(element.getBoundingClientRect().height);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);
  const captureAnchor = () => {
    const top = scrollRef.current?.scrollTop ?? 0;
    const visible = virtualizer.getVirtualItems().find((row) => row.end > top && row.start <= top);
    anchorRef.current =
      top > 1 && visible ? { key: String(visible.key), offset: top - visible.start } : null;
  };
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const index = anchor ? indexByKey.get(anchor.key) : undefined;
    if (anchor && index !== undefined) {
      // 新完成项插入顶部时，以稳定 session key 恢复阅读位置，不依赖 DOM 自动锚定。
      const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
      if (offset !== undefined) virtualizer.scrollToOffset(offset + anchor.offset);
    }
  }, [indexByKey, rowHeight, virtualizer]);
  useLayoutEffect(() => {
    if (!focusRequested.current || focusedIndex < 0) return;
    focusRequested.current = false;
    virtualizer.scrollToIndex(focusedIndex, { align: "auto" });
    scrollRef.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${focusedIndex}"] button`)
      ?.focus({ preventScroll: true });
  }, [focusedIndex, virtualizer]);
  // 原生滚动先发生时虚拟范围可能还未更新；提交后再记录实际窗口，覆盖大幅跳转的空锚点。
  useLayoutEffect(() => {
    captureAnchor();
  });
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const ordinal = Math.max(0, itemIndices.indexOf(focusedIndex));
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / rowHeight));
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? itemIndices.length - 1
          : event.key === "ArrowDown"
            ? ordinal + 1
            : event.key === "ArrowUp"
              ? ordinal - 1
              : event.key === "PageDown"
                ? ordinal + page
                : event.key === "PageUp"
                  ? ordinal - page
                  : null;
    if (target === null || !itemIndices.length) return;
    event.preventDefault();
    const index = itemIndices[Math.max(0, Math.min(itemIndices.length - 1, target))]!;
    const entry = entries[index]!;
    focusRequested.current = true;
    setFocusedKey(entry.key);
    if (index === focusedIndex) {
      focusRequested.current = false;
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  };

  return (
    <div className="flex size-full min-h-0 flex-col bg-background" data-testid="subagent-directory">
      <div
        ref={sizeRef}
        aria-hidden
        className="pointer-events-none invisible absolute h-[calc(var(--ui-font-size)*3.25+20px)] w-0"
      />
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "subagentDirectory.title" })}
        </h2>
        <p id={hintId} className="sr-only">
          {intl.formatMessage({ id: "subagentDirectory.keyboardHint" })}
        </p>
      </div>
      <div
        ref={scrollRef}
        data-testid="subagent-directory-scroll"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 [overflow-anchor:none]"
        role="region"
        aria-label={intl.formatMessage({ id: "subagentDirectory.title" })}
        aria-describedby={hintId}
        onScroll={captureAnchor}
        onKeyDown={handleKey}
        onFocusCapture={(event) => {
          const id = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-subagent-id]")
            ?.dataset.subagentId;
          if (id) setFocusedKey(id);
        }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const entry = entries[row.index]!;
            return (
              <div
                key={row.key}
                data-index={row.index}
                className="absolute left-0 top-0 w-full"
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              >
                {entry.kind === "item" ? (
                  <SubagentDirectoryRow
                    item={entry.item}
                    tabIndex={row.index === focusedIndex ? 0 : -1}
                    onOpen={onOpen}
                  />
                ) : entry.kind === "heading" ? (
                  <h3 className="flex h-9 items-center gap-2 px-3 text-ui-sm font-medium text-foreground-subtlest">
                    {intl.formatMessage({ id: entry.label })}
                    <span className="tabular-nums">{entry.count}</span>
                  </h3>
                ) : (
                  <p className="px-3 py-3 text-ui-base text-foreground-subtlest">
                    {intl.formatMessage({ id: entry.label })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {(loading || error || hasMore) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
          {error ? (
            <>
              <p role="alert" className="text-ui-sm text-destructive">
                {intl.formatMessage({ id: "subagentDirectory.loadFailed" })}
              </p>
              <Button variant="ghost" size="sm" disabled={loading} onClick={onRetry}>
                {intl.formatMessage({ id: "common.retry" })}
              </Button>
            </>
          ) : (
            <>
              <span role="status" className="text-ui-sm text-foreground-subtlest">
                {loading
                  ? intl.formatMessage({ id: "common.loading" })
                  : intl.formatMessage(
                      { id: "subagentDirectory.loaded" },
                      { count: ended.length, total: endedTotal },
                    )}
              </span>
              {hasMore && (
                <Button variant="ghost" size="sm" disabled={loading} onClick={onLoadMore}>
                  {intl.formatMessage({ id: "subagentDirectory.showMore" })}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});
