import type { YCodeEnv } from "./env.js";

export const DEFAULT_YCODE_ENDPOINT_ORIGIN = "https://ycode.z.ai";
export const DEFAULT_BIGMODEL_API_ORIGIN = "https://bigmodel.cn";
export const DEFAULT_ZAI_BUSINESS_BASE_URL = "https://api.z.ai";

// 构建仅注入公开链接；Node 调用方仍可显式传 env，避免读取另一进程的配置。
declare const __YCODE_ENDPOINT_ENV__: Record<string, string | undefined> | undefined;
export function pickProductEndpointEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const keys = [
    "YCODE_BASE_URL",
    "YCODE_ENDPOINT_ORIGIN",
    "BIGMODEL_API_BASE_URL",
    "ZAI_BUSINESS_BASE_URL",
  ];
  return Object.fromEntries(
    keys.flatMap((key) => (env[key]?.trim() ? [[key, env[key]!.trim()]] : [])),
  );
}
export function readProductEndpointEnv(): Record<string, string | undefined> {
  return {
    ...(typeof __YCODE_ENDPOINT_ENV__ === "undefined" ? {} : __YCODE_ENDPOINT_ENV__),
    ...pickProductEndpointEnv(typeof process === "undefined" ? {} : process.env),
  };
}

export interface YCodeEndpointUrls {
  origin: string;
  apiBaseUrl: string;
  webShareCallbackUrl: string;
  ycodePlanOpenAiBaseUrl: string;
  ycodePlanAnthropicBaseUrl: string;
  ycodePlanBillingCurrentUrl: string;
  ycodePlanBillingBalanceUrl: string;
}

export interface RuntimeYCodeEndpointEnv {
  [key: string]: string | undefined;
  YCODE_ENV?: string;
  YCODE_BASE_URL?: string;
  YCODE_ENDPOINT_ORIGIN?: string;
}

export interface RuntimeBigModelApiEnv {
  [key: string]: string | undefined;
  YCODE_ENV?: string;
  BIGMODEL_API_BASE_URL?: string;
}

export interface RuntimeZaiEndpointEnv {
  [key: string]: string | undefined;
  YCODE_ENV?: string;
  ZAI_BUSINESS_BASE_URL?: string;
}

export interface RuntimeProductEndpointEnv
  extends RuntimeYCodeEndpointEnv, RuntimeBigModelApiEnv, RuntimeZaiEndpointEnv {}

export interface RuntimeProductEndpointConfig {
  ycodeEnv: YCodeEnv;
  ycodeEndpointOrigin: string;
  ycodeEndpointUrls: YCodeEndpointUrls;
  zaiBusinessBaseUrl: string;
  bigModelApiOrigin: string;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeYCodeEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("YCode endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("YCode endpoint origin must use http or https");
  }
  return parsed.origin;
}

export function resolveYCodeEndpointOrigin(options?: {
  env?: YCodeEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const origin = options?.overrideOrigin?.trim() || options?.envBaseOrigin?.trim();
  return origin ? normalizeYCodeEndpointOrigin(origin) : DEFAULT_YCODE_ENDPOINT_ORIGIN;
}

export function resolveRuntimeYCodeEnv(
  env: RuntimeYCodeEndpointEnv = readProductEndpointEnv(),
): YCodeEnv {
  // 产品身份仅用于既有展示与安装标识，不参与地址解析。
  return env.YCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeYCodeEndpointOrigin(
  env: RuntimeYCodeEndpointEnv = readProductEndpointEnv(),
  options?: { overrideOrigin?: string | null },
): string {
  return resolveYCodeEndpointOrigin({
    envBaseOrigin:
      readRuntimeEnvValue(env, "YCODE_BASE_URL") ??
      readRuntimeEnvValue(env, "YCODE_ENDPOINT_ORIGIN"),
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeYCodeEndpointUrls(
  env: RuntimeYCodeEndpointEnv = readProductEndpointEnv(),
): YCodeEndpointUrls {
  return buildYCodeEndpointUrls(resolveRuntimeYCodeEndpointOrigin(env));
}

export function buildRuntimeYCodeApiUrl(
  env: RuntimeYCodeEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeYCodeEndpointOrigin(env)}${normalizedPath}`;
}

export function resolveBigModelApiOrigin(
  env: RuntimeBigModelApiEnv = readProductEndpointEnv(),
): string {
  return normalizeYCodeEndpointOrigin(
    readRuntimeEnvValue(env, "BIGMODEL_API_BASE_URL") ?? DEFAULT_BIGMODEL_API_ORIGIN,
  );
}

export function buildBigModelApiUrl(
  env: RuntimeBigModelApiEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveBigModelApiOrigin(env)}${normalizedPath}`;
}

export function resolveZaiBusinessBaseUrl(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
): string {
  return normalizeYCodeEndpointOrigin(
    readRuntimeEnvValue(env, "ZAI_BUSINESS_BASE_URL") ?? DEFAULT_ZAI_BUSINESS_BASE_URL,
  );
}

export function buildRuntimeZaiBusinessUrl(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveZaiBusinessBaseUrl(env)}${normalizedPath}`;
}

export function resolveRuntimeProductEndpointConfig(
  env: RuntimeProductEndpointEnv = readProductEndpointEnv(),
): RuntimeProductEndpointConfig {
  const ycodeEnv = resolveRuntimeYCodeEnv(env);
  const ycodeEndpointOrigin = resolveRuntimeYCodeEndpointOrigin(env);

  return {
    ycodeEnv,
    ycodeEndpointOrigin,
    ycodeEndpointUrls: buildYCodeEndpointUrls(ycodeEndpointOrigin),
    zaiBusinessBaseUrl: resolveZaiBusinessBaseUrl(env),
    bigModelApiOrigin: resolveBigModelApiOrigin(env),
  };
}

export function buildYCodeEndpointUrls(origin: string): YCodeEndpointUrls {
  const normalizedOrigin = normalizeYCodeEndpointOrigin(origin);
  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
    webShareCallbackUrl: `${normalizedOrigin}/cn/share/callback`,
    ycodePlanOpenAiBaseUrl: `${normalizedOrigin}/api/v1/ycode-plan`,
    ycodePlanAnthropicBaseUrl: `${normalizedOrigin}/api/v1/ycode-plan/anthropic`,
    ycodePlanBillingCurrentUrl: `${normalizedOrigin}/api/v1/ycode-plan/billing/current`,
    ycodePlanBillingBalanceUrl: `${normalizedOrigin}/api/v1/ycode-plan/billing/balance`,
  };
}

export function rewriteYCodeEndpointUrl(input: string | URL, endpointOrigin: string): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_YCODE_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeYCodeEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
