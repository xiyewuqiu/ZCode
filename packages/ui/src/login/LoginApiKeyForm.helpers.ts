import {
  BUILTIN_PROVIDER_TEMPLATE_IDS,
  type AppSettings,
  type Locale,
  type ProviderFamilyDomain,
} from "@zcode/shared";
import { resolveProviderTemplateName, type ProviderSettingsTemplateView } from "@zcode/provider";
import type { ModelSelectionView } from "@zcode/services";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

/** API Key 登录的 provider 选择 = providerTemplates 中的 templateId（运行时驱动，不再写死 zai/bigmodel）。 */
export type ApiKeyProviderChoice = string;

/**
 * 筛选可用于 API Key 登录的模板：access.type 为 "api-key"。
 * 排除 OAuth/账号型模板与 coding-plan key（zhipu-coding-plan-api-key），
 * 登录面板的 API Key 下拉与“跳过”默认选择共用这一事实源。
 */
export function selectLoginApiKeyProviderTemplates(
  templates: readonly ProviderSettingsTemplateView[],
): readonly ProviderSettingsTemplateView[] {
  return templates.filter((template) => template.config.access?.type === "api-key");
}

export function resolveLoginApiKeyDefaultProvider(
  templates: readonly ProviderSettingsTemplateView[],
): ApiKeyProviderChoice | null {
  return selectLoginApiKeyProviderTemplates(templates)[0]?.templateId ?? null;
}

export function resolveLoginApiKeyProviderLabel(
  choice: ApiKeyProviderChoice | null,
  templateNameMap: ProviderSettingsTemplateView["templateNameMap"] | null | undefined,
  locale: Locale,
): string {
  if (!choice) {
    return "";
  }
  // 品牌名跟随模板自身的 nameMap 与当前 locale；模板丢失时退回 templateId。
  if (templateNameMap) {
    return resolveProviderTemplateName(choice, { templateNameMap }, locale);
  }
  return choice;
}

function resolveLoginApiKeyProviderFamilyDomain(
  choice: ApiKeyProviderChoice | null,
): ProviderFamilyDomain | null {
  // providerFamilyDomain 的类型边界只有 zai/bigmodel 两个 family（shared 层定义）。
  // 运行时模板列表不再保证是内置 family 模板：仅当所选模板是内置 family 模板时
  // 才写出合法 domain；第三方模板没有 family 边界可固定，跳过只落“已迁移”标记。
  if (choice === BUILTIN_PROVIDER_TEMPLATE_IDS.zai) {
    return "zai";
  }
  if (choice === BUILTIN_PROVIDER_TEMPLATE_IDS.bigmodel) {
    return "bigmodel";
  }
  return null;
}

export function buildLoginApiKeySkipSettings(
  choice: ApiKeyProviderChoice | null,
  now: number,
): Pick<
  AppSettings,
  "providerFamilyDomain" | "providerFamilyDomainUpdatedAt" | "providerFamilyDomainMigrated"
> {
  const domain = resolveLoginApiKeyProviderFamilyDomain(choice);
  return {
    ...(domain ? { providerFamilyDomain: domain } : {}),
    providerFamilyDomainUpdatedAt: now,
    providerFamilyDomainMigrated: true,
  };
}

export function shouldShowLoginApiKeyLink(
  apiKeyValue: string,
  apiKeyUrl: string | undefined,
): boolean {
  return Boolean(apiKeyUrl) && apiKeyValue.trim().length === 0;
}

export function buildLoginApiKeyDefaultModelPreferenceFromSelection(
  view: ModelSelectionView,
  providerId: string,
): string | null {
  const firstModel = view.providers.find((provider) => provider.providerId === providerId)
    ?.models[0]?.modelId;
  return firstModel ? encodeCustomModelValue(providerId, firstModel) : null;
}
