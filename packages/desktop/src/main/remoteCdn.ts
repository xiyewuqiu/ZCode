import { YCODE_VERSION, type YCodeEnv } from "@ycode/shared";

declare const __YCODE_CDN_BASE_URL__: string | undefined;
const DEFAULT_CDN_BASE_URL = "https://cdn-ycode.z.ai";

export interface ResolveRemoteCdnOptions {
  env?: YCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl =
    process.env.YCODE_CDN_BASE_URL?.trim() ||
    (typeof __YCODE_CDN_BASE_URL__ === "undefined" ? "" : __YCODE_CDN_BASE_URL__) ||
    DEFAULT_CDN_BASE_URL;
  return [
    `${normalizeBaseUrl(baseUrl)}/ycode/electron/releases/${options.version ?? YCODE_VERSION}`,
  ];
}
