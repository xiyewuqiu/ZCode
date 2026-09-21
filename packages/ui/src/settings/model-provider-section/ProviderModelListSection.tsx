import {
  TID_MODEL_PROVIDER_ADD_MODEL_BUTTON,
  TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON,
  TID_MODEL_PROVIDER_MODEL_INPUT,
  testId,
} from "@zcode/shared";
import { InfoIcon, Plus } from "lucide-react";
import type { ModelConnectivityResult } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";
import type { ProviderConfigObject } from "@zcode/provider";
import { ProviderModelDialog } from "./ProviderModelDialog.js";
import { ProviderModelRow } from "./ProviderModelRow.js";
import { SortableProviderModelList } from "./SortableProviderModelList.js";
import { useModelEditorDialog } from "./useModelEditorDialog.js";

function createEmptyModel(): ProviderSettingsFormModel {
  return {
    kind: "candidate",
    modelId: "",
    builtin: false,
    personalConfig: {},
    // 空 ID 尚未解析模型配置，硬编码档位会被误认为智能推荐。
    config: {
      properties: { supportsToolCall: true },
    },
    hasPersonalConfig: false,
    executable: false,
    selectable: false,
  };
}

/** 供应商卡片中的模型列表：排序、行内操作与「新增模型」弹窗。 */
export function ProviderModelListSection({
  providerId,
  providerName,
  providerEnabled = true,
  providerAccess,
  models,
  onTestModel,
  onModelCommit,
  onModelEnabledChange,
  onDeleteModel,
  onAddModel,
  onReorderModelIds,
  settingsRevision = 0,
}: {
  providerId: string;
  providerName?: string;
  providerEnabled?: boolean;
  providerAccess?: ProviderConfigObject["access"];
  models: ProviderSettingsFormModel[];
  onTestModel?: (model: string) => Promise<ModelConnectivityResult>;
  onModelCommit: (
    originalModelId: string,
    model: ProviderSettingsFormModel,
    basedOnRevision: number,
  ) => void | Promise<void>;
  onDeleteModel: (modelId: string) => void;
  onModelEnabledChange?: (modelId: string, enabled: boolean) => void | Promise<void>;
  onAddModel: (model: ProviderSettingsFormModel) => void | Promise<void>;
  onReorderModelIds?: (modelIds: string[]) => void;
  settingsRevision?: number;
}) {
  const { intl } = useZCodeIntl();
  const { providerSettingsService } = useServices();
  const addDialog = useModelEditorDialog({
    providerId,
    resolveDraft: ({ modelId }) =>
      providerSettingsService.resolveModelConfig({ providerId, modelId }),
    getSessionModel: createEmptyModel,
    // 过去只发起异步添加就关闭弹窗，失败后输入也丢了；以实际保存完成作为结束边界。
    onCommitModel: async (model) => {
      await onAddModel(model);
    },
  });

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <span className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.models" })}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="default"
          className="rounded-lg"
          data-testid={TID_MODEL_PROVIDER_ADD_MODEL_BUTTON}
          onClick={() => addDialog.handleOpenChange(true)}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.modelProvider.addModel" })}
        </Button>
      </div>
      {models.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-input-border bg-input">
          <SortableProviderModelList
            modelIds={models.map((model) => model.modelId)}
            onReorder={onReorderModelIds}
            renderModel={(_modelId, index) => {
              const model = models[index]!;
              const inputFormat = model.config.properties?.inputFormat;
              const outputFormat = model.config.properties?.outputFormat;
              const completeProperties =
                model.config.properties?.contextWindow != null &&
                inputFormat?.supportsText != null &&
                inputFormat.supportsImage != null &&
                inputFormat.supportsVideo != null &&
                inputFormat.supportsAudio != null &&
                inputFormat.supportsPdf != null &&
                outputFormat?.supportsText != null;
              return (
                <>
                  <ProviderModelRow
                    key={`${providerId}/${model.modelId}`}
                    providerId={providerId}
                    providerName={providerName}
                    providerEnabled={providerEnabled}
                    providerAccess={providerAccess}
                    inputTestId={testId(TID_MODEL_PROVIDER_MODEL_INPUT, String(index))}
                    deleteTestId={testId(TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON, String(index))}
                    model={model}
                    onCommit={(value, basedOnRevision) =>
                      onModelCommit(model.modelId, value, basedOnRevision)
                    }
                    onResolveDraft={({ originalModelId, modelId, personalConfig }) =>
                      providerSettingsService.resolveModelConfig({
                        providerId,
                        originalModelId,
                        modelId,
                        personalConfig: structuredClone(personalConfig),
                      })
                    }
                    settingsRevision={settingsRevision}
                    onDelete={!model.builtin ? () => onDeleteModel(model.modelId) : undefined}
                    onEnabledChange={(enabled) => {
                      void Promise.resolve(onModelEnabledChange?.(model.modelId, enabled)).catch(
                        () => undefined,
                      );
                    }}
                    onTest={onTestModel}
                  />
                  {!completeProperties && (
                    <div className="px-3 pb-2 text-ui-sm text-destructive">
                      {model.issues?.[0]?.message ??
                        intl.formatMessage({ id: "settings.modelProvider.modelConfigIncomplete" })}
                    </div>
                  )}
                </>
              );
            }}
          />
        </div>
      ) : (
        <div className="mt-1 flex h-12 items-center justify-start gap-2 rounded-lg border border-dashed border-border px-4 text-left text-ui-base text-foreground-subtle">
          <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.modelProvider.modelsEmpty" })}
        </div>
      )}
      <ProviderModelDialog
        onRestore={addDialog.restore}
        mode="add"
        open={addDialog.open}
        draft={addDialog.draft}
        draftErrorMessage={addDialog.draftErrorMessage}
        draftErrorField={addDialog.draftErrorField}
        inheritedConfig={addDialog.inheritedConfig}
        overrideFields={addDialog.overrideFields}
        onOpenChange={addDialog.handleOpenChange}
        onDraftChange={addDialog.change}
        onCommit={addDialog.commit}
        saving={addDialog.saving}
        modelConfigResolutionPending={addDialog.resolutionPending}
        modelDefaultsLoaded={addDialog.defaultsLoaded}
        onModelIdBlur={() => {
          void addDialog.flush().catch(() => undefined);
        }}
      />
    </div>
  );
}
