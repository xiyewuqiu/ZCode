/**
 * Provider 身份的类型边界。
 *
 * `builtin:*` / `account:*` 与 `zai-api` / `bigmodel-api` 是**已发布数据的固定身份**，不再由任何
 * 配置声明：ZCode Built-in Config 的 `providerRules` 为空，Personal Provider 走
 * `standard-personal`，官方账号能力改为用户自建 Provider 的 `zhipu-account` Access。
 * 因此下面这些 ID 只允许出现在读取/迁移/归一旧数据的路径上（单向升级表、旧会话 SQL 迁移、
 * 旧遥测身份），不能用来判定或构造当前 Provider。
 */
export const BUILTIN_PROVIDER_TEMPLATE_IDS = {
  zai: "zai-api",
  bigmodel: "bigmodel-api",
} as const;

export const BUILTIN_MODEL_PROVIDER_IDS = {
  zaiIndividualCodingPlan: "account:zai-individual-coding-plan",
  zaiTeamCodingPlan: "account:zai-team-coding-plan",
  zaiStartPlan: "account:zai-start-plan",
  bigmodelIndividualCodingPlan: "account:bigmodel-individual-coding-plan",
  bigmodelTeamCodingPlan: "account:bigmodel-team-coding-plan",
  bigmodelStartPlan: "account:bigmodel-start-plan",
} as const;

export type BuiltinOAuthProviderId = keyof typeof BUILTIN_MODEL_PROVIDER_IDS;

export type BuiltinModelProviderId = (typeof BUILTIN_MODEL_PROVIDER_IDS)[BuiltinOAuthProviderId];

export function isBuiltinModelProviderId(id: string): id is BuiltinModelProviderId {
  return (
    id === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
    id === BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan ||
    id === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan ||
    id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
    id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan ||
    id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  );
}

export function isStartPlanModelProviderId(id: string): boolean {
  return (
    id === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan ||
    id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  );
}

/**
 * 账号型 Provider 的 Family Domain。
 *
 * 描述的是**用户账号**属于哪个家族（登录态、账号连接选择、Family 可用性查询按它分派），
 * 而不是某个内置 Provider：官方内置 Provider 下线不影响它，Z.ai / BigModel 账号登录与
 * Coding Plan 仍是现行能力，只是承载它们的 Provider 由用户自己配置。
 */
export type ProviderFamilyDomain = "zai" | "bigmodel";

/** 把已持久化的设置值收窄成 Domain；空串（清除）与未知值都表示"未选择"。 */
export function normalizeProviderFamilyDomain(
  value: string | null | undefined,
): ProviderFamilyDomain | null {
  return value === "zai" || value === "bigmodel" ? value : null;
}

/** 一个正式 Model 的连通性测试结果。 */
export type ModelConnectivityResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly error: {
        readonly message: string;
        /** 设置连接测试边界已确认的资格失败；其他执行错误保留原消息。 */
        readonly code?: "provider-unavailable" | "model-unavailable";
      };
    };
