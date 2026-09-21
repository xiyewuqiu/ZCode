import type { ICredentialService } from "#src/credential/credential.js";

/**
 * 判定候选请求是否使用当前 OAuth 会话凭据。
 *
 * YCode 已移除内置官方 OAuth 供应商（Z.ai / BigModel）：原先按 provider userinfo /
 * customerInfo 接口识别的分支随 provider 一并下线，这里只按共享 zcode JWT 识别当前会话请求。
 * 实际退出仍须由 OAuthService 在会话变更队列内复核，不能依赖异步旧快照。
 */
export async function isCurrentOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const authorization = options.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return false;
  const currentJwt = (await options.credentialService.load("zcodejwttoken"))?.trim() ?? "";
  return Boolean(currentJwt) && authorization === `Bearer ${currentJwt}`;
}
