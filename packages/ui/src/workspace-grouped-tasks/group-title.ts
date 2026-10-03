import { CRON_DEFAULT_GROUP_ID } from "@zcode/shared";

/** 系统分组标题按语言环境本地化展示，忽略 DB 里存的固定占位标题（'cron'）。 */
function getTaskGroupDisplayTitle(
  group: { id: string; title: string },
  localizedSystemTitles: { cron: string },
): string {
  if (group.id === CRON_DEFAULT_GROUP_ID) return localizedSystemTitles.cron;
  return group.title;
}

export { getTaskGroupDisplayTitle };
