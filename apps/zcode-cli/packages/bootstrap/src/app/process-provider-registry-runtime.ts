import { dirname, join } from "node:path";
import {
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  resolveNodeProviderRuntimePaths,
  downloadZCodeBuiltinRelease,
  resolveZCodeBuiltinClientPlatform,
  ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV,
  type ZCodeBuiltinRefreshEvent,
} from "@zcode/provider-node";
import { resolveRuntimeZCodeEndpointOrigin, ZCODE_VERSION } from "@zcode/shared";
import { readLegacyCliPersonalProviderConfig } from "./legacy-cli-personal-provider-config-importer.js";

export interface ProcessProviderRegistryRuntimeOptions {
  /** Standalone Prompt CLI / TUI 自己持有 Built-in 远程刷新与旧配置的一次性导入。 */
  readonly standalone?: {
    readonly legacyCliUserConfigFilePath?: string;
    readonly request?: typeof fetch;
    readonly onBuiltinRefreshError?: (error: unknown) => void;
    readonly onBuiltinRefreshResult?: (event: ZCodeBuiltinRefreshEvent) => void;
  };
}

export async function startProcessProviderRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  options: ProcessProviderRegistryRuntimeOptions = {},
) {
  const paths = resolveNodeProviderRuntimePaths(env);
  if (!paths) {
    throw new Error("缺少进程 Provider Registry 的 ZCode Built-in / Personal Config 路径");
  }

  const bundledFile = options.standalone
    ? env[ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV]?.trim()
    : undefined;
  const runtime = new NodeProviderRegistryRuntime({
    ...paths,
    ...(bundledFile
      ? {
          zcodeBuiltinFilePath: bundledFile,
          zcodeBuiltinActiveFilePath: paths.zcodeBuiltinFilePath,
          zcodeBuiltinRemote: {
            controlFilePath: join(
              dirname(paths.zcodeBuiltinFilePath),
              "zcode-builtin-refresh.json",
            ),
            resolveEndpointKey: () => resolveRuntimeZCodeEndpointOrigin(env),
            fetchRelease: (endpointOrigin, signal) =>
              downloadZCodeBuiltinRelease({
                endpointOrigin,
                signal,
                appVersion: ZCODE_VERSION,
                platform: resolveZCodeBuiltinClientPlatform(),
                request: options.standalone?.request ?? globalThis.fetch,
              }),
            onRefreshResult: options.standalone?.onBuiltinRefreshResult,
          },
        }
      : {}),
    onZCodeBuiltinRefreshError: options.standalone?.onBuiltinRefreshError,
    ...(options.standalone
      ? {
          importLegacy: () =>
            readLegacyCliPersonalProviderConfig({
              ...(options.standalone?.legacyCliUserConfigFilePath
                ? { filePath: options.standalone.legacyCliUserConfigFilePath }
                : {}),
            }),
        }
      : {}),
  });
  try {
    await runtime.start();
    const snapshot = runtime.registryService.getSnapshot()!;
    const modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
      personalRepository: runtime.personalRepository,
    });
    try {
      const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
      return Object.freeze({
        dispose() {
          modelSelectionConfigRepository.dispose();
          runtime.dispose();
        },
        runtime,
        snapshot,
        modelSelectionConfigRepository,
        configuredDefaultModelSelection,
      });
    } catch (error) {
      modelSelectionConfigRepository.dispose();
      throw error;
    }
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}
