import { memo } from "react";
import type { ZCodeSessionEndedSubagent } from "@zcode/shared";
import type { RunningSubagentSummary } from "@zcode/shared/zcode-protocol-v4";
import {
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  PauseCircleIcon,
} from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";

export type SubagentDirectoryItem = RunningSubagentSummary | ZCodeSessionEndedSubagent;

const STATUS_ICONS = {
  running: LoaderCircleIcon,
  waiting: PauseCircleIcon,
  blocked: PauseCircleIcon,
  success: CheckCircle2Icon,
  failed: CircleAlertIcon,
  cancelled: BanIcon,
  lost: CircleDashedIcon,
};
const STATUS_COLORS = {
  running: "text-warning",
  waiting: "text-interaction-confirmation-foreground",
  blocked: "text-interaction-confirmation-foreground",
  success: "text-success",
  failed: "text-destructive",
  cancelled: "text-foreground-subtlest",
  lost: "text-foreground-subtlest",
};

export const SubagentDirectoryRow = memo(function SubagentDirectoryRow({
  item,
  tabIndex,
  onOpen,
}: {
  item: SubagentDirectoryItem;
  tabIndex: number;
  onOpen: (item: SubagentDirectoryItem) => void;
}) {
  const { intl } = useZCodeIntl();
  const timestamp = "endedAt" in item ? item.endedAt : item.startedAt;
  const Icon = STATUS_ICONS[item.status];
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      data-subagent-id={item.childSessionId}
      className="flex h-full w-full min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 text-left text-ui-base transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-input-border-focused motion-reduce:transition-none"
      onClick={() => onOpen(item)}
    >
      <span className={`mt-0.5 shrink-0 ${STATUS_COLORS[item.status]}`}>
        <Icon
          aria-hidden
          className={`size-4 ${item.status === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground" title={item.title}>
          {item.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-ui-sm text-foreground-subtlest">
          <span className={`shrink-0 ${STATUS_COLORS[item.status]}`}>
            {intl.formatMessage({ id: `subagentDirectory.status.${item.status}` })}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground-subtle" title={item.summary}>
            {item.summary || item.subagentType}
          </span>
          {timestamp ? (
            <span className="shrink-0 tabular-nums">{formatTaskRelativeTime(timestamp, intl)}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
});
