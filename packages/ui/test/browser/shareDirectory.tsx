import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationShareSelectionPanel } from "../../src/v4/ConversationShareSelectionPanel.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import type { ConversationTurnNavigatorItem } from "../../src/v4/conversationTurnNavigatorHelpers.js";
import "../../src/styles.css";

function Fixture() {
  const [items, setItems] = useState<ConversationTurnNavigatorItem[]>(() =>
    Array.from({ length: 2000 }, (_, index) => ({
      key: `query-${index}`,
      turnId: `turn-${index}`,
      unitIndex: index,
      rowId: index,
      userText: `Question ${index} — 项目界面优化`,
      userPreview: `Question ${index} — 项目界面优化`,
      assistantPreview: `Answer ${index} with a preview`,
      assistantPreviewKind: "text",
      isRunning: index === 1999,
    })),
  );
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [inspected, setInspected] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const toggle = useCallback(
    (rowId: number) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      }),
    [],
  );
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground text-ui-base">
      <div className="flex h-16 shrink-0 flex-wrap gap-4 p-2">
        <button data-testid="narrow" onClick={() => setNarrow(!narrow)}>
          Narrow pane
        </button>
        <button data-testid="visibility" onClick={() => setVisible(!visible)}>
          Toggle panel
        </button>
        <button
          data-testid="finish"
          onClick={() =>
            setItems((current) =>
              current.map((item) => (item.rowId === 1999 ? { ...item, isRunning: false } : item)),
            )
          }
        >
          Finish
        </button>
        <output data-testid="selected">{[...selected].sort((a, b) => a - b).join(",")}</output>
        <output data-testid="inspected">{inspected}</output>
      </div>
      <div
        data-testid="share-container"
        className="relative min-h-0 flex-1"
        style={{ width: narrow ? 260 : "100%" }}
      >
        <ConversationShareSelectionPanel
          visible={visible}
          items={items}
          selectedRowIds={selected}
          onToggle={toggle}
          onInspect={(target) => setInspected(target.rowId)}
        />
      </div>
    </main>
  );
}

document.documentElement.className = "theme-zai-light";
const root = createRoot(document.getElementById("root")!);
root.render(
  <ZCodeIntlProvider initialLocale="en-US">
    <Fixture />
  </ZCodeIntlProvider>,
);
import.meta.hot?.dispose(() => root.unmount());
