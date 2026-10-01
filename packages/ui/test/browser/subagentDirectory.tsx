import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IServiceAccessor } from "@zcode/services";
import type { ZCodeSessionEndedSubagent } from "@zcode/shared";
import type {
  RunningSubagentSummary,
  SubagentProjectionState,
} from "@zcode/shared/zcode-protocol-v4";
import { SubagentDirectoryList } from "../../src/app-shell/SubagentDirectoryList.js";
import type { SubagentDirectoryItem } from "../../src/app-shell/SubagentDirectoryRow.js";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { useSessionSubagents } from "../../src/hooks/useSessionSubagents.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import type { ConversationStoreState } from "../../src/v4/conversationProjectionStore.js";
import type { SessionLease } from "../../src/v4/sessionDataLayer.js";
import { useConversationProjectionSelector } from "../../src/v4/useConversationProjection.js";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const metrics = { renders: 0, emissions: 0, calls: [] as unknown[] };
Object.assign(window, { directoryMetrics: metrics });
const initialEnded: ZCodeSessionEndedSubagent[] = Array.from({ length: 5000 }, (_, index) => ({
  childSessionId: `ended-${index}`,
  subagentType: "research",
  title: `Agent ${index} · 历史子智能体性能分析`,
  summary: "结果摘要与长文本 ".repeat(12),
  status: index % 5 === 0 ? "failed" : "success",
  endedAt: Date.now() - index * 60000,
}));
const running: RunningSubagentSummary[] = Array.from({ length: 100 }, (_, index) => ({
  childSessionId: `running-${index}`,
  subagentType: "research",
  title: `Running ${index} · 并行派遣任务`,
  summary: "正在分析界面性能",
  status: index % 3 === 0 ? "waiting" : "running",
}));
const emptyRunning: RunningSubagentSummary[] = [];
let state = {
  snapshot: { subagents: { revision: 1, running, childSessionIds: [], endedTotal: 5000 } },
} as ConversationStoreState;
const listeners = new Set<() => void>();
const lease = {
  store: {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
} as unknown as SessionLease;
const selector = (value: ConversationStoreState) => value.snapshot!.subagents!;
const emit = (subagents?: SubagentProjectionState) => {
  state = { ...state, snapshot: { ...state.snapshot!, ...(subagents ? { subagents } : {}) } };
  metrics.emissions++;
  listeners.forEach((listener) => listener());
};
const noAction = () => {};

function PerformanceFixture() {
  const subagents = useConversationProjectionSelector(lease, selector);
  metrics.renders++;
  const [ended, setEnded] = useState(initialEnded);
  const [opened, setOpened] = useState("");
  const onOpen = useCallback((item: SubagentDirectoryItem) => setOpened(item.childSessionId), []);
  useEffect(() => {
    const timer = window.setInterval(() => emit(), 50);
    const insert = () => {
      setEnded((items) => [
        { ...initialEnded[0]!, childSessionId: "new-ended", title: "Newly completed" },
        ...items,
      ]);
      emit({ ...selector(state), revision: 2, endedTotal: 5001 });
    };
    window.addEventListener("insert-ended", insert);
    return () => {
      clearInterval(timer);
      window.removeEventListener("insert-ended", insert);
    };
  }, []);
  return (
    <>
      <output data-testid="opened" className="sr-only">
        {opened}
      </output>
      <SubagentDirectoryList
        running={subagents.running}
        ended={ended}
        endedTotal={subagents.endedTotal}
        loading={false}
        error={null}
        hasMore={false}
        onLoadMore={noAction}
        onRetry={noAction}
        onOpen={onOpen}
      />
    </>
  );
}

const pending: (() => void)[] = [];
window.addEventListener("finish-query", () => pending.splice(0).forEach((finish) => finish()));
let attempts = 0;
const services = {
  zcodeAgentService: {
    listSessionSubagents: async (input: {
      endedLimit: number;
      endedCursor?: string;
      workspaceIdentity: string;
      remoteSessionId: string;
    }) => {
      metrics.calls.push(input);
      attempts++;
      if (params.has("delay") && input.workspaceIdentity === "scope-a")
        await new Promise<void>((resolve) => pending.push(resolve));
      if (params.has("failure") && attempts <= 2) throw new Error("fixture offline");
      const start = Number(input.endedCursor ?? 0);
      const end = Math.min(start + input.endedLimit, 65);
      return {
        revision: 1,
        childSessionIds: [],
        running: [],
        ended: {
          total: 65,
          items: initialEnded
            .slice(start, end)
            .map((item) => ({ ...item, title: `${input.workspaceIdentity}: ${item.title}` })),
          nextCursor: end < 65 ? String(end) : undefined,
        },
      };
    },
  },
} as unknown as IServiceAccessor;

function QueryFixture() {
  const [scope, setScope] = useState("scope-a");
  const directory = useSessionSubagents({
    sessionId: "same-parent",
    workspacePath: "D:/synthetic-workspace",
    workspaceIdentity: scope,
    remoteSessionId: `remote-${scope}`,
  });
  useEffect(() => {
    const change = () => setScope("scope-b");
    window.addEventListener("switch-scope", change);
    return () => window.removeEventListener("switch-scope", change);
  }, []);
  return (
    <SubagentDirectoryList
      running={emptyRunning}
      ended={directory.ended.items}
      endedTotal={directory.ended.total}
      loading={directory.loading}
      error={directory.error}
      hasMore={Boolean(directory.ended.nextCursor)}
      onLoadMore={directory.loadMore}
      onRetry={directory.refresh}
      onOpen={noAction}
    />
  );
}

document.documentElement.classList.add(`theme-${params.get("theme") ?? "zai-light"}`);
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <ZCodeIntlProvider initialLocale={params.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
      <ServiceProvider services={services}>
        <main className="h-screen w-full bg-background text-foreground">
          {params.has("query") ? <QueryFixture /> : <PerformanceFixture />}
        </main>
      </ServiceProvider>
    </ZCodeIntlProvider>
  </StrictMode>,
);
import.meta.hot?.dispose(() => root.unmount());
