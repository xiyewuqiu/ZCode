import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { ConversationTimeline } from "../../src/v4/ConversationTimeline.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import type { ConversationRowRenderContext } from "../../src/v4/conversationRowContext.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "../../src/lib/codePreviewSettings.js";
import type { ConversationFindMatchState } from "../../src/v4/legacyChatViewTypes.js";
import "../../src/styles.css";

const parameters = new URLSearchParams(location.search);
const turns = Math.min(2000, Math.max(1, Number(parameters.get("turns")) || 100));
const workItems = Math.min(5000, Math.max(1, Number(parameters.get("work")) || 1000));
const context: ConversationRowRenderContext = {
  workspacePath: "/synthetic",
  theme: "light",
  codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
};

function makeRows(): ConversationRow[] {
  const rows: ConversationRow[] = [];
  let rowId = 0;
  for (let t = 0; t < turns; t++) {
    const base = () => ({
      rowId: ++rowId,
      turnId: `turn-${t}`,
      createdAt: t + 1,
      createdAtSeq: rowId,
    });
    const running = t === turns - 1;
    rows.push({
      ...base(),
      kind: "turnHeader",
      origin: "userInput",
      state: running ? "running" : "completedSuccess",
      startedAt: Date.now() - 60_000,
      ...(running ? {} : { activeMs: 1000 }),
    });
    rows.push({
      ...base(),
      kind: "userInput",
      origin: "realUser",
      text: `Question ${t} unique-query-${t}`,
      attachments: [],
    });
    for (let i = 0; i < (running ? workItems : 2); i++) {
      rows.push({
        ...base(),
        kind: "assistantText",
        state: "complete",
        text: `Work ${t}/${i}\n\nA synthetic paragraph with **formatting**, a [reference](https://example.com), and some explanation.\n\n- First observation\n- Second observation`,
      });
      if (i % 25 === 0)
        rows.push({
          ...base(),
          kind: "timelineMarker",
          lane: "assistantWork",
          marker: {
            type: "compact",
            origin: "auto",
            status: "success",
            tokensBefore: 120000,
            tokensAfter: 10000,
          },
        });
    }
    rows.push({
      ...base(),
      kind: "assistantText",
      text: `Answer ${t}`,
      state: running ? "streaming" : "complete",
    });
  }
  return rows;
}

function Fixture() {
  const [rows, setRows] = useState(makeRows);
  const [streaming, setStreaming] = useState(false);
  const [alternateSession, setAlternateSession] = useState(false);
  const [workspaceScope, setWorkspaceScope] = useState(0);
  const scopedContext = useMemo(
    () => ({ ...context, workspaceIdentity: `synthetic-workspace-${workspaceScope}` }),
    [workspaceScope],
  );
  useEffect(() => {
    const changeWorkspace = () => setWorkspaceScope((scope) => scope + 1);
    window.addEventListener("outline-switch-workspace", changeWorkspace);
    return () => window.removeEventListener("outline-switch-workspace", changeWorkspace);
  }, []);
  const alternateRows = useMemo(() => rows.slice(0, 6), [rows]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ConversationFindMatchState>({
    matchCount: 0,
    activeIndex: -1,
  });
  const [sessionPhase, setPhase] = useState<"running" | "completedSuccess">("running");
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(
      () =>
        setRows((current) => {
          const next = current.slice();
          const tail = next.at(-1)!;
          if (tail.kind === "assistantText")
            next[next.length - 1] = { ...tail, text: tail.text + " token" };
          return next;
        }),
      50,
    );
    return () => clearInterval(timer);
  }, [streaming]);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap gap-2 p-2 text-ui-base">
        <button data-testid="switch-session" onClick={() => setAlternateSession(!alternateSession)}>
          {alternateSession ? "Return to long session" : "Switch session"}
        </button>
        <button data-testid="stream" onClick={() => setStreaming(!streaming)}>
          {streaming ? "Stop streaming" : "Start streaming"}
        </button>
        <button
          data-testid="complete"
          onClick={() => {
            setStreaming(false);
            setPhase("completedSuccess");
            setRows((current) =>
              current.map((row): ConversationRow => {
                if (row.turnId !== `turn-${turns - 1}`) return row;
                if (row.kind === "turnHeader") return { ...row, state: "completedSuccess" };
                if (row.kind === "assistantText") return { ...row, state: "complete" };
                return row;
              }),
            );
          }}
        >
          Complete
        </button>
        <input
          aria-label="Find"
          data-testid="find"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <input aria-label="Typing responsiveness" data-testid="typing" />
        <output data-testid="matches">{matches.matchCount}</output>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col @container/conversation">
        <ConversationTimeline
          key={alternateSession ? "alternate" : "synthetic"}
          rows={alternateSession ? alternateRows : rows}
          totalCount={alternateSession ? 6 : rows.length}
          sessionKey={alternateSession ? "alternate" : "synthetic"}
          rowContext={scopedContext}
          sessionPhase={alternateSession ? "completedSuccess" : sessionPhase}
          hideTurnNavigator={!parameters.has("outline")}
          conversationFindQuery={query}
          onConversationFindMatchStateChange={setMatches}
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <ZCodeIntlProvider initialLocale="en-US">
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </ZCodeIntlProvider>,
);

// 测试入口会被 Vite 热替换；销毁旧 root，避免旧计时器和测量 observer 与新页面并存。
import.meta.hot?.dispose(() => root.unmount());
