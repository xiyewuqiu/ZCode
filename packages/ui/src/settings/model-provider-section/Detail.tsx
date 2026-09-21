import type { ModelConnectivityResult } from "@zcode/shared";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import type { ProviderSettingsView } from "@zcode/services";
import { Loader2Icon } from "lucide-react";
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import type { ModelProviderNavItem } from "./constants.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";

/** 供应商详情：配置尚未返回时的加载占位，避免右侧面板空白。 */
function ProviderDetailLoadingCard({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
        <Loader2Icon className="size-4 animate-spin" />
        <span>{loadingLabel}</span>
      </div>
    </div>
  );
}

export function ModelProviderSectionDetail({
  selectedNavItem,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onReorderProviderModels,
  onTestModel,
  providerSettingsView: providerSettingsViewOverride,
}: {
  selectedNavItem: ModelProviderNavItem | null;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormProvider["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  providerSettingsView?: ProviderSettingsView | null;
}) {
  const { intl } = useZCodeIntl();
  const loadingLabel = intl.formatMessage({ id: "common.loading" });
  const rootProviderSettingsRead = useProviderSettingsView();
  const rootProviderSettingsView =
    rootProviderSettingsRead.state.status === "ready" ? rootProviderSettingsRead.state.view : null;
  const providerSettingsView = providerSettingsViewOverride ?? rootProviderSettingsView;

  if (!selectedNavItem) {
    return <ProviderDetailLoadingCard loadingLabel={loadingLabel} />;
  }

  const provider = selectedNavItem.provider;
  // 仅展示预设模板声明的 Key 入口，不根据地址猜测自定义 Provider 的 Key 控制台。
  const apiKeyManagementUrl = provider.templateId
    ? getProviderFormApiKeyManagementUrl(provider)
    : undefined;
  return (
    <InlineEditableProviderCard
      provider={provider}
      onSave={onSave}
      onAddPersonalModel={onAddPersonalModel}
      onSavePersonalModelDraft={onSavePersonalModelDraft}
      onSetPersonalModelEnabled={onSetPersonalModelEnabled}
      onDeletePersonalModel={onDeletePersonalModel}
      settingsRevision={providerSettingsView?.revision}
      onDelete={() => onDelete(provider)}
      onReorderModelIds={
        onReorderProviderModels
          ? (modelIds) => onReorderProviderModels(provider.providerId, modelIds)
          : undefined
      }
      onTestModel={onTestModel}
      apiKeyManagementUrl={apiKeyManagementUrl}
    />
  );
}
