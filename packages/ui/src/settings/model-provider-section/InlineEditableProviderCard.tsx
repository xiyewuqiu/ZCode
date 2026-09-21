import { useCallback } from "react";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import { isApiKeyAccess } from "@zcode/provider";
import type { ModelConnectivityResult } from "@zcode/shared";
import type {
  ProviderSettingsFormModel,
  ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Switch } from "@/components/ui/switch.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { ProviderApiKeySection, ProviderConnectionSection } from "./ProviderConnectionForm.js";
import { ProviderCardHeader } from "./ProviderCardHeader.js";
import { ProviderModelListSection } from "./ProviderModelListSection.js";
import { useProviderDraft } from "./useProviderDraft.js";
import { useProviderModelOperations } from "./useProviderModelOperations.js";

/**
 * 单个供应商的详情卡片：装配连接草稿、模型列表操作与各分区的视图。
 * 状态与保存事务都在 `useProviderDraft` / `useProviderModelOperations` 内，这里只做组合。
 */
export function InlineEditableProviderCard({
  provider,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onTestModel,
  onReorderModelIds,
  apiKeyManagementUrl,
  settingsRevision = 0,
}: {
  provider: ProviderSettingsFormProvider;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormModel["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete?: () => void | Promise<void>;
  onTestModel?: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  onReorderModelIds?: (modelIds: string[]) => Promise<void>;
  /** 仅模板声明时提供；不根据地址猜测自定义 Provider 的 Key 控制台。 */
  apiKeyManagementUrl?: string;
  settingsRevision?: number;
}) {
  const { intl } = useZCodeIntl();
  const {
    providerName,
    editingName,
    nameValue,
    nameInputRef,
    apiFormat,
    baseUrlValue,
    apiKeyValue,
    apiKeyVisible,
    savingEnabled,
    setApiKeyVisible,
    handleNameValueChange,
    handleNameBlur,
    handleNameKeyDown,
    handleStartEditName,
    handleNameCompositionStart,
    handleNameCompositionEnd,
    handleApiFormatChange,
    handleBaseUrlValueChange,
    saveConnection,
    handleApiKeyValueChange,
    handleApiKeyBlur,
    handleTextCommitKeyDown,
    handleTechnicalInputCompositionStart,
    handleTechnicalInputCompositionEnd,
    handleProviderEnabledChange,
    commitPendingDraft,
    runSaveOperation,
    runGuardedDelete,
  } = useProviderDraft({ provider, onSave });
  const {
    models,
    handleModelCommit,
    handleDeleteModel,
    handleModelEnabledChange,
    handleAddModel,
    handleReorderModelIds,
  } = useProviderModelOperations({
    provider,
    onAddPersonalModel,
    onSavePersonalModelDraft,
    onSetPersonalModelEnabled,
    onDeletePersonalModel,
    onReorderModelIds,
    runSaveOperation,
  });

  const handleTestModel = useCallback(
    async (modelId: string): Promise<ModelConnectivityResult> => {
      if (!onTestModel) {
        return { success: false, error: { message: "Model connectivity test is unavailable" } };
      }
      // 连接测试曾把 Renderer 模型快照交给外层重新保存，绕过了模型草稿的 revision 边界。
      // 现在只 flush 本卡片唯一的 Provider 草稿；Service 会等待同一 Provider 操作队列和 Registry
      // 刷新完成，再按正式 providerId/modelId 创建 Model。
      await commitPendingDraft("connectivity-test");
      return onTestModel(provider.providerId, modelId);
    },
    [commitPendingDraft, onTestModel, provider.providerId],
  );

  const providerToggleLabel = intl.formatMessage({
    id: provider.enabled
      ? "settings.modelProvider.disableProvider"
      : "settings.modelProvider.enableProvider",
  });

  return (
    <div className="space-y-3">
      <ProviderCardHeader
        providerName={providerName}
        logo={provider.config.logo}
        editingName={editingName}
        nameValue={nameValue}
        nameInputRef={nameInputRef}
        onNameChange={handleNameValueChange}
        onNameBlur={handleNameBlur}
        onNameKeyDown={handleNameKeyDown}
        onNameCompositionStart={handleNameCompositionStart}
        onNameCompositionEnd={handleNameCompositionEnd}
        onStartEditName={handleStartEditName}
        onDelete={onDelete ? () => runGuardedDelete(onDelete) : undefined}
        providerToggle={
          <ControlHintTooltip standalone title={providerToggleLabel}>
            {/* Tooltip 的 data-state 不能覆盖 Switch 的 checked 状态，否则轨道样式会消失。 */}
            <span className="inline-flex">
              <Switch
                // 共享开关左右各扩展 12px，会覆盖相邻菜单；本标题栏仅保留 4px 横向热区。
                className="after:-inset-x-1"
                data-testid="model-provider-enabled-switch"
                aria-label={providerToggleLabel}
                checked={provider.enabled}
                disabled={savingEnabled}
                onCheckedChange={(enabled) => {
                  void handleProviderEnabledChange(enabled);
                }}
              />
            </span>
          </ControlHintTooltip>
        }
      />

      <div className="space-y-3">
        <ProviderConnectionSection
          apiFormat={apiFormat}
          baseUrlValue={baseUrlValue}
          onApiFormatChange={handleApiFormatChange}
          onBaseUrlChange={handleBaseUrlValueChange}
          onBaseUrlBlur={saveConnection}
          onBaseUrlKeyDown={handleTextCommitKeyDown}
          onBaseUrlCompositionStart={handleTechnicalInputCompositionStart}
          onBaseUrlCompositionEnd={handleTechnicalInputCompositionEnd}
        />

        {isApiKeyAccess(provider.config.access) ? (
          <ProviderApiKeySection
            apiKeyValue={apiKeyValue}
            apiKeyVisible={apiKeyVisible}
            apiKeyManagementUrl={apiKeyManagementUrl}
            onApiKeyChange={handleApiKeyValueChange}
            onApiKeyBlur={handleApiKeyBlur}
            onApiKeyKeyDown={handleTextCommitKeyDown}
            onApiKeyCompositionStart={handleTechnicalInputCompositionStart}
            onApiKeyCompositionEnd={handleTechnicalInputCompositionEnd}
            onToggleApiKeyVisibility={() => setApiKeyVisible((visible) => !visible)}
          />
        ) : null}

        <ProviderModelListSection
          // 不同 Provider 可以有同名模型；不能复用上一供应商的打开中草稿和版本。
          key={provider.providerId}
          providerId={provider.providerId}
          providerName={providerName}
          providerEnabled={provider.enabled}
          providerAccess={provider.config.access}
          models={models}
          onTestModel={onTestModel ? handleTestModel : undefined}
          onModelCommit={handleModelCommit}
          onModelEnabledChange={handleModelEnabledChange}
          onDeleteModel={handleDeleteModel}
          onAddModel={handleAddModel}
          onReorderModelIds={onReorderModelIds ? handleReorderModelIds : undefined}
          settingsRevision={settingsRevision}
        />
      </div>
    </div>
  );
}
