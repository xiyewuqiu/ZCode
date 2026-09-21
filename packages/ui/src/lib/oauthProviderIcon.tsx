import type { OAuthProviderId } from "@zcode/shared";
import { LogInIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

/**
 * OAuth 渠道图标。
 *
 * YCode 不再内置官方 OAuth 供应商（Z.ai / BigModel），当前没有渠道专属品牌图标，
 * 统一回退到登录图标；后续接入通用登录渠道时在此登记。
 */
export function renderOAuthProviderIcon(_provider: OAuthProviderId, className?: string) {
  return <LogInIcon className={cn("shrink-0", className)} />;
}
