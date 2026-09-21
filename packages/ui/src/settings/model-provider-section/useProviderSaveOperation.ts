import { useCallback, useRef } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderDetailFeedback } from "./ProviderDetailFeedback.js";

export interface ProviderSaveNotificationTarget {
  modelId?: string;
  operation?: "delete";
  /** 显式弹窗在原草稿中重试，不让外部通知另起一次脱离编辑事务的保存。 */
  draftOwnsRetry?: boolean;
}

/**
 * 供应商卡片的保存事务：一次写入对应一条 pending → 成功/失败反馈，并维护草稿代次。
 *
 * `draftRevisionRef` 与 `selfSaveRequestedRef` 是草稿与保存之间仅有的两份共享事实：
 * 前者让迟到的保存回包失效，后者让内部保存触发的刷新跳过卸载补保存。
 */
export function useProviderSaveOperation({
  providerId,
  providerDisplayName,
}: {
  providerId: string;
  providerDisplayName: string;
}) {
  const { intl } = useZCodeIntl();
  const { dismissFeedback, showFeedback } = useProviderDetailFeedback();
  const draftRevisionRef = useRef(0);
  const selfSaveRequestedRef = useRef(false);
  const saveNotificationRef = useRef({
    providerId,
    providerDisplayName,
    formatMessage: intl.formatMessage,
    dismissFeedback,
    showFeedback,
  });
  saveNotificationRef.current = {
    providerId,
    providerDisplayName,
    formatMessage: intl.formatMessage,
    dismissFeedback,
    showFeedback,
  };

  const dismissProviderSaveFeedback = useCallback(() => {
    dismissFeedback(`provider-save:${saveNotificationRef.current.providerId}`);
  }, [dismissFeedback]);

  const runSaveOperation = useCallback(
    async (operation: () => Promise<void>, target: ProviderSaveNotificationTarget = {}) => {
      selfSaveRequestedRef.current = true;
      const revision = draftRevisionRef.current + 1;
      draftRevisionRef.current = revision;
      const notification = saveNotificationRef.current;
      const dedupeKey = target.modelId
        ? `model-save:${notification.providerId}:${target.modelId}`
        : `provider-save:${notification.providerId}`;
      const messageValues = {
        provider: notification.providerDisplayName,
        model: target.modelId ?? "",
      };
      const messageIds = target.modelId
        ? target.operation === "delete"
          ? {
              pending: "settings.modelProvider.modelDeleting",
              success: "settings.modelProvider.modelDeleteSuccess",
              failure: "settings.modelProvider.modelDeleteFailure",
            }
          : {
              pending: "settings.modelProvider.modelSaving",
              success: "settings.modelProvider.modelSaveSuccess",
              failure: "settings.modelProvider.modelSaveFailure",
            }
        : {
            pending: "settings.modelProvider.providerSaving",
            success: "settings.modelProvider.providerSaveSuccess",
            failure: "settings.modelProvider.providerSaveFailure",
          };
      notification.showFeedback({
        key: dedupeKey,
        message: notification.formatMessage(
          {
            id: messageIds.pending,
          },
          messageValues,
        ),
        state: "pending",
        durationMs: 0,
      });
      try {
        await operation();
        if (draftRevisionRef.current !== revision) return;
        notification.showFeedback({
          key: dedupeKey,
          message: notification.formatMessage(
            {
              id: messageIds.success,
            },
            messageValues,
          ),
          state: "success",
        });
      } catch (error) {
        selfSaveRequestedRef.current = false;
        if (draftRevisionRef.current === revision) {
          notification.showFeedback({
            key: dedupeKey,
            message: notification.formatMessage(
              {
                id: messageIds.failure,
              },
              {
                ...messageValues,
                error: error instanceof Error ? error.message : String(error),
              },
            ),
            state: "failure",
            durationMs: 8_000,
            ...(target.draftOwnsRetry
              ? {}
              : {
                  actionLabel: notification.formatMessage({ id: "common.retry" }),
                  onAction: () => {
                    void runSaveOperation(operation, target).catch(() => undefined);
                  },
                }),
            dismissible: true,
            dismissLabel: notification.formatMessage({ id: "common.close" }),
          });
        }
        throw error;
      }
    },
    // runSaveOperation 参与卸载保存 effect 的依赖链。intl/provider 随渲染换引用时，
    // 回调也换引用会先执行旧 effect cleanup，进而再次保存并形成循环；通知身份通过 ref 读取。
    [],
  );

  return { runSaveOperation, draftRevisionRef, selfSaveRequestedRef, dismissProviderSaveFeedback };
}
