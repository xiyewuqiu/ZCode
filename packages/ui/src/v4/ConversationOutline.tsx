import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { ListIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion.js";
import { logger } from "@/logger.js";
import {
  filterConversationOutlineItems,
  resolveConversationOutlineSelection,
} from "@/v4/conversationOutlineModel.js";
import type {
  ConversationTurnNavigatorHydrationResult,
  ConversationTurnNavigatorItem,
} from "@/v4/conversationTurnNavigatorHelpers.js";

interface ConversationOutlineProps {
  items: readonly ConversationTurnNavigatorItem[];
  currentKey?: string;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadAllOlder?: () => Promise<ConversationTurnNavigatorHydrationResult>;
  onJumpToQuery: (target: { unitIndex: number; rowId: number }, behavior: ScrollBehavior) => void;
}

export function ConversationOutline(props: ConversationOutlineProps) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex shrink-0 items-center justify-end px-3 py-1">
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            data-testid="conversation-outline-open"
            className="max-w-full text-foreground-subtle max-md:min-h-10"
          >
            <ListIcon aria-hidden="true" />
            <span className="truncate">{intl.formatMessage({ id: "chat.outline.title" })}</span>
            <span className="text-ui-xs tabular-nums">{props.items.length}</span>
          </Button>
        </DialogTrigger>
      </div>
      {open && <ConversationOutlineContent {...props} onClose={() => setOpen(false)} />}
    </Dialog>
  );
}

function ConversationOutlineContent({
  items,
  currentKey,
  canLoadOlder,
  loadingOlder,
  onLoadAllOlder,
  onJumpToQuery,
  onClose,
}: ConversationOutlineProps & { onClose: () => void }) {
  const { intl } = useZCodeIntl();
  const reducedMotion = usePrefersReducedMotion();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setScrollElement(element);
  }, []);
  const aliveRef = useRef(true);
  const requestRef = useRef(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedKey, setSelectedKey] = useState<string | null>(currentKey ?? null);
  const [loadState, setLoadState] = useState<"idle" | "pending" | "failed" | "no-more-queries">(
    "idle",
  );
  const filtered = useMemo(
    () => filterConversationOutlineItems(items, deferredQuery),
    [items, deferredQuery],
  );
  const selectedIndex = resolveConversationOutlineSelection(filtered, selectedKey, currentKey);
  const selected = filtered[selectedIndex];
  const ordinals = useMemo(
    () => new Map(items.map((item, index) => [item.key, index + 1])),
    [items],
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    // Dialog Portal 延后挂载，必须在节点就绪后重连虚拟滚动观察，不能只读初始 null ref。
    getScrollElement: useCallback(() => scrollElement, [scrollElement]),
    getItemKey: useCallback((index: number) => filtered[index]!.key, [filtered]),
    estimateSize: () => 88,
    overscan: 4,
    rangeExtractor: useCallback(
      (range) => {
        const indices = new Set(defaultRangeExtractor(range));
        if (selectedIndex >= 0) indices.add(selectedIndex);
        return [...indices].sort((a, b) => a - b);
      },
      [selectedIndex],
    ),
  });
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, deferredQuery, scrollElement, virtualizer]);
  const jump = (item: ConversationTurnNavigatorItem) => {
    onJumpToQuery(item, reducedMotion ? "auto" : "smooth");
    onClose();
  };
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || query !== deferredQuery) return;
    let next: number;
    if (event.key === "Enter") {
      if (selected) {
        event.preventDefault();
        jump(selected);
      }
      return;
    }
    if (event.key === "Home" && (event.ctrlKey || event.metaKey)) next = 0;
    else if (event.key === "End" && (event.ctrlKey || event.metaKey)) next = filtered.length - 1;
    else if (event.ctrlKey || event.metaKey) return;
    else if (event.key === "ArrowDown") next = selectedIndex + 1;
    else if (event.key === "ArrowUp") next = selectedIndex - 1;
    else if (event.key === "PageDown")
      next = selectedIndex + Math.max(1, Math.floor((listRef.current?.clientHeight ?? 352) / 88));
    else if (event.key === "PageUp")
      next = selectedIndex - Math.max(1, Math.floor((listRef.current?.clientHeight ?? 352) / 88));
    else return;
    event.preventDefault();
    const item = filtered[Math.max(0, Math.min(filtered.length - 1, next))];
    if (item) setSelectedKey(item.key);
  };
  const load = async () => {
    if (!onLoadAllOlder || requestRef.current || loadingOlder) return;
    requestRef.current = true;
    setLoadState("pending");
    try {
      const result = await onLoadAllOlder();
      if (aliveRef.current)
        setLoadState(
          result.status === "not-enough-queries"
            ? "no-more-queries"
            : result.status === "hydrated"
              ? "idle"
              : "failed",
        );
    } catch (error) {
      logger.warn("[conversation-outline] 加载目录失败", { error: String(error) });
      if (aliveRef.current) setLoadState("failed");
    } finally {
      requestRef.current = false;
    }
  };

  return (
    <DialogContent
      showCloseButton={false}
      data-testid="conversation-outline"
      overlayClassName="motion-reduce:!animate-none"
      className="flex max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100%-2rem))] flex-col gap-3 rounded-xl motion-reduce:!animate-none"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <DialogTitle>{intl.formatMessage({ id: "chat.outline.title" })}</DialogTitle>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={intl.formatMessage({ id: "chat.outline.close" })}
          >
            <XIcon />
          </Button>
        </DialogClose>
      </div>
      <DialogDescription className="text-ui-sm">
        {intl.formatMessage({ id: "chat.outline.description" })}
      </DialogDescription>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={selected ? `${listId}-${selected.rowId}` : undefined}
          aria-label={intl.formatMessage({ id: "chat.outline.search" })}
          placeholder={intl.formatMessage({ id: "chat.outline.search" })}
          className="h-10 pl-9 max-md:text-mobile-input-safe"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedKey(null);
          }}
          onKeyDown={handleKey}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
        <span role="status">
          {intl.formatMessage(
            { id: "chat.outline.count" },
            { count: filtered.length, total: items.length },
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!items.length}
          onClick={() => {
            const item = items.at(-1);
            if (item) jump(item);
          }}
        >
          {intl.formatMessage({ id: "chat.outline.latest" })}
        </Button>
      </div>
      <div
        ref={attachList}
        id={listId}
        role="listbox"
        aria-label={intl.formatMessage({ id: "chat.outline.title" })}
        aria-busy={query !== deferredQuery}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ height: "min(352px, 45dvh)", flexBasis: "min(352px, 45dvh)" }}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = filtered[row.index]!;
            return (
              <button
                key={item.key}
                id={`${listId}-${item.rowId}`}
                type="button"
                role="option"
                aria-selected={selected?.key === item.key}
                aria-posinset={row.index + 1}
                aria-setsize={filtered.length}
                tabIndex={-1}
                data-outline-row={item.rowId}
                className={cn(
                  "absolute left-0 top-0 flex h-[88px] w-full min-w-0 flex-col gap-1 rounded-lg px-3 py-2 text-left hover:bg-hover",
                  selected?.key === item.key && "bg-selected",
                )}
                style={{ transform: `translateY(${row.start}px)` }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => jump(item)}
              >
                <span className="flex w-full items-center gap-2 text-ui-xs text-foreground-subtle">
                  <span>#{ordinals.get(item.key)}</span>
                  {item.key === currentKey && (
                    <span>{intl.formatMessage({ id: "chat.outline.current" })}</span>
                  )}
                  {item.isRunning && (
                    <span>{intl.formatMessage({ id: "chat.turnNavigator.runningAssistant" })}</span>
                  )}
                </span>
                <span className="w-full truncate text-ui-base font-medium">{item.userPreview}</span>
                <span className="w-full truncate text-ui-sm text-foreground-subtle">
                  {item.assistantPreview}
                </span>
              </button>
            );
          })}
        </div>
        {!filtered.length && (
          <p className="p-6 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "chat.outline.empty" })}
          </p>
        )}
      </div>
      {loadState === "failed" && (
        <p role="alert" className="text-ui-sm text-destructive">
          {intl.formatMessage({ id: "chat.outline.loadFailed" })}
        </p>
      )}
      {loadState === "no-more-queries" && (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "chat.outline.noMore" })}
        </p>
      )}
      {canLoadOlder && loadState !== "no-more-queries" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "chat.outline.partial" })}
          </span>
          {onLoadAllOlder && (
            <Button
              variant="outline"
              disabled={loadingOlder || loadState === "pending"}
              onClick={() => void load()}
            >
              {intl.formatMessage({
                id:
                  loadingOlder || loadState === "pending"
                    ? "chat.history.loadingOlderMessages"
                    : "chat.outline.loadAll",
              })}
            </Button>
          )}
        </div>
      )}
    </DialogContent>
  );
}
