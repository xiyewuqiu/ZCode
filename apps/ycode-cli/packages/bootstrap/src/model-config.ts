import type {
  AiSdkModelExecutionConfig,
  AiSdkNetworkConfig,
  EnvRecord,
} from "@ycode/adapters/model";
import {
  resolveRuntimeYCodeEnv,
  resolveRuntimeYCodeEndpointOrigin,
  YCODE_APP_VERSION_ENV,
} from "@ycode/shared";
import {
  createRuntimePlatformHeaders,
  normalizePrintableHeaderValue,
} from "./runtime-platform-headers.js";

export type ModelProviderSourceTitle = "cli" | "electron";

interface RuntimeExecutionConfigOptions {
  appVersion?: string;
  network?: AiSdkNetworkConfig;
  sourceTitle?: ModelProviderSourceTitle;
}

export function createRuntimeAiSdkModelExecutionConfig(
  env: EnvRecord = process.env,
  options: RuntimeExecutionConfigOptions = {},
): AiSdkModelExecutionConfig {
  const network = normalizeAiSdkNetworkConfig(options.network);
  return {
    defaultHeaders: buildCliYCodeSourceHeaders(env, options),
    env,
    ...(network ? { network } : {}),
  };
}

function normalizeAiSdkNetworkConfig(
  network: AiSdkNetworkConfig | undefined,
): AiSdkNetworkConfig | undefined {
  if (!network?.caCertFile && !network?.httpProxy && !network?.noProxy) return undefined;
  return {
    ...(network.caCertFile ? { caCertFile: network.caCertFile } : {}),
    ...(network.httpProxy ? { httpProxy: network.httpProxy } : {}),
    ...(network.noProxy ? { noProxy: network.noProxy } : {}),
  };
}

function buildCliYCodeSourceHeaders(
  env: EnvRecord,
  options: Pick<RuntimeExecutionConfigOptions, "appVersion" | "sourceTitle"> = {},
): Record<string, string> {
  const sourceTitle = options.sourceTitle ?? detectDefaultProviderSourceTitle();
  const appVersion = resolveAppVersionForHeaders(env, options);
  const locale = normalizePrintableHeaderValue(Intl.DateTimeFormat().resolvedOptions().locale);
  const timezone = normalizePrintableHeaderValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return {
    "HTTP-Referer": resolveRuntimeYCodeEndpointOrigin(env),
    "User-Agent": `YCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-YCode-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    "X-Release-Channel": resolveRuntimeYCodeEnv(env),
    "X-Client-Language": locale ?? "unknown",
    "X-Client-Timezone": timezone ?? "unknown",
    "X-YCode-Agent": "glm",
    ...createRuntimePlatformHeaders(),
  };
}

function resolveAppVersionForHeaders(
  env: EnvRecord,
  options: Pick<RuntimeExecutionConfigOptions, "appVersion">,
): string | undefined {
  return normalizePrintableHeaderValue(env[YCODE_APP_VERSION_ENV] ?? options.appVersion);
}

function detectDefaultProviderSourceTitle(): ModelProviderSourceTitle {
  return process.argv.includes("app-server") || process.argv.includes("agent-server")
    ? "electron"
    : "cli";
}
