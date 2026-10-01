import type { ZCodeSessionEndedSubagent, ZCodeSessionSubagentsResult } from "@zcode/shared";

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface SessionSubagentsViewState {
  revision: number;
  ended: ZCodeSessionSubagentsResult["ended"];
  error: string | null;
  loading: boolean;
}

const emptyState = (): SessionSubagentsViewState => ({
  revision: 0,
  ended: { total: 0, items: [] },
  error: null,
  loading: false,
});

function sameItem(a: ZCodeSessionEndedSubagent, b: ZCodeSessionEndedSubagent): boolean {
  return (
    a.childSessionId === b.childSessionId &&
    a.agentId === b.agentId &&
    a.toolCallId === b.toolCallId &&
    a.subagentType === b.subagentType &&
    a.title === b.title &&
    a.summary === b.summary &&
    a.status === b.status &&
    a.startedAt === b.startedAt &&
    a.endedAt === b.endedAt
  );
}

/** scope 内的只读分页视图；不拥有子 Agent 生命周期，不跨 scope 缓存。 */
export class SessionSubagentsQuery {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = false;
  private inFlight: Promise<void> | null = null;
  private refreshRequested = false;

  constructor(
    private readonly requestPage: (
      limit: number,
      cursor?: string,
    ) => Promise<ZCodeSessionSubagentsResult>,
    private readonly onError?: (message: string) => void,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  activate() {
    this.active = true;
  }
  deactivate() {
    this.active = false;
    this.generation++;
    this.inFlight = null;
    this.refreshRequested = false;
  }

  private publish(state: SessionSubagentsViewState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  refresh = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    // 旧实现丢弃在途 revision；记录一个后续刷新需求，连续通知合并但不丢最终状态。
    this.refreshRequested = true;
    return this.inFlight ?? this.start("refresh");
  };

  loadMore = (): Promise<void> => {
    if (!this.active || !this.state.ended.nextCursor) return Promise.resolve();
    return this.inFlight ?? this.start("more");
  };

  private start(kind: "refresh" | "more"): Promise<void> {
    const generation = this.generation;
    const current = () => this.active && generation === this.generation;
    const run = async () => {
      let nextKind = kind;
      do {
        if (nextKind === "refresh") this.refreshRequested = false;
        this.publish({ ...this.state, loading: true, error: null });
        try {
          const next = await this.read(nextKind, current);
          if (next && current()) this.publish({ ...next, error: null, loading: false });
        } catch (error) {
          if (!current()) return;
          const message = error instanceof Error ? error.message : String(error);
          this.onError?.(message);
          this.publish({ ...this.state, error: message, loading: false });
        }
        nextKind = "refresh";
      } while (current() && this.refreshRequested);
    };
    const pending = run().finally(() => {
      // scope / StrictMode 已换代时，旧请求不能解除新请求的互斥。
      if (!current() || this.inFlight !== pending) return;
      this.inFlight = null;
      // 发布结果与 finally 之间仍可能收到微任务通知；解锁后接续最后一次失效需求。
      if (this.refreshRequested) return this.start("refresh");
    });
    this.inFlight = pending;
    return pending;
  }

  private async read(kind: "refresh" | "more", current: () => boolean) {
    const previous = this.state.ended;
    const oldById = new Map(previous.items.map((item) => [item.childSessionId, item]));
    const items = kind === "more" ? [...previous.items] : [];
    const seen = new Set(items.map((item) => item.childSessionId));
    const cursors = new Set<string>();
    let cursor = kind === "more" ? previous.nextCursor : undefined;
    let target = Math.max(PAGE_SIZE, previous.items.length);
    let first = true;
    let response: ZCodeSessionSubagentsResult;
    do {
      if (cursor) {
        if (cursors.has(cursor)) throw new Error("subagent_directory_repeated_cursor");
        cursors.add(cursor);
      }
      response = await this.requestPage(
        kind === "more" ? PAGE_SIZE : Math.min(MAX_PAGE_SIZE, target - items.length),
        cursor,
      );
      // 每页 await 后立刻失效检查，避免释放后继续向旧 workspace 发送整段历史查询。
      if (!current()) return null;
      if (first && kind === "refresh" && previous.items.length > 0) {
        target += Math.max(0, response.ended.total - previous.total);
      }
      for (const item of response.ended.items) {
        if (seen.has(item.childSessionId)) continue;
        seen.add(item.childSessionId);
        const old = oldById.get(item.childSessionId);
        items.push(old && sameItem(old, item) ? old : item);
      }
      cursor = response.ended.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("subagent_directory_repeated_cursor");
      first = false;
    } while (kind === "refresh" && cursor && items.length < target);

    const unchanged =
      items.length === previous.items.length &&
      items.every((item, index) => item === previous.items[index]);
    return {
      revision: response.revision,
      ended: {
        total: response.ended.total,
        items: unchanged ? previous.items : items,
        ...(cursor ? { nextCursor: cursor } : {}),
      },
    };
  }
}
