import { materializeYCodeBuiltinProviderConfig } from "@ycode/services/node";

declare const __YCODE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledYCodeBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 YCode Built-in Provider Config。 */
export function readBundledYCodeBuiltinProviderConfig(): string {
  if (typeof __YCODE_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 YCode Built-in Provider Config");
  }
  return __YCODE_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 YCode Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledYCodeBuiltinProviderConfig(
  options: MaterializeBundledYCodeBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeYCodeBuiltinProviderConfig(options);
}
