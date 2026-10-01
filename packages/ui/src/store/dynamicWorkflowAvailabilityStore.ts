import { create } from "zustand";
import { logger } from "@/logger.js";

// ============================================================
// 动态工作流灰度快照在 renderer 的唯一副本
// ============================================================
//
// 动态工作流的灰度判定来自厂商账号链路（Coding Plan Subscription）。
// 账号/厂商端点移除后，该特性恒为 fail-closed（不提供入口）；保留 store
// 是为了让消费方在过渡期保持可编译，后续连同 UI 入口一并删除。

export type DynamicWorkflowAvailabilityStatus = "loading" | "ready";

export interface DynamicWorkflowAvailabilitySnapshot {
  readonly status: DynamicWorkflowAvailabilityStatus;
  /** loading 期间恒为 false：未知即不提供，入口宁可晚半拍出现也不闪一下再收起。 */
  readonly enabled: boolean;
  /** 未就绪或取数失败时为 null；厂商灰度源移除后恒为 null。 */
  readonly config: null;
}

interface DynamicWorkflowAvailabilityState extends DynamicWorkflowAvailabilitySnapshot {
  /** 厂商灰度源已移除：直接落定为 disabled。 */
  ensureLoaded(): Promise<void>;
  refresh(): Promise<void>;
}

const DISABLED_SNAPSHOT: DynamicWorkflowAvailabilitySnapshot = {
  status: "ready",
  enabled: false,
  config: null,
};

export const useDynamicWorkflowAvailabilityStore = create<DynamicWorkflowAvailabilityState>(
  (set) => ({
    ...DISABLED_SNAPSHOT,

    ensureLoaded(): Promise<void> {
      set(DISABLED_SNAPSHOT);
      logger.debug("[dynamic-workflow] 厂商灰度源已移除，按未命中处理");
      return Promise.resolve();
    },

    refresh(): Promise<void> {
      set(DISABLED_SNAPSHOT);
      return Promise.resolve();
    },
  }),
);
