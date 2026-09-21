import type { OAuthProviderId, OAuthUserProfile } from "@zcode/shared";

/**
 * 兼容历史 provider profile schema 的入口。
 *
 * YCode 已移除内置官方 OAuth 供应商（Z.ai / BigModel）：BigModel 旧缓存的 schema
 * 版本迁移随 provider 一并下线，这里保留统一入口，当前对任何 provider 都原样返回。
 */
export function withProviderProfileSchema(
  _provider: OAuthProviderId,
  profile: OAuthUserProfile,
): OAuthUserProfile {
  return profile;
}
