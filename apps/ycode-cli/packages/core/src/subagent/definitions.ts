import { normalizeAgentProfiles, type AgentProfile } from "./profile.js";

export interface AgentDefinitionsSnapshot {
  readonly activeAgents: readonly Readonly<AgentProfile>[];
}

/** 同步读取已发布的内存快照；加载、覆盖和移除由提供方负责。 */
export type GetAgentDefinitions = () => AgentDefinitionsSnapshot;

/**
 * 以运行时配置为唯一来源构造只读快照。
 *
 * 注意：Agent 工具派发（subagent runner）与目录提醒共用同一份 `subagents.profiles`，
 * 不再另存一份目录状态。宿主若支持在会话内动态增删 profile，可注入自己的
 * `getAgentDefinitions` 覆盖本 reader。
 */
export function createAgentDefinitionsReader(
  profiles: readonly AgentProfile[],
  options: Parameters<typeof normalizeAgentProfiles>[1] = {},
): GetAgentDefinitions {
  const snapshot: AgentDefinitionsSnapshot = {
    activeAgents: normalizeAgentProfiles(profiles, options),
  };
  return () => snapshot;
}
