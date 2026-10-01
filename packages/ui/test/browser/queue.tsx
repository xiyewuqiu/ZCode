import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";
import { ConversationQueuePanel } from "../../src/v4/ConversationQueuePanel.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../src/i18n/IntlProvider.js";
import {
  runQueueCommandWithFeedback,
  queueCommandFailureMessage,
  type QueueFeedbackCommand,
} from "../../src/v4/queueCommandFeedback.js";
import { toast } from "../../src/components/ui/toast.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const initial: QueueState["items"] = ["a", "b", "c"].map((id, index) => ({
  queueItemId: id,
  sourceCommandId: id,
  clientId: "fixture",
  kind: "sendText",
  text: ["分析代码", "实现功能", "验证结果"][index]!,
  attachments: [],
  dispatch: { state: params.has("locked") && index === 0 ? "reserved" : "queued" },
  delivery: { requested: "queue", admitted: "queue" },
  order: { admissionSeq: index },
  steer: { state: "notRequested" },
  admittedAt: index,
}));

function QueueFixture() {
  const { intl } = useZCodeIntl();
  const [items, setItems] = useState(initial);
  const [moves, setMoves] = useState(0);
  const failureMode = params.get("failure");
  const execute = (type: QueueFeedbackCommand) =>
    runQueueCommandWithFeedback({
      send: async () => {
        if (failureMode === "network") throw new Error("synthetic transport failure");
        return { commandId: "fixture", status: "stale", revisionAtDecision: 1 };
      },
      isCurrent: () => !params.has("staleScope"),
      report: (failure, visible) => {
        if (visible)
          toast(intl.formatMessage({ id: queueCommandFailureMessage(type, failure) }), {
            variant: "warning",
            durationMs: 5000,
          });
      },
    });
  const move = (id: string, before: string | null) => {
    setMoves((count) => count + 1);
    // 模拟命令回传的权威队列；此场景不连接真实 Agent，不测试 admission。
    setItems((current) => {
      const item = current.find((entry) => entry.queueItemId === id)!;
      const next = current.filter((entry) => entry !== item);
      next.splice(
        before === null ? next.length : next.findIndex((entry) => entry.queueItemId === before),
        0,
        item,
      );
      return next;
    });
  };
  return (
    <TooltipProvider>
      <div data-fixture-surface className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-2xl p-4 pt-12">
          <h1 className="mb-3 text-ui-lg">Agent task queue</h1>
          <ConversationQueuePanel
            queue={{ items, autoDrain: !failureMode }}
            onMoveItem={
              params.has("readonly")
                ? undefined
                : failureMode
                  ? () => {
                      void execute("reorderQueueItem");
                    }
                  : move
            }
            pendingEditQueueItemId={params.has("editing") ? "a" : null}
            onSendNow={() => {
              if (failureMode) void execute("sendQueuedNow");
            }}
            onDeleteItem={() => {
              if (failureMode) void execute("deleteQueueItem");
            }}
            onEditItem={() => {}}
            onResume={
              failureMode
                ? async () => {
                    await execute("setAutoDrain");
                  }
                : undefined
            }
          />
          <output className="mt-12 block text-ui-base" data-testid="order">
            {items.map((item) => item.queueItemId).join(",")} / moves:{moves}
          </output>
        </main>
      </div>
    </TooltipProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
    <QueueFixture />
  </ZCodeIntlProvider>,
);
import.meta.hot?.dispose(() => root.unmount());
