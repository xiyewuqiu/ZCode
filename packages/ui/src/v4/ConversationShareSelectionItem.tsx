import { memo } from "react";
import { cn } from "@/components/lib/utils.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import type { ConversationTurnNavigatorItem } from "@/v4/conversationTurnNavigatorHelpers.js";

export const ConversationShareSelectionItem = memo(function ConversationShareSelectionItem({
  item,
  index,
  count,
  offset,
  selected,
  tabIndex,
  onToggle,
  onInspect,
  onFocus,
}: {
  item: ConversationTurnNavigatorItem;
  index: number;
  count: number;
  offset: number;
  selected: boolean;
  tabIndex: number;
  onToggle: (rowId: number) => void;
  onInspect: (target: { unitIndex: number; rowId: number }) => void;
  onFocus: (key: string) => void;
}) {
  return (
    <div
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={count}
      data-candidate-index={index}
      data-conversation-share-selection-item="true"
      data-conversation-share-selection-state={selected ? "selected" : "unselected"}
      className={cn(
        "absolute left-2 right-2 top-0 flex h-14 items-center gap-2 rounded-lg px-1 py-2 transition-colors hover:bg-menu-hover motion-reduce:transition-none",
        selected && "bg-selected",
      )}
      style={{ transform: `translateY(${offset}px)` }}
      onFocus={() => onFocus(item.key)}
    >
      <div className="relative flex size-6 shrink-0 items-center justify-center">
        <label
          data-conversation-share-checkbox-hit-area="true"
          className="absolute flex size-8 cursor-pointer items-center justify-center"
        >
          <Checkbox
            checked={selected}
            disabled={item.isRunning}
            tabIndex={-1}
            aria-label={item.userPreview}
            onCheckedChange={() => {
              if (!item.isRunning) onToggle(item.rowId);
            }}
            checkIconStrokeWidth={1.33}
            className="size-3.5 border-foreground bg-transparent data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
          />
        </label>
      </div>
      <button
        type="button"
        data-candidate-focus={item.key}
        disabled={item.isRunning}
        tabIndex={tabIndex}
        aria-label={item.userPreview}
        onClick={() => onInspect({ unitIndex: item.unitIndex, rowId: item.rowId })}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
      >
        <span
          className={cn(
            "block w-full truncate text-ui-base font-medium leading-5",
            item.isRunning ? "text-foreground-subtlest" : "text-foreground",
          )}
        >
          {item.userPreview}
        </span>
        <span
          className={cn(
            "block w-full truncate text-ui-sm leading-4",
            item.isRunning ? "text-foreground-subtlest" : "text-foreground-subtle",
          )}
        >
          {item.assistantPreview}
        </span>
      </button>
    </div>
  );
});
