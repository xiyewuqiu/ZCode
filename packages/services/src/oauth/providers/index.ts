import type { ApiClient } from "@zcode/shared";
import type { OAuthRuntimeConfig } from "../runtimeConfig.js";
import type { OAuthProviderAdapter } from "./providerAdapter.js";

/**
 * 根据运行时配置创建可用 provider adapter。
 *
 * YCode 不再内置官方 OAuth 供应商（Z.ai / BigModel）：运行时配置里没有任何 provider，
 * 这里保留注册入口而不注册 adapter。后续接入通用登录渠道时，在此按 config.providers
 * 构造对应 adapter，未知 provider 仍应忽略，避免单个配置错误拖垮全部登录能力。
 */
export function createOAuthProviderAdapters(
  _config: OAuthRuntimeConfig,
  _options: { apiClient?: ApiClient } = {},
): OAuthProviderAdapter[] {
  return [];
}

export type { OAuthProviderAdapter, OAuthProviderContext } from "./providerAdapter.js";
