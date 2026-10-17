export const YCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "YCODE_BUILTIN_PROVIDER_CONFIG_FILE";
export const YCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "YCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const YCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "YCODE_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly ycodeBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [YCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.ycodeBuiltinFilePath,
    [YCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const ycodeBuiltinFilePath = env[YCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[YCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!ycodeBuiltinFilePath && !personalFilePath) return null;
  if (!ycodeBuiltinFilePath || !personalFilePath) {
    throw new Error("YCode Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ ycodeBuiltinFilePath, personalFilePath });
}
