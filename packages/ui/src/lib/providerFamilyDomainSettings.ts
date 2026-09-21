import type { ISettingService } from "@zcode/services";
import {
  type ProviderFamilyConnectionSelectionSettings,
  type ProviderFamilyDomain,
} from "@zcode/shared";

export function resolveLogoutProviderFamilyDomain(params: {
  currentDomain: ProviderFamilyDomain | null | undefined;
}): ProviderFamilyDomain | null {
  void params;
  return null;
}

/**
 * 写入历史 provider family 偏好。
 *
 * YCode 已移除内置官方供应商，family 不再指向任何内置 provider；
 * 保留写入是为了兼容仍按该字段读取的旧配置，值本身不再驱动官方入口展示。
 */
export async function setProviderFamilyDomain(
  settingService: Pick<ISettingService, "get" | "update">,
  domain: ProviderFamilyDomain,
): Promise<void> {
  const currentSettings = await settingService.get();
  await settingService.update({
    providerFamilyDomain: domain,
    providerFamilyDomainUpdatedAt: Date.now(),
    providerFamilyDomainMigrated: true,
    // WelcomeScreen OAuth 登录表示用户选择的是同 family 的 Coding Plan/OAuth 模式。
    // 只写 providerFamilyDomain 会保留之前 API Key 入口写入的 apiKey mode，导致登录成功后仍停在 API Key。
    providerFamilyConnectionSelections: buildOAuthProviderFamilySelections(
      domain,
      currentSettings.providerFamilyConnectionSelections,
    ),
  });
}

function buildOAuthProviderFamilySelections(
  domain: ProviderFamilyDomain,
  currentSelections: ProviderFamilyConnectionSelectionSettings | null | undefined,
): ProviderFamilyConnectionSelectionSettings {
  return {
    ...currentSelections,
    [domain]: { kind: "individual-coding-plan" },
  };
}
