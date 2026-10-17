import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { YCodeProvider } from "./ycode-task-types-core.js";

export const YCODE_AGENT_PROVIDER = "glm" satisfies YCodeProvider;
export const YCODE_AGENT_PROVIDER_LABEL = "YCode Agent";
export const YCODE_COMMAND_AGENT_SOURCE = "ycodeAgent" satisfies CommandAgentSource;

export const ycodeAgentProviderSchema = z.literal(YCODE_AGENT_PROVIDER);

export const YCODE_COMMAND_AGENT_SOURCES = [
  YCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToYCodeAgent(
  _provider?: YCodeProvider | null,
): YCodeProvider {
  return YCODE_AGENT_PROVIDER;
}

export function isYCodeAgentProvider(
  provider: YCodeProvider | null | undefined,
): provider is typeof YCODE_AGENT_PROVIDER {
  return provider === YCODE_AGENT_PROVIDER;
}
