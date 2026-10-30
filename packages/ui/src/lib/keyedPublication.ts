/**
 * Per-key publication for high-frequency external stores.
 *
 * 高频 store（conversation projection、sessions-index）过去只有一个「整店」监听集合：
 * 任一帧写入都会唤醒全部 React 订阅者，即便组件只读 queue / status / rows.window 之一。
 * 这里把订阅拆成 key 集合，并让写入方显式声明本轮变脏的 key：
 *
 *   - 订阅者只登记自己依赖的 key（`subscribeKeys`），只有交集非空才被通知；
 *   - 兼容的整店订阅（`subscribe`）等价于登记全部 key，现有组件无需改写；
 *   - 每个 key 在 flush 时用 `readKey` 与上次发布值做引用比较，改回原值的 key 不会通知，
 *     因此「从未真正改变」的 key 绝不会唤醒订阅者（对齐参考实现 MutableChatSource.publish）。
 *
 * 发布通道（PublicationLane）描述的是**写入方**希望何时可见：
 *
 *   - `none`：只写状态、不安排通知；脏 key 累积到下一次非 none 发布再合并送出；
 *   - `animation-frame`（默认）：脏 key 合并到同一动画帧，复用 appFrameNotificationScheduler；
 *   - `immediate`：用户阻塞级写入，取消挂起帧并同步送出（状态本身始终同步可读）。
 *
 * 本模块不新增定时器：animation-frame 完全交给既有 FrameNotificationScheduler。
 */
import type { FrameNotificationScheduler } from "@/lib/frameNotificationScheduler.js";

export type PublicationLane = "none" | "animation-frame" | "immediate";

export interface KeyedPublicationOptions<K extends string> {
  /** store 的全部 key；整店订阅等价于登记这些 key。 */
  allKeys: readonly K[];
  /** 读取某 key 的当前值；flush 时用引用比较过滤「改回原值」的 key。 */
  readKey: (key: K) => unknown;
  /** 既有的帧调度器；不得在此模块内创建新调度器或定时器。 */
  scheduler: FrameNotificationScheduler;
}

interface KeyedSubscriber<K extends string> {
  /** null = 整店订阅，任一 key 变化都通知。 */
  readonly keys: ReadonlySet<K> | null;
  readonly listener: () => void;
}

function intersects<K extends string>(left: ReadonlySet<K>, right: ReadonlySet<K>): boolean {
  // 小集合优先遍历，避免整店订阅（大集合）与单 key 订阅比较时做无谓工作。
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const key of small) {
    if (large.has(key)) return true;
  }
  return false;
}

export class KeyedPublication<K extends string> {
  private readonly subscribers = new Set<KeyedSubscriber<K>>();
  private readonly dirtyKeys = new Set<K>();
  private readonly publishedValues = new Map<K, unknown>();
  private scheduled = false;

  constructor(private readonly options: KeyedPublicationOptions<K>) {
    // 构造时记录初始值：首次 flush 只比较真正登记过的 key，不会把「从未写入」当成变更。
    for (const key of options.allKeys) {
      this.publishedValues.set(key, options.readKey(key));
    }
  }

  /** 兼容整店订阅：任一 key 真正变化时通知。 */
  subscribe(listener: () => void): () => void {
    const subscriber: KeyedSubscriber<K> = { keys: null, listener };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** 只登记需要的 key；空集合不会收到通知。 */
  subscribeKeys(keys: Iterable<K>, listener: () => void): () => void {
    const subscriber: KeyedSubscriber<K> = { keys: new Set(keys), listener };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** 标记本轮变脏的 key；重复标记幂等。 */
  markDirty(keys: Iterable<K>): void {
    for (const key of keys) this.dirtyKeys.add(key);
  }

  /** 按通道发布累积的脏 key。 */
  publish(lane: PublicationLane = "animation-frame"): void {
    if (lane === "none" || this.dirtyKeys.size === 0) return;
    if (lane === "immediate") {
      if (this.scheduled) {
        this.options.scheduler.cancel(this.flush);
        this.scheduled = false;
      }
      this.flush();
      return;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    this.options.scheduler.schedule(this.flush);
  }

  /** 立即送出挂起的 key 变更（关闭/测试用）。 */
  flush = (): void => {
    this.scheduled = false;
    if (this.dirtyKeys.size === 0) return;
    const changedKeys = new Set<K>();
    for (const key of this.dirtyKeys) {
      const next = this.options.readKey(key);
      if (this.publishedValues.has(key) && Object.is(this.publishedValues.get(key), next)) {
        continue;
      }
      this.publishedValues.set(key, next);
      changedKeys.add(key);
    }
    this.dirtyKeys.clear();
    if (changedKeys.size === 0) return;
    // 先快照订阅者：通知期间新增/移除订阅不能影响本轮派发。
    for (const subscriber of Array.from(this.subscribers)) {
      if (subscriber.keys !== null && !intersects(subscriber.keys, changedKeys)) continue;
      subscriber.listener();
    }
  };

  hasPending(): boolean {
    return this.scheduled || this.dirtyKeys.size > 0;
  }

  /** 测试/诊断：当前累积但尚未发布的 key。 */
  pendingKeys(): readonly K[] {
    return [...this.dirtyKeys];
  }

  /** 测试/诊断：已登记 key 的订阅者数量。 */
  subscriberCount(): number {
    return this.subscribers.size;
  }
}
