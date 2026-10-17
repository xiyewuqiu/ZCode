// Composer Skill 只读 catalog。
// 与 Skills Settings 管理接口分离：这里的 sessionId 决定 authority，不提供启停/删除能力。
import {
  ycodeSkillsReferenceCatalogParamsSchema,
  type YCodeSkillReferenceCatalogEntry,
  type YCodeSkillsReferenceCatalogResult,
} from "@ycode/shared";
import type { SkillLoadOutcome, SkillMetadata } from "@ycode/contracts";
import { listYCodeSkills } from "../skills.js";
import {
  parseParams,
  requireSession,
  type YCodeProtocolAgentServerContext,
} from "./server-types.js";

export async function getSkillReferenceCatalog(
  context: YCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<YCodeSkillsReferenceCatalogResult> {
  const params = parseParams(ycodeSkillsReferenceCatalogParamsSchema, rawParams);
  if (params.sessionId) {
    const record = requireSession(context, params.sessionId);
    const outcome = await record.app.getSkillCatalog();
    return toResult("session", outcome);
  }

  // 旧 UI cache 只在 workspace 首次挂载时扫描，用户从文件系统手动新增
  // Skill 后，新建对话仍停在旧快照。草稿请求在 Agent 侧复用 CLI 正式发现配置，
  // 每次新打开引用面板都读取当前 workspace catalog。
  const outcome = await listYCodeSkills({
    env: context.deps.env,
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  return toResult("workspace", outcome);
}

function toResult(
  authority: YCodeSkillsReferenceCatalogResult["authority"],
  outcome: SkillLoadOutcome,
): YCodeSkillsReferenceCatalogResult {
  return {
    authority,
    skills: outcome.skills.map(toReferenceCatalogEntry),
  };
}

function toReferenceCatalogEntry(skill: SkillMetadata): YCodeSkillReferenceCatalogEntry {
  const scope =
    skill.source === "plugin" ? "plugin" : skill.scope === "project" ? "workspace" : "user";
  return {
    // `glm:` 是现有 UI provider 过滤契约；路径使同名不同来源仍有稳定行身份。
    id: `glm:${scope}:${skill.path}`,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope,
    enabled: true,
    ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
  };
}
