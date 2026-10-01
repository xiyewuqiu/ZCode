import { ModelSelectionFacade, type ProviderRegistryFacadeSource } from "@zcode/provider";
import { resolveLegacyReasoningLevel } from "./legacy-reasoning-level.js";

/** Host 与受管理 Worker 共用同一份模型选择解析；解析由纯 Provider Facade 负责。 */
export function createNodeModelSelectionFacade(
  source: ProviderRegistryFacadeSource,
): ModelSelectionFacade {
  return new ModelSelectionFacade(source, resolveLegacyReasoningLevel);
}
