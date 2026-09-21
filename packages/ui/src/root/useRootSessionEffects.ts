/* eslint-disable max-lines -- 启动登录态落定与 JWT 失效提示共享一个协调点，避免拆散后时序漂移。 */
import { useEffect } from "react";
import type { IPlatformService, UserInfo } from "@zcode/shared";
import { DesktopCommandIds, ZCODE_JWT_INVALID_BROADCAST_CHANNEL } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { useAlertDialog } from "@/hooks/useAlertDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { markZcodeJwtInvalidRestart } from "@/root/zcodeJwtInvalidRestartMarker.js";

/**
 * 登录会话相关的根层 effect。
 *
 * YCode 已移除 OAuth 登录链路（无内置官方供应商，登录只走 API Key provider），
 * 因此这里不再有会话恢复、轮询与 deep link 回调，只保留两件仍然成立的事：
 * 1. 启动时落定“无账号会话”这一事实，并解除由 isRestoringOAuthSession 承载的启动门禁；
 * 2. 收到 Host 的 ZCode JWT 失效广播时给出重新认证提示（session-expired 降级）。
 */
export function useRootSessionEffects({
  platform,
  services,
  refreshProviderState,
  setUser,
  setIsRestoringOAuthSession,
  onReauthenticationRequired,
}: {
  platform: IPlatformService;
  services: IServiceAccessor;
  refreshProviderState: () => Promise<void>;
  setUser: (user: UserInfo | null) => void;
  setIsRestoringOAuthSession: (restoring: boolean) => void;
  onReauthenticationRequired: () => void;
}) {
  const requestAlert = useAlertDialog();
  const { intl } = useZCodeIntl();

  useEffect(() => {
    let disposed = false;
    async function settleStartupAuthState() {
      // 没有账号会话可恢复：先落定“未登录”事实，再刷新 Provider Runtime。
      // 未登录不代表不能用，用户配置的 API Key provider 由 Provider Registry 提供模型。
      if (!disposed) {
        setUser(null);
      }
      // 启动门禁以 isRestoringOAuthSession 为输入，必须显式落定，否则首屏会一直停在恢复中。
      setIsRestoringOAuthSession(false);

      try {
        await refreshProviderState();
      } catch (error) {
        // 启动刷新失败不能跳过后续订阅，否则网络恢复后账号失效协调也永久停止。
        // 保留当前事实，继续由 Provider View 的正常更新驱动，不另起重试循环。
        logger.warn("[Root] 启动账号配置刷新失败，继续观察后续更新", { error });
      }
    }

    void settleStartupAuthState();

    return () => {
      disposed = true;
    };
  }, [refreshProviderState, setIsRestoringOAuthSession, setUser]);

  useEffect(() => {
    let disposed = false;
    const disposable = services.broadcastService.onMessage((message) => {
      if (message.channel !== ZCODE_JWT_INVALID_BROADCAST_CHANNEL || disposed) {
        return;
      }
      void (async () => {
        const confirmed = await requestAlert({
          title: intl.formatMessage({ id: "login.expired.title" }),
          description: intl.formatMessage({ id: "login.expired.description" }),
          actionLabel: intl.formatMessage({ id: "login.expired.restart" }),
        });
        if (disposed) {
          return;
        }
        if (!confirmed) {
          onReauthenticationRequired();
          return;
        }
        markZcodeJwtInvalidRestart();
        if (typeof window !== "undefined" && !("zcode" in window)) {
          // Web 没有 Electron RelaunchApp；marker 写入后立即刷新，避免停留在僵尸登录态。
          window.location.reload();
          return;
        }
        await platform.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
      })();
    });
    return () => {
      disposed = true;
      disposable.dispose();
    };
  }, [intl, onReauthenticationRequired, platform, requestAlert, services.broadcastService]);

  useEffect(() => {
    // Main 进程用 RendererReady 投递冷启动 deep link（workspace / share import 等）；
    // 这里必须保持上报，不能随登录链路一并移除。
    platform.notifyRendererReady();
  }, [platform]);
}
