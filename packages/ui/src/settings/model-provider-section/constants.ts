import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";

/**
 * 供应商导航。
 *
 * 设置页只展示用户自己配置的供应商（`standard-personal`），已移除内置托管供应商，
 * 因此导航只有唯一分组，节点 key 也只由 providerId 派生。
 */
export function createCustomProviderNodeKey(providerId: string): string {
  return `custom:${providerId}`;
}

export interface ModelProviderNavItem {
  key: string;
  label: string;
  provider: ProviderSettingsFormProvider;
}

export interface ModelProviderNavGroup {
  /** React key 与分组标题的稳定标识。 */
  id: "custom";
  title: string;
  items: ModelProviderNavItem[];
}
