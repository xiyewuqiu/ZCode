import { loadBuiltinProviderConfig } from "../../../../../scripts/builtin-provider-config.mjs";

export const SEA_YCODE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY = "ycode-provider/ycode-builtin.json";

export const collectSeaProviderConfigAssets = async ({ root, env = process.env }) => {
  const { sourcePath } = await loadBuiltinProviderConfig({ root, env });
  return {
    [SEA_YCODE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY]: sourcePath,
  };
};
