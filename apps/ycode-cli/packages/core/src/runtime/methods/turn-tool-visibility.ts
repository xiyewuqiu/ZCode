import type { AgentRuntimeInternal } from "../internal.js";
import {
  AUTOMATION_MUTATION_TOOL_NAMES,
  isAutomationMutationRestrictedTurn,
  type RegularTurnLoopState,
} from "./turn-loop-state.js";

/**
 * 计算当前 provider 请求边界可见的工具集合。
 *
 * automation 派发到已 active 会话或重试恢复时，入口 metadata 可能没有带到
 * loop state；但 queryId 仍是 automation-*。provider 请求边界必须按 queryId 再硬过滤
 * automation 写工具，否则模型会先看到并创建、修改或删除任务定义。
 */
export function getTurnTools(runtime: AgentRuntimeInternal, state: RegularTurnLoopState) {
  const disallowed = buildTurnDisallowedTools(state);
  if (state.automationCreateLimitReached) return [];
  const tools = runtime.getTools(state.model);
  return disallowed ? tools.filter((tool) => !disallowed.has(tool.name)) : tools;
}

function buildTurnDisallowedTools(state: RegularTurnLoopState): Set<string> | null {
  const tools = new Set(state.toolDisallowlist ?? []);
  if (isAutomationMutationRestrictedTurn(state)) {
    // 定时任务执行轮只应运行任务 prompt，不能反过来管理自己的定义。
    // 保留 CronList 供只读查询；所有 mutation 在 provider 请求边界统一隐藏。
    for (const toolName of AUTOMATION_MUTATION_TOOL_NAMES) {
      tools.add(toolName);
    }
  }
  return tools.size > 0 ? tools : null;
}
