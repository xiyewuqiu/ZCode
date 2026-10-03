import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LayerSurface, useLayerActivity } from "../../src/lib/layerActivity.js";
import { subscribeToVisibleProjection } from "../../src/v4/visibleProjectionSubscription.js";
import "../../src/styles.css";

/**
 * 层活动门控 fixture：
 * - `LayerSurface` 常驻挂载两个层，切换只改活动态；
 * - 消费者与真实路径同构：`useLayerActivity()` + `subscribeToVisibleProjection`
 *   + `useSyncExternalStore`，失活层不接收通知。
 */
function createFakeProjectionStore() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => ({ value }),
    push(next: number) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}
type FakeStore = ReturnType<typeof createFakeProjectionStore>;

const store: FakeStore = createFakeProjectionStore();
const counters = { chatRenders: 0, chatMounts: 0, otherRenders: 0, otherMounts: 0 };
(globalThis as { __layerCounters?: typeof counters }).__layerCounters = counters;

function ProjectionConsumer({
  projectionStore,
  testId,
  counterKey,
}: {
  projectionStore: FakeStore;
  testId: string;
  counterKey: "chatRenders" | "otherRenders";
}) {
  const activity = useLayerActivity();
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    counters[counterKey === "chatRenders" ? "chatMounts" : "otherMounts"] += 1;
  }
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToVisibleProjection(projectionStore, listener, document, activity),
    [activity, projectionStore],
  );
  const getSnapshot = useCallback(() => projectionStore.getState().value, [projectionStore]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  counters[counterKey] += 1;
  return (
    <div data-testid={testId} data-value={value} data-renders={counters[counterKey]}>
      {value}
    </div>
  );
}

function Fixture() {
  const [view, setView] = useState<"chat" | "other">("chat");
  // 推送只写 store，不触发父级重渲染：计数只度量「通知驱动」的渲染。
  const nextValueRef = useRef(0);
  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      {/* 高度用内联样式而非工具类：fixture 不保证 Tailwind 扫描到测试目录，
          高度不变量必须由宿主盒本身决定。 */}
      <div
        data-testid="layer-host"
        className="relative w-full overflow-hidden"
        style={{ height: 200 }}
      >
        <LayerSurface active={view === "chat"} testId="layer-chat">
          <ProjectionConsumer
            projectionStore={store}
            testId="chat-value"
            counterKey="chatRenders"
          />
          {/* 真实壳里 chat 层内含 Composer：层切换时中文 IME 不能丢已输入文本。 */}
          <textarea data-testid="chat-composer" className="h-16 w-full" defaultValue="" />
        </LayerSurface>
        <LayerSurface active={view === "other"} testId="layer-other">
          <ProjectionConsumer
            projectionStore={store}
            testId="other-value"
            counterKey="otherRenders"
          />
        </LayerSurface>
      </div>
      <button
        className="h-8 rounded-lg border border-border px-2 text-ui-base"
        data-testid="switch-view"
        onClick={() => setView((current) => (current === "chat" ? "other" : "chat"))}
      >
        switch
      </button>
      <button
        className="ml-2 h-8 rounded-lg border border-border px-2 text-ui-base"
        data-testid="push-update"
        onClick={() => {
          nextValueRef.current += 1;
          store.push(nextValueRef.current);
        }}
      >
        push
      </button>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
