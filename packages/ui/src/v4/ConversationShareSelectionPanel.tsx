import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ConversationShareSelectionItem } from "@/v4/ConversationShareSelectionItem.js";
import { resolveConversationShareSelectionPanelMotion } from "@/v4/conversationShareModeMotion.js";
import {
  CONVERSATION_SHARE_SELECTION_PANEL_CENTER_Y_PROPERTY,
  CONVERSATION_SHARE_SELECTION_PANEL_MAX_HEIGHT_PROPERTY,
} from "@/v4/conversationShareSelectionPanelLayout.js";
import type { ConversationTurnNavigatorItem } from "@/v4/conversationTurnNavigatorHelpers.js";
import { useConversationShareScrollbar } from "@/v4/useConversationShareScrollbar.js";

interface ConversationShareSelectionPanelProps {
  visible: boolean;
  items: readonly ConversationTurnNavigatorItem[];
  selectedRowIds: ReadonlySet<number>;
  onToggle: (rowId: number) => void;
  onInspect: (target: { unitIndex: number; rowId: number }) => void;
}
const ROW_HEIGHT = 56;

function focusMountedCandidate(shell: HTMLDivElement | null, key: string) {
  const target = shell?.querySelector<HTMLButtonElement>(
    `[data-candidate-focus="${CSS.escape(key)}"]`,
  );
  if (!target || target.disabled) return false;
  target.focus({ preventScroll: true });
  return true;
}

function SelectionPanelContent({
  items,
  selectedRowIds,
  onToggle,
  onInspect,
}: Omit<ConversationShareSelectionPanelProps, "visible">) {
  const { intl, locale } = useZCodeIntl();
  const reducedMotion = usePrefersReducedMotion();
  const motionConfig = resolveConversationShareSelectionPanelMotion(reducedMotion);
  const [query, setQuery] = useState("");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? items.filter((item) =>
            `${item.userPreview}\n${item.assistantPreview}`
              .toLocaleLowerCase(locale)
              .includes(normalizedQuery),
          )
        : items,
    [locale, items, normalizedQuery],
  );
  const focusedIndex =
    focusedKey === null ? -1 : filtered.findIndex((item) => item.key === focusedKey);
  const tabIndex = focusedIndex >= 0 ? focusedIndex : filtered.findIndex((item) => !item.isRunning);
  const getScrollElement = useCallback(
    () =>
      shellRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null,
    [],
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement,
    getItemKey: useCallback((index: number) => filtered[index]!.key, [filtered]),
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
    // 焦点项在滚出窗口后仍保留一个节点，避免虚拟卸载把键盘焦点丢到 body。
    rangeExtractor: useCallback(
      (range) => {
        const indexes = defaultRangeExtractor(range);
        if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
        return indexes.sort((a, b) => a - b);
      },
      [focusedIndex],
    ),
  });
  const virtualRows = virtualizer.getVirtualItems();
  useConversationShareScrollbar(shellRef, thumbRef);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    if (focusedIndex < 0 || focusMountedCandidate(shellRef.current, pendingFocus.current)) {
      pendingFocus.current = null;
    }
  }, [focusedIndex, focusedKey, virtualRows]);

  const focusFrom = (start: number, step: number) => {
    for (let index = start; index >= 0 && index < filtered.length; index += step) {
      const item = filtered[index]!;
      if (item.isRunning) continue;
      pendingFocus.current = item.key;
      setFocusedKey(item.key);
      virtualizer.scrollToIndex(index, { align: "auto" });
      // 从搜索框再次进入同一个候选时 state 可能不变，不能只等下一次 React commit。
      if (focusMountedCandidate(shellRef.current, item.key)) pendingFocus.current = null;
      break;
    }
  };
  const handleListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-candidate-index]");
    if (!row) return;
    const index = Number(row.dataset.candidateIndex);
    const item = filtered[index];
    if (!item || item.isRunning) return;
    switch (event.key) {
      case "ArrowDown":
        focusFrom(index + 1, 1);
        break;
      case "ArrowUp":
        focusFrom(index - 1, -1);
        break;
      case "Home":
        focusFrom(0, 1);
        break;
      case "End":
        focusFrom(filtered.length - 1, -1);
        break;
      case " ":
        onToggle(item.rowId);
        break;
      case "Enter":
        onInspect({ unitIndex: item.unitIndex, rowId: item.rowId });
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const updateQuery = (next: string) => {
    setQuery(next);
    setFocusedKey(null);
    pendingFocus.current = null;
    virtualizer.scrollToOffset(0);
  };

  return (
    <motion.aside
      aria-label={intl.formatMessage({ id: "conversationShare.partial.panelLabel" })}
      data-testid="conversation-share-selection-panel"
      data-conversation-share-left-navigation="true"
      data-conversation-share-mode-motion="selection-panel"
      data-reduced-motion={reducedMotion}
      className="group/share-selection-panel absolute left-4 z-30 flex w-72 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl bg-popover py-2 text-popover-foreground shadow-md ring-1 ring-inset ring-popover-border max-md:left-2 max-md:max-w-[calc(100%-1rem)]"
      // 虚拟列表的自然高度由数据给出，不再依赖挂载全部候选后读取 scrollHeight。
      style={{
        height: 80 + Math.max(1, filtered.length) * ROW_HEIGHT,
        maxHeight: `var(${CONVERSATION_SHARE_SELECTION_PANEL_MAX_HEIGHT_PROPERTY}, calc(100% - 3rem))`,
        top: `var(${CONVERSATION_SHARE_SELECTION_PANEL_CENTER_Y_PROPERTY}, 50%)`,
      }}
      initial={motionConfig.initial}
      animate={motionConfig.animate}
      exit={motionConfig.exit}
      transition={motionConfig.transition}
    >
      <div className="flex h-16 shrink-0 flex-col gap-1 px-2 pb-2">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-2 size-4 text-foreground-subtlest"
          />
          <Input
            ref={searchRef}
            value={query}
            size="lg"
            className="pl-8 pr-8 max-md:text-mobile-input-safe"
            data-testid="conversation-share-search"
            aria-label={intl.formatMessage({ id: "conversationShare.partial.search" })}
            placeholder={intl.formatMessage({ id: "conversationShare.partial.search" })}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusFrom(
                  event.key === "ArrowDown" ? 0 : filtered.length - 1,
                  event.key === "ArrowDown" ? 1 : -1,
                );
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                updateQuery("");
              }
            }}
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon-md"
              className="absolute right-0 top-0"
              data-testid="conversation-share-search-clear"
              aria-label={intl.formatMessage({ id: "conversationShare.partial.clearSearch" })}
              onClick={() => {
                updateQuery("");
                searchRef.current?.focus();
              }}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <span role="status" aria-live="polite" className="px-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage(
            { id: "conversationShare.partial.resultCount" },
            { visible: filtered.length, total: items.length },
          )}
        </span>
      </div>
      <div ref={shellRef} className="relative min-h-0 flex-1">
        <ScrollArea
          type="always"
          data-testid="conversation-share-selection-scroll-area"
          className="size-full min-h-0 [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!w-full"
          scrollbarClassName="opacity-0 transition-opacity group-hover/share-selection-panel:opacity-100 group-focus-within/share-selection-panel:opacity-100 data-vertical:!w-2.5 data-vertical:!pr-1 data-vertical:!pl-0 [&_[data-slot=scroll-area-thumb]]:!min-w-1.5 [&_[data-slot=scroll-area-thumb]]:!bg-transparent [@media(hover:none)]:opacity-100"
        >
          <div
            role="list"
            onKeyDownCapture={handleListKey}
            className="relative min-w-0"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualRows.map((row) => (
              <ConversationShareSelectionItem
                key={row.key}
                item={filtered[row.index]!}
                index={row.index}
                count={filtered.length}
                offset={row.start}
                selected={selectedRowIds.has(filtered[row.index]!.rowId)}
                tabIndex={row.index === tabIndex ? 0 : -1}
                onToggle={onToggle}
                onInspect={onInspect}
                onFocus={setFocusedKey}
              />
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({
                id: normalizedQuery
                  ? "conversationShare.partial.noResults"
                  : "conversationShare.partial.empty",
              })}
            </p>
          ) : null}
        </ScrollArea>
        <div
          ref={thumbRef}
          aria-hidden="true"
          data-testid="conversation-share-selection-scroll-thumb"
          className="pointer-events-none absolute right-1 top-0 z-10 hidden w-1.5 rounded-full bg-border opacity-0 transition-opacity group-hover/share-selection-panel:opacity-100 group-focus-within/share-selection-panel:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>
    </motion.aside>
  );
}

export const ConversationShareSelectionPanel = memo(function ConversationShareSelectionPanel({
  visible,
  ...props
}: ConversationShareSelectionPanelProps) {
  return (
    <AnimatePresence initial={false}>
      {visible ? <SelectionPanelContent key="selection" {...props} /> : null}
    </AnimatePresence>
  );
});
