import { resolve } from "node:path";
import { createConfig } from "@ycode/adapters/config";
import { createNodeSkillAdapter } from "@ycode/adapters/skills";
import type { Logger, SkillContent, SkillDiagnostic, SkillLoadOutcome } from "@ycode/contracts";
import { resolveYCodePlugins } from "./plugins.js";
import { collectDisabledPaths } from "./skill-command-overrides.js";

export interface ListYCodeSkillsOptions {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  projectConfigPath?: string;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  workingDirectory?: string;
}

export interface InspectYCodeSkillOptions extends ListYCodeSkillsOptions {
  name: string;
}

export interface YCodeSkillInspection {
  diagnostics: SkillDiagnostic[];
  skill: SkillContent;
}

export async function listYCodeSkills(
  options: ListYCodeSkillsOptions = {},
): Promise<SkillLoadOutcome> {
  const discovery = createSkillDiscovery(options);
  if (!discovery.enabled) {
    return {
      diagnostics: [],
      skills: [],
      totalDiscovered: 0,
    };
  }

  return await discovery.skillPort.discoverSkills({
    workingDirectory: discovery.workingDirectory,
  });
}

export async function inspectYCodeSkill(
  options: InspectYCodeSkillOptions,
): Promise<YCodeSkillInspection> {
  const discovery = createSkillDiscovery(options);
  if (!discovery.enabled) {
    throw new Error("Skills are disabled.");
  }

  const outcome = await discovery.skillPort.discoverSkills({
    workingDirectory: discovery.workingDirectory,
  });
  if (
    !outcome.skills.some(
      (skill) => skill.name === options.name || skill.qualifiedName === options.name,
    )
  ) {
    throw new Error(`Skill not found: ${options.name}`);
  }

  const skill = await discovery.skillPort.loadSkill({
    name: options.name,
    workingDirectory: discovery.workingDirectory,
  });

  return {
    diagnostics: outcome.diagnostics,
    skill,
  };
}

function createSkillDiscovery(options: ListYCodeSkillsOptions):
  | {
      enabled: false;
      workingDirectory: string;
    }
  | {
      enabled: true;
      skillPort: ReturnType<typeof createNodeSkillAdapter>;
      workingDirectory: string;
    } {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const configResult = createConfig({
    env: options.env,
    projectConfigPath: options.projectConfigPath,
    workingDirectory,
    skipUserConfig: options.skipUserConfig,
    userConfigPath: options.userConfigPath,
  });

  if (!configResult.config.features.skill || !configResult.config.skills.enabled) {
    return {
      enabled: false,
      workingDirectory,
    };
  }
  const pluginOutcome = resolveYCodePlugins({
    configResult,
    env: options.env,
    logger: options.logger,
    projectConfigPath: options.projectConfigPath,
    skipUserConfig: options.skipUserConfig,
    userConfigPath: options.userConfigPath,
    workingDirectory,
  });

  return {
    enabled: true,
    skillPort: createNodeSkillAdapter({
      extraRoots: configResult.config.skills.roots,
      extraResolvedRoots: pluginOutcome.skillRoots,
      disabledPaths: collectDisabledPaths(configResult.config.skillOverrides),
    }),
    workingDirectory,
  };
}
