import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";
import { createConversationTurnRenderer } from "@/v4/conversationTurnRenderUnits.js";
import { TimelineRowHeightCache } from "@/v4/timelineRowHeightCache.js";

/**
 * 会话作用域的时间线派生缓存。
 *
 * 切任务/切会话会把 `ConversationTimeline` 整棵卸载重建：过去渲染单元物化缓存与行高
 * 缓存都挂在组件实例上，于是每次回到同一会话都要重新物化整轮、重新估计每一行高度
 * （滚动条先跳到估计值，再被 ResizeObserver 逐行纠正）。
 *
 * 这里把两者按「会话 + logEpoch」聚合为有界 LRU：
 * - 物化缓存仍按行引用与 phase 校验，内容变了自然重算，不会留下旧正文；
 * - 行高缓存按 turnId 命中，卸载重挂后首帧就有真实高度；
 * - 超出容量的会话整体丢弃，内存增长有上界。
 */
export interface TimelineSessionCache {
  renderer: ReturnType<typeof createConversationTurnRenderer>;
  heightCache: TimelineRowHeightCache;
}

const MAX_TIMELINE_SESSION_CACHES = 3;

const sessionCaches = new Map<string, TimelineSessionCache>();

uiMemoryDiagnosticsRegistry.register("timelineSessionCaches", () => {
  let heights = 0;
  for (const entry of sessionCaches.values()) heights += entry.heightCache.size;
  return { sessions: sessionCaches.size, heights };
});

/** 取（或建立）会话缓存；命中会把该会话移到 LRU 最新端。 */
export function acquireTimelineSessionCache(key: string): TimelineSessionCache {
  const existing = sessionCaches.get(key);
  if (existing) {
    sessionCaches.delete(key);
    sessionCaches.set(key, existing);
    return existing;
  }
  const created: TimelineSessionCache = {
    renderer: createConversationTurnRenderer(),
    heightCache: new TimelineRowHeightCache(),
  };
  sessionCaches.set(key, created);
  while (sessionCaches.size > MAX_TIMELINE_SESSION_CACHES) {
    const oldest = sessionCaches.keys().next();
    if (oldest.done) break;
    sessionCaches.delete(oldest.value);
  }
  return created;
}

/** 诊断/测试：当前保留的会话缓存数量。 */
export function countTimelineSessionCaches(): number {
  return sessionCaches.size;
}

/** 测试：清空会话缓存。 */
export function clearTimelineSessionCaches(): void {
  sessionCaches.clear();
}
