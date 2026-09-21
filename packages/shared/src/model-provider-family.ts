import { BIGMODEL_PROVIDER_ID, type OAuthProviderId, ZAI_PROVIDER_ID } from "./oauth.js";
import { BUILTIN_MODEL_PROVIDER_IDS } from "./model-provider-types.js";

/**
 * 历史内置供应商家族 ID。
 *
 * YCode 已移除内置官方供应商（Z.ai / BigModel），家族不再指向任何内置 provider；
 * 这里保留类型与查询函数，仅用于兼容旧配置读取和历史调用方（会话统计、账号连接恢复等仍按 family 取值）。
 */
export type ModelProviderFamilyId = "zai" | "bigmodel";
export type ProviderFamilyDomain = ModelProviderFamilyId;

/**
 * 家族定义。
 *
 * provider id 保持字面量联合类型（承重墙）：历史调用方依赖这些字面量做 Record 索引与类型收窄，
 * 不能在移除官方供应商时放宽成 string。
 */
export interface ModelProviderFamilySpec {
  id: ModelProviderFamilyId;
  label: string;
  rootDomain: string;
  oauthProviderId: typeof ZAI_PROVIDER_ID | typeof BIGMODEL_PROVIDER_ID;
  startPlanProviderId:
    | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan
    | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
  individualCodingPlanProviderId:
    | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
    | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
  teamCodingPlanProviderId:
    | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan
    | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
  teamCodingPlanManageUrl: string;
}

/**
 * 内置官方供应商家族列表。
 *
 * YCode 不再内置 Z.ai / BigModel，这里保持为空：任何依赖 family 的展示逻辑
 * 都会自然得到空集合，不再产出官方供应商入口。
 */
export const MODEL_PROVIDER_FAMILY_SPECS: readonly ModelProviderFamilySpec[] = [];

/**
 * 空语义 family spec。
 *
 * 部分历史调用方（会话统计、模型分组、账号连接恢复等）仍会按 family 取 spec 后直接读取字段，
 * 因此查询函数不能返回 undefined。占位对象不携带展示名与官方 URL，
 * provider id 保持空字符串，不会让官方供应商重新出现在界面上。
 */
function createEmptyModelProviderFamilySpec(
  familyId: ModelProviderFamilyId,
): ModelProviderFamilySpec {
  return {
    id: familyId,
    label: "",
    rootDomain: "",
    oauthProviderId: familyId === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID,
    startPlanProviderId: "",
    individualCodingPlanProviderId: "",
    teamCodingPlanProviderId: "",
    teamCodingPlanManageUrl: "",
  } as unknown as ModelProviderFamilySpec;
}

export function getModelProviderFamilySpec(
  familyId: ModelProviderFamilyId,
): ModelProviderFamilySpec {
  return createEmptyModelProviderFamilySpec(familyId);
}

export function resolveModelProviderFamilyIdByProviderId(
  _providerId: string,
): ModelProviderFamilyId | null {
  return null;
}

export function resolveModelProviderFamilyIdByBaseURL(
  _baseURL: string | null | undefined,
): ModelProviderFamilyId | null {
  return null;
}

export function resolveModelProviderFamilySpecByProviderId(
  _providerId: string,
): ModelProviderFamilySpec | null {
  return null;
}

export function resolveModelProviderFamilyLabelByProviderId(_providerId: string): string | null {
  return null;
}

export function normalizeProviderFamilyDomain(
  _value: string | null | undefined,
): ProviderFamilyDomain | null {
  return null;
}

export function resolveProviderFamilyDomainFromOAuthProvider(
  _provider: OAuthProviderId | string | null | undefined,
): ProviderFamilyDomain | null {
  return null;
}

export function shouldShowModelProviderFamilyForDomain(_params: {
  familyId: ModelProviderFamilyId;
  providerFamilyDomain: ProviderFamilyDomain | null | undefined;
}): boolean {
  // family 不再指向内置供应商，展示门禁按“不过滤”处理，避免误隐藏用户自建供应商。
  return true;
}

export function shouldShowModelProviderFamilyForActiveOAuth(_params: {
  familyId: ModelProviderFamilyId;
  activeOAuthProvider: OAuthProviderId | null | undefined;
}): boolean {
  return true;
}

export function shouldShowBuiltinModelProviderForDomain(_params: {
  providerId: string;
  providerFamilyDomain: ProviderFamilyDomain | null | undefined;
}): boolean {
  return true;
}

export function shouldShowBuiltinModelProviderForActiveOAuth(_params: {
  providerId: string;
  activeOAuthProvider: OAuthProviderId | null | undefined;
}): boolean {
  return true;
}
