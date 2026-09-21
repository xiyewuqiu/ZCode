import type { BuiltinModelProviderId, UsageEntitlementSnapshot } from "@zcode/shared";
import {
  getProviderFormLabel,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";

/**
 * 历史官方 Coding Plan provider id 类型。
 *
 * YCode 已移除内置官方供应商（Z.ai / BigModel Coding Plan），设置页不再生成对应入口；
 * 该类型只保留给仍按 provider id 查询权益的历史调用方使用。
 */
export type CodingPlanProviderId = BuiltinModelProviderId;

/** 权益查询状态：设置页不再消费，兼容仍读取套餐快照的调用方。 */
export interface CodingPlanEntitlementState {
  snapshot: UsageEntitlementSnapshot | null;
  loading: boolean;
  error: string | null;
}

/**
 * 供应商显示名。
 *
 * 官方供应商已移除固定显示名规则，统一使用用户配置的名称，缺省回退 providerId。
 */
export function resolveModelProviderDisplayName(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "providerName">,
): string {
  return getProviderFormLabel(provider);
}

export type ModelProviderNavItem = {
  key: string;
  type: "custom";
  label: string;
  provider: ProviderSettingsFormProvider;
  statusActive: boolean;
};

export type ModelProviderNavGroupId = "custom";

export interface ModelProviderNavGroup {
  id: ModelProviderNavGroupId;
  title: string;
  items: ModelProviderNavItem[];
}
