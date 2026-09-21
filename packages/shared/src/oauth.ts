/**
 * 账号凭据领域类型定义
 *
 * YCode 已移除内置官方 OAuth 供应商（Z.ai / BigModel）与整条 OAuth 登录链路，
 * 这里不再保留登录流程类型（provider 元信息、authorize/token 交换、回调归一化、
 * 会话恢复）。剩余内容只服务两类保留方：
 * - provider 家族与账号 provider 的 id / 凭据结构（model-provider 域消费）
 * - 凭据解密失败的稳定错误码（credentialService 与凭据仓储消费）
 *
 * 说明：敏感信息（如 appSecret）以及 provider 默认端点配置
 * 只允许放在 services 的 provider 模块中，不能放 shared 层。
 */

/** 内置 BigModel provider id */
export const BIGMODEL_PROVIDER_ID = "bigmodel" as const;

/** 内置 ZAI provider id */
export const ZAI_PROVIDER_ID = "zai" as const;

/** 凭据解密失败错误前缀 */
export const CREDENTIAL_DECRYPT_ERROR_PREFIX = "凭据解密失败：" as const;

/** 凭据解密失败稳定错误码 */
export const CREDENTIAL_DECRYPT_ERROR_CODE = "ZCODE_CREDENTIAL_DECRYPT_FAILED" as const;

/** 判断错误是否来自本地凭据解密失败 */
export function isCredentialDecryptError(error: unknown): boolean {
  const code = readCredentialErrorCode(error);
  if (code) {
    return code === CREDENTIAL_DECRYPT_ERROR_CODE;
  }

  // 兼容历史错误和跨边界丢失 code 的旧 payload；新错误应优先携带稳定 code。
  if (readCredentialErrorMessage(error).startsWith(CREDENTIAL_DECRYPT_ERROR_PREFIX)) {
    return true;
  }

  return false;
}

function readCredentialErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }

  return "";
}

function readCredentialErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return "";
}

/** OAuth provider 标识 */
export type OAuthProviderId =
  | typeof BIGMODEL_PROVIDER_ID
  | typeof ZAI_PROVIDER_ID
  | (string & { readonly __oauthProviderBrand?: never });

/**
 * Main 进程路由 deep link 时使用的 state 上报结构。
 *
 * 保留原因：Desktop Main 的 deep link 路由（workspace / payment / share import 与
 * OAuth 回调共用一条 URL 路由）仍按该结构接收 Renderer 上报，跨端通道类型随之保留。
 */
export interface OAuthStateRegistration {
  state: string;
  provider?: OAuthProviderId;
}

/** OAuth 登录归因参数：来自官网中转页或投放链接 */
export interface OAuthLoginAttribution {
  channel_id?: string;
  utm_source?: string;
  utm_campaign?: string;
}

/** 归一化 token 结构 */
export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  zcodeJwtToken?: string;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

/** Host 在检测到 ZCode JWT 失效后通知 Renderer 展示确认并重启。 */
export const ZCODE_JWT_INVALID_BROADCAST_CHANNEL = "auth:zcode-jwt-invalid";

/** 归一化用户信息 */
export interface OAuthUserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  rawProfile?: unknown;
}
