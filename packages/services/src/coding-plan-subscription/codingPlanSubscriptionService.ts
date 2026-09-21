import type { ApiClient } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/provider";
import type { ICodingPlanSubscriptionService } from "./codingPlanSubscription.js";
import { BigModelCodingPlanSubscriptionProvider } from "./bigmodelCodingPlanSubscriptionProvider.js";

interface CodingPlanSubscriptionServiceDependencies {
  apiClient: ApiClient;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

/**
 * 订阅服务购买面（batchPreview/staticProducts/preview/Stripe/PayPal/企业订单等）
 * 已随官方 Coding Plan 供应商下线移除。service 只保留真实功能仍消费的
 * client/configs 读路径：offpeak 闲时任务与 dynamic workflow 灰度。
 * 两者均为平台级配置，与 provider family 无关，统一委托 BigModel provider。
 */
export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies,
): ICodingPlanSubscriptionService {
  const provider = new BigModelCodingPlanSubscriptionProvider(dependencies);

  return {
    getOffPeakClientConfig: (options) => provider.getOffPeakClientConfig(options),
    getDynamicWorkflowClientConfig: (options) => provider.getDynamicWorkflowClientConfig(options),
  };
}
