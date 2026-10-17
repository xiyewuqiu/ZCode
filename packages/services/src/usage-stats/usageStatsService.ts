import type { AppUsageRequest, AppUsageSnapshot } from "@ycode/shared";
import type { IYCodeAgentService } from "../ycode-agent/ycodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

interface UsageStatsServiceDependencies {
  /** App Usage 经 YCode Protocol 读取 agent 数据库真实统计。 */
  ycodeAgentService: Pick<IYCodeAgentService, "getAppUsageStats">;
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 YCode Protocol usage/stats 取回。不读本地 session JSON 估算。
      return dependencies.ycodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
  };
}
