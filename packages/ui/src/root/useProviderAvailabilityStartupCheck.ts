import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelSelectionView } from "@zcode/services";
import { resolveProviderAvailabilityState } from "@/lib/modelProviderAvailability.js";
import { logger } from "@/logger.js";

interface ProviderAvailabilityStartupCheckResult {
  hasUsableProvider: boolean;
  providerCount: number;
}

/**
 * 启动期 Provider 可用性检查。
 *
 * 原实现叫「登录入口守卫」：未登录且没有可用 Provider 时强制打开登录页。账号体系移除后
 * 登录入口不复存在，这里只保留可用性计算与启动门禁完成信号——Root 依赖它决定是否可以
 * 继续恢复工作区会话，避免在模型配置就绪前启动 ZCode session。
 */
export function useProviderAvailabilityStartupCheck({
  providerFamilyDomain,
  modelSelectionView,
  modelSelectionError,
  refreshProviderState,
  readModelSelectionView,
}: {
  providerFamilyDomain: string | null | undefined;
  modelSelectionView: ModelSelectionView | null;
  modelSelectionError?: Error;
  refreshProviderState: () => Promise<void>;
  readModelSelectionView: () => Promise<ModelSelectionView>;
}) {
  const [startupCheckCompleted, setStartupCheckCompleted] = useState(false);
  const startupCheckCompletedRef = useRef(false);
  const providerAvailabilityHydrated = modelSelectionView !== null;

  const runStartupCheck = useCallback(
    async (options: { forceRefresh?: boolean; reason: string }) => {
      if (options.forceRefresh) {
        await refreshProviderState();
      }

      const refreshedView = options.forceRefresh
        ? await readModelSelectionView()
        : modelSelectionView;
      const availability = resolveProviderAvailabilityState({ modelSelectionView: refreshedView });
      const { hasUsableProvider, providerCount } = availability;

      logger.info("[Root] provider 可用性启动检查完成", {
        reason: options.reason,
        source: availability.source,
        providerCount,
        hasUsableProvider,
        hasProviderFamilyDomain: Boolean(providerFamilyDomain),
      });
      return { hasUsableProvider, providerCount } satisfies ProviderAvailabilityStartupCheckResult;
    },
    [modelSelectionView, providerFamilyDomain, refreshProviderState, readModelSelectionView],
  );

  useEffect(() => {
    if (modelSelectionError) {
      // 首次读取失败不能伪装成“没有 Provider”，也不能让启动门禁永久停在 loading。
      logger.error("[Root] provider 可用性读取失败，结束启动门禁等待", modelSelectionError);
      startupCheckCompletedRef.current = true;
      setStartupCheckCompleted(true);
      return;
    }

    if (startupCheckCompletedRef.current || !providerAvailabilityHydrated) {
      return;
    }

    startupCheckCompletedRef.current = true;
    void runStartupCheck({ reason: "startup" }).finally(() => {
      setStartupCheckCompleted(true);
    });
  }, [modelSelectionError, providerAvailabilityHydrated, runStartupCheck]);

  return {
    startupCheckCompleted,
    runStartupCheck,
  };
}
