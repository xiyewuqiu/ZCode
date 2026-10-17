import {
  ProviderConfig,
  ProviderConfigMap,
  ProviderTemplateMap,
  type ModelConfigRules,
} from "./config/index.js";

export interface ProviderSource<TSnapshot> {
  read(): Promise<TSnapshot>;
  onDidChange(listener: (reason: string) => void): () => void;
}

export interface ProviderConfigSnapshot {
  readonly revision: string;
  readonly ycodeBuiltinRevision: string;
  readonly personalRevision: string;
  readonly ycodeBuiltinProviders: ProviderConfigMap;
  readonly ycodeBuiltinProviderTemplates: ProviderTemplateMap;
  readonly personalProviders: ProviderConfigMap;
  readonly ycodeBuiltinModelRules: ModelConfigRules;
  readonly personalModels: ModelConfigRules;
  readonly personalProviderOrder?: readonly string[];
}
