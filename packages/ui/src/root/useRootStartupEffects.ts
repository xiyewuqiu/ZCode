import { useEffect } from "react";
import type { IPlatformService } from "@zcode/shared";
import { logger } from "@/logger.js";

/**
 * 根层启动 effect。
 *
 * 账号体系移除后，这里不再有登录态落定、JWT 失效广播与重新认证提示，只保留两件
 * 仍然成立的事：
 * 1. 启动时刷新一次 Provider Runtime（模型供应商配置完全由本地用户配置驱动）；
 * 2. 通知 Main 进程 RendererReady，让冷启动 deep link（workspace / share import）可投递。
 */
export function useRootStartupEffects({
  platform,
  refreshProviderState,
}: {
  platform: IPlatformService;
  refreshProviderState: () => Promise<void>;
}) {
  useEffect(() => {
    // 启动刷新失败不能跳过后续订阅，否则配置变更后的 Provider View 更新会永久停止。
    // 保留当前事实，不另起重试循环。
    void refreshProviderState().catch((error: unknown) => {
      logger.warn("[Root] 启动 Provider 配置刷新失败，继续观察后续更新", { error });
    });
  }, [refreshProviderState]);

  useEffect(() => {
    // Main 进程用 RendererReady 投递冷启动 deep link；与账号链路无关，必须保留。
    platform.notifyRendererReady();
  }, [platform]);
}
