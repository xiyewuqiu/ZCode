import {
  runtimeEntrySnapshotSuffix,
  type RuntimeMessageEntry,
} from "../../agent/message-history.js";

export interface CompactionHistorySnapshot {
  generation: number;
  /** provider/model 身份；模型切换后投机摘要不能跨模型采纳。 */
  modelKey: string;
  entries: readonly RuntimeMessageEntry[];
}

export interface SpeculativeCompactionCandidate<T> {
  snapshot: CompactionHistorySnapshot;
  value: T;
}

interface SpeculativeTask<T> {
  snapshot: CompactionHistorySnapshot;
  abort: AbortController;
  status: "running" | "ready" | "failed";
  value?: T;
}

/**
 * 每个 runtime（即每个会话）唯一的压缩协调器。
 *
 * 单一所有者：
 * - `generation`：成功提交的压缩替换代数，只有本类能推进；
 * - `runExclusive`：manual / auto / reactive 压缩互斥，保证同一时刻只有一个提交；
 * - `speculativeTask`：同一时刻最多一个后台摘要任务。
 *
 * 普通历史追加不推进 generation；基准是否仍有效由 entries 引用前缀判定。
 */
export class CompactionController {
  private generationValue = 0;
  private lockTail: Promise<void> = Promise.resolve();
  private speculativeTask?: SpeculativeTask<unknown>;
  /** 同一 generation/model 只尝试一次投机摘要，避免长 turn 每步重发 provider 请求。 */
  private lastSpeculativeAttempt?: { generation: number; modelKey: string };

  get generation(): number {
    return this.generationValue;
  }

  /** resume / rewind 从持久化 boundary 恢复代数；旧数据按 0。 */
  restoreGeneration(generation: number): void {
    this.cancelSpeculative("generation_restored");
    this.lastSpeculativeAttempt = undefined;
    this.generationValue =
      Number.isFinite(generation) && generation > 0 ? Math.floor(generation) : 0;
  }

  /** 只在仍匹配基准时推进代数；否则抛出由调用方处理的 stale。 */
  commitGeneration(baseGeneration: number): number {
    if (this.generationValue !== baseGeneration) {
      throw new Error(
        `Compaction generation changed (${baseGeneration} -> ${this.generationValue})`,
      );
    }
    this.generationValue += 1;
    this.cancelSpeculative("generation_advanced");
    this.lastSpeculativeAttempt = undefined;
    return this.generationValue;
  }

  /** 串行化所有同步压缩提交；排队任务在获得锁后才会捕获基准。 */
  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.lockTail;
    let release!: () => void;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /**
   * 启动投机摘要。仅在没有其它投机任务时启动；任务失败/取消不会影响 turn。
   * 返回 false 表示已有 in-flight 任务或被调用方忽略。
   */
  startSpeculative<T>(
    snapshot: CompactionHistorySnapshot,
    run: (signal: AbortSignal) => Promise<T | undefined>,
  ): boolean {
    if (this.speculativeTask) return false;
    if (
      this.lastSpeculativeAttempt?.generation === snapshot.generation &&
      this.lastSpeculativeAttempt.modelKey === snapshot.modelKey
    ) {
      return false;
    }
    this.lastSpeculativeAttempt = {
      generation: snapshot.generation,
      modelKey: snapshot.modelKey,
    };

    const abort = new AbortController();
    const task: SpeculativeTask<T> = {
      abort,
      snapshot: {
        generation: snapshot.generation,
        modelKey: snapshot.modelKey,
        entries: [...snapshot.entries],
      },
      status: "running",
    };
    // 以 unknown 保存，take 时由调用方按同一 T 取回。
    this.speculativeTask = task as SpeculativeTask<unknown>;

    void run(abort.signal)
      .then((value) => {
        if (!this.isCurrent(task)) return;
        task.value = value;
        task.status = value === undefined ? "failed" : "ready";
      })
      .catch(() => {
        if (!this.isCurrent(task)) return;
        task.status = "failed";
      });
    return true;
  }

  /**
   * 仅在任务已完成且基准仍匹配（generation、模型一致、snapshot 仍是当前前缀）时返回候选。
   * 基准不匹配时直接取消任务并返回 undefined；仍在运行时保持任务继续。
   */
  takeSettledSpeculative<T>(current: CompactionHistorySnapshot): SpeculativeCompactionCandidate<T> | undefined {
    const task = this.speculativeTask as SpeculativeTask<T> | undefined;
    if (!task) return undefined;
    if (!isSnapshotCompatible(task.snapshot, current)) {
      this.cancelSpeculative("base_changed");
      return undefined;
    }
    if (task.status !== "ready" || task.value === undefined) return undefined;

    this.speculativeTask = undefined;
    return { snapshot: task.snapshot, value: task.value };
  }

  cancelSpeculative(reason: string): void {
    const task = this.speculativeTask;
    if (!task) return;
    this.speculativeTask = undefined;
    task.abort.abort(reason);
  }

  get hasSpeculative(): boolean {
    return this.speculativeTask !== undefined;
  }

  private isCurrent<T>(task: SpeculativeTask<T>): boolean {
    return this.speculativeTask === (task as SpeculativeTask<unknown>);
  }
}

export function isSnapshotCompatible(
  snapshot: CompactionHistorySnapshot,
  current: CompactionHistorySnapshot,
): boolean {
  // 投机候选只在基准完全未增长时采纳：turn 一旦追加了 assistant/tool 输出，
  // 该 summary 已不覆盖当前上下文，必须丢弃并按硬阈值重新同步压缩。
  if (snapshot.generation !== current.generation || snapshot.modelKey !== current.modelKey) {
    return false;
  }
  if (snapshot.entries.length !== current.entries.length) return false;
  return runtimeEntrySnapshotSuffix(snapshot.entries, current.entries)?.length === 0;
}
