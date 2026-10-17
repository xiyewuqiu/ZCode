import type { AppUsageRequest, AppUsageSnapshot } from "@ycode/shared";
import { ServiceChannels } from "@ycode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IUsageStatsService {
  /** App Usage 经 YCode Protocol 读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage）。 */
  getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot>;
}

export const IUsageStatsService = createServiceDescriptor<IUsageStatsService>(
  ServiceChannels.UsageStats,
);
