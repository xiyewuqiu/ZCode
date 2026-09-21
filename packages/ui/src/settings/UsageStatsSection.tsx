import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/**
 * 用量统计分区。
 *
 * Coding Plan / Start Plan 套餐用量面板已随购买/订阅界面整体下线，
 * 这里只保留纯通用的 App 用量统计。
 */
export function UsageStatsSection(_props: {
  workspaceIdentity?: string;
  workspacePath?: string;
}) {
  return <AppUsagePanel />;
}
