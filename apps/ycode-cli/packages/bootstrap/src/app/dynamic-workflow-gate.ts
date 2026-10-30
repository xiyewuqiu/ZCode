import { join } from "node:path";
import type { SkillRoot } from "@ycode/contracts";
import { DYNAMIC_WORKFLOW_SKILL_NAME } from "./bundled-skills.js";

/**
 * 动态工作流开关在 App 装配层的减法。
 * 工具面的减法在 core 的 registerBuiltInTools，`/` 目录的减法在 ycode-protocol/slash-commands.ts；
 * 这里只放「技能发现」这项需要 bootstrap 侧路径推导的——命令展开现在由内置 `/workflow`
 * （builtin-workflow-command.ts）自己判断开关，不再需要按命令名屏蔽插件命令。
 */

const SKILL_MANIFEST_FILE_NAME = "SKILL.md";

/**
 * 动态工作流关闭时要从技能发现中剔除的 SKILL.md 绝对路径。
 *
 * 为什么按路径而不是按 root 过滤：NodeSkillAdapter 只提供 `disabledPaths` 这一个剔除机制
 * （config.json 的 `skill.<path>.enable=false` 走的也是它），而同一根 root 下可能还有别的
 * 技能；整根拿掉会连坐它们。
 *
 * 传入的 root 是内置技能包根（bundled-skills.ts 的解析结果），路径不存在时只是一个永不命中的
 * Set 成员，没有副作用。
 */
export function collectDynamicWorkflowDisabledSkillPaths(
  skillRoots: readonly SkillRoot[],
): string[] {
  return skillRoots.map((root) =>
    join(root.path, DYNAMIC_WORKFLOW_SKILL_NAME, SKILL_MANIFEST_FILE_NAME),
  );
}
