/**
 * Coding Plan 订阅协议类型的存留面。
 * 购买闭环（preview/Stripe/PayPal/企业订单/静态目录等）已随官方 Coding Plan 供应商下线移除；
 * 这里只保留仍被真实功能消费的类型：
 *   - ForceUpdateConfig：shared/forceUpdate.ts 与 desktop forceUpdateGuard 的强更协议。
 *   - CODING_PLAN_SYSTEM_BUSY / CodingPlanUnavailableReason：client/configs 错误收敛与
 *     账号 provider 连接解析的不可用原因。
 */
export const CODING_PLAN_SYSTEM_BUSY = "coding_plan_system_busy" as const;

export type CodingPlanUnavailableReason = "not_authenticated" | "request_failed";

export interface ForceUpdateConfig {
  minimalVersion: string;
}
