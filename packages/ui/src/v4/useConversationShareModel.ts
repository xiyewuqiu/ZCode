import { useMemo } from "react";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { createConversationShareModel } from "@/v4/conversationShareModel.js";

export function useConversationShareModel({
  enabled,
  rows,
  scopeKey,
}: {
  enabled: boolean;
  rows: readonly ConversationRow[] | undefined;
  scopeKey: string;
}) {
  const { intl } = useZCodeIntl();
  // scope 包含 workspace identity、远程/session 身份及 logEpoch；相同 rowId 不可跨范围复用。
  const project = useMemo(() => createConversationShareModel(), [scopeKey]);
  const activeRows = enabled ? rows : undefined;
  return useMemo(
    () =>
      project(activeRows ?? null, {
        assistantEmptyPreview: intl.formatMessage({ id: "chat.turnNavigator.emptyAssistant" }),
        assistantRunningPreview: intl.formatMessage({ id: "chat.turnNavigator.runningAssistant" }),
        userFallbackPreview: intl.formatMessage({ id: "chat.turnNavigator.userFallback" }),
      }),
    [activeRows, intl, project],
  );
}
