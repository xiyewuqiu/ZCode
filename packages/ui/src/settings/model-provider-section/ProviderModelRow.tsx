import { useCallback, useState } from "react";
import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";
import type { ModelConfigResolution, ProviderConfigObject } from "@zcode/provider";
import type { ModelConnectivityResult } from "@zcode/shared";
import { Loader2Icon, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ModelInputCapabilityBadge } from "@/components/ModelInputCapabilityBadge.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";
import { useProviderDetailFeedback } from "./ProviderDetailFeedback.js";
import { useModelEditorDialog } from "./useModelEditorDialog.js";
import { ProviderModelDialog } from "./ProviderModelDialog.js";

export function ProviderModelRow({
  model,
  providerId,
  providerName = providerId,
  providerEnabled = true,
  providerAccess,
  inputTestId,
  deleteTestId,
  onCommit,
  onResolveDraft,
  settingsRevision = 0,
  onDelete,
  onEnabledChange,
  onTest,
}: {
  model: ProviderSettingsFormModel;
  providerId: string;
  providerName?: string;
  providerEnabled?: boolean;
  providerAccess?: ProviderConfigObject["access"];
  inputTestId?: string;
  deleteTestId?: string;
  onCommit: (model: ProviderSettingsFormModel, basedOnRevision: number) => void | Promise<void>;
  onResolveDraft?: (input: {
    originalModelId: string | undefined;
    modelId: string;
    personalConfig: ProviderSettingsFormModel["personalConfig"];
  }) => Promise<ModelConfigResolution>;
  settingsRevision?: number;
  onDelete?: () => void;
  onEnabledChange?: (enabled: boolean) => void;
  onTest?: (model: string) => Promise<ModelConnectivityResult>;
}) {
  const { intl, locale } = useZCodeIntl();
  const { showFeedback } = useProviderDetailFeedback();
  const [isTesting, setIsTesting] = useState(false);
  const dialog = useModelEditorDialog({
    providerId,
    resolveDraft:
      onResolveDraft ??
      (async () => {
        throw new Error("当前设置入口未装配 Model Config Resolution 能力");
      }),
    getSessionModel: () => model,
    settingsRevision,
    onCommitModel: async (committed, basedOnRevision) => {
      await onCommit(committed, basedOnRevision);
    },
  });

  const handleTest = useCallback(async () => {
    if (!onTest || isTesting || !providerEnabled) {
      return;
    }

    const modelId = dialog.draft.idValue.trim();
    const dedupeKey = `model-test:${providerId}:${modelId}`;
    showFeedback({
      key: dedupeKey,
      message: intl.formatMessage(
        { id: "settings.modelProvider.testModel.connectingWithIdentity" },
        { provider: providerName, model: modelId },
      ),
      state: "pending",
      durationMs: 0,
    });
    setIsTesting(true);
    try {
      const result = await onTest(modelId);
      if (result.success) {
        showFeedback({
          key: dedupeKey,
          message: intl.formatMessage(
            { id: "settings.modelProvider.testModel.successWithIdentity" },
            { provider: providerName, model: modelId },
          ),
          state: "success",
          successEmphasis: true,
          dismissible: true,
          dismissLabel: intl.formatMessage({ id: "common.close" }),
        });
      } else {
        const localizedReason =
          result.error.code === "provider-unavailable"
            ? intl.formatMessage({ id: "settings.modelProvider.testModel.providerUnavailable" })
            : result.error.code === "model-unavailable"
              ? intl.formatMessage({ id: "settings.modelProvider.testModel.modelUnavailable" })
              : result.error.message.trim();
        const reason =
          localizedReason || intl.formatMessage({ id: "settings.modelProvider.testModel.failed" });
        showFeedback({
          key: dedupeKey,
          message: intl.formatMessage(
            { id: "settings.modelProvider.testModel.failedWithIdentity" },
            { provider: providerName, model: modelId, reason },
          ),
          state: "failure",
          durationMs: 8_000,
          dismissible: true,
          dismissLabel: intl.formatMessage({ id: "common.close" }),
        });
      }
    } catch (error) {
      showFeedback({
        key: dedupeKey,
        message: intl.formatMessage(
          { id: "settings.modelProvider.testModel.failedWithIdentity" },
          {
            provider: providerName,
            model: modelId,
            reason:
              error instanceof Error
                ? error.message
                : intl.formatMessage({ id: "settings.modelProvider.testModel.failed" }),
          },
        ),
        state: "failure",
        durationMs: 8_000,
        dismissible: true,
        dismissLabel: intl.formatMessage({ id: "common.close" }),
      });
    } finally {
      setIsTesting(false);
    }
  }, [
    onTest,
    isTesting,
    dialog.draft.idValue,
    intl,
    providerId,
    providerName,
    providerEnabled,
    showFeedback,
  ]);

  const testIcon = isTesting ? (
    <Loader2Icon className="size-3.5 text-foreground-subtle animate-spin" />
  ) : (
    <Unplug className="size-3.5 text-foreground-subtle" />
  );
  const shouldShowTestButton = Boolean(onTest);
  const testDisabled = !providerEnabled || isTesting || !dialog.draft.idValue.trim() || !onTest;
  const contextWindowLabel = formatModelContextWindowLabel(
    model.config.properties?.contextWindow ?? 0,
    locale,
  );
  const contextWindowAccessibleLabel = intl.formatMessage(
    { id: "settings.modelProvider.contextWindowBadgeLabel" },
    { value: contextWindowLabel },
  );

  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            data-testid={inputTestId}
            className="min-w-0 truncate font-mono text-ui-base text-foreground"
          >
            {model.modelId}
          </span>
          <span
            className="inline-flex h-5 max-w-20 shrink-0 items-center truncate rounded-md border border-border bg-surface px-1.5 font-mono text-ui-sm text-foreground-subtle"
            aria-label={contextWindowAccessibleLabel}
            title={contextWindowAccessibleLabel}
          >
            {contextWindowLabel}
          </span>
          {shouldShowModelVisionBadge(
            model.modelId,
            model.config.properties?.inputFormat?.supportsImage,
            providerAccess,
          ) ? (
            <ModelInputCapabilityBadge />
          ) : null}
        </div>
        {shouldShowTestButton ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 p-0"
            disabled={testDisabled}
            title={intl.formatMessage({
              id: providerEnabled
                ? "settings.modelProvider.testModel"
                : "settings.modelProvider.testModel.enableProviderFirst",
            })}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={handleTest}
          >
            {testIcon}
          </Button>
        ) : null}
        <ProviderModelDialog
          onRestore={dialog.restore}
          mode="edit"
          open={dialog.open}
          draft={dialog.draft}
          draftErrorMessage={dialog.draftErrorMessage}
          draftErrorField={dialog.draftErrorField}
          overrideFields={dialog.overrideFields}
          inheritedConfig={dialog.inheritedConfig}
          onOpenChange={dialog.handleOpenChange}
          onDraftChange={dialog.change}
          onCommit={dialog.commit}
          saving={dialog.saving}
          modelConfigResolutionPending={dialog.resolutionPending}
          modelDefaultsLoaded={dialog.defaultsLoaded}
          onModelIdBlur={() => {
            void dialog.flush().catch(() => undefined);
          }}
          modelIdReadOnly={model.builtin}
        />
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-foreground-subtle"
            data-testid={deleteTestId}
            aria-label={intl.formatMessage({ id: "settings.modelProvider.delete" })}
            title={intl.formatMessage({ id: "settings.modelProvider.delete" })}
            onMouseDown={(event) => {
              // 输入框聚焦时点击删除会先触发 blur 保存，父层刷新后原按钮的 click 会丢失。
              event.preventDefault();
            }}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
        {onEnabledChange ? (
          <Switch
            size="sm"
            checked={model.config.enabled !== false}
            aria-label={intl.formatMessage({
              id:
                model.config.enabled === false
                  ? "settings.modelProvider.enableAction"
                  : "settings.modelProvider.disableAction",
            })}
            onCheckedChange={onEnabledChange}
          />
        ) : null}
      </div>
    </div>
  );
}
