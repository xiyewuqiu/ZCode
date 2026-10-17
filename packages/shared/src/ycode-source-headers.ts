import { DEFAULT_YCODE_ENDPOINT_ORIGIN } from "./ycodeEndpoint.js";

export const YCODE_SOURCE_HEADERS = {
  "User-Agent": "YCode/unknown",
  "HTTP-Referer": DEFAULT_YCODE_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildYCodeSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeYCodeSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildYCodeSourceHeadersFromContext(
  options: BuildYCodeSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeYCodeSourceHeaderValue(options.appVersion);
  const arch = normalizeYCodeSourceHeaderValue(options.arch);
  const clientLanguage = normalizeYCodeSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeYCodeSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeYCodeSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeYCodeSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_YCODE_ENDPOINT_ORIGIN;
  const osVersion = normalizeYCodeSourceHeaderValue(options.osVersion);
  const platform = normalizeYCodeSourceHeaderValue(options.platform);
  const releaseChannel = normalizeYCodeSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeYCodeSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...YCODE_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `YCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-YCode-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
