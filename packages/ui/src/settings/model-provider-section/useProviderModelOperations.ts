import { useCallback, useMemo, useRef } from "react";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import type {
  ProviderSettingsFormModel,
  ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { logger } from "@/logger.js";
import { useOptimisticReorder } from "./useOptimisticReorder.js";
import type { ProviderSaveNotificationTarget } from "./useProviderSaveOperation.js";

function projectModelsToOrder(
  models: readonly ProviderSettingsFormModel[],
  modelIds: readonly string[],
): ProviderSettingsFormModel[] {
  const byId = new Map(models.map((model) => [model.modelId, model]));
  const ordered = modelIds.flatMap((modelId) => {
    const model = byId.get(modelId);
    return model ? [model] : [];
  });
  const orderedIds = new Set(ordered.map((model) => model.modelId));
  return [...ordered, ...models.filter((model) => !orderedIds.has(model.modelId))];
}

/**
 * 供应商卡片里的模型列表操作：顺序、增删改启停。
 *
 * 成员与配置只有 Host View 一份事实，这里只保留拖拽顺序这一份明确的 pending intent；
 * 每次写入都复用供应商卡片的保存事务，保持同一套 pending/成功/失败反馈。
 */
export function useProviderModelOperations({
  provider,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onReorderModelIds,
  runSaveOperation,
}: {
  provider: ProviderSettingsFormProvider;
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
  onReorderModelIds?: (modelIds: string[]) => Promise<void>;
  runSaveOperation: (
    operation: () => Promise<void>,
    target?: ProviderSaveNotificationTarget,
  ) => Promise<void>;
}) {
  const providerId = provider.providerId;
  // 成员与配置只有 Host View 一份事实。旧本地副本在异步成功/失败时会覆盖新 View，
  // 甚至短暂移除正在编辑的模型。只保留拖拽顺序这一份明确的 pending intent。
  const models = useMemo(() => provider.models.map((model) => structuredClone(model)), [provider]);
  const modelIds = useMemo(() => models.map((model) => model.modelId), [models]);
  const reorderModelIdsTargetRef = useRef(onReorderModelIds);
  reorderModelIdsTargetRef.current = onReorderModelIds;

  const persistModelOrder = useCallback(
    async (nextModelIds: readonly string[]) => {
      const target = reorderModelIdsTargetRef.current;
      if (!target) throw new Error("当前设置入口未装配 Model 调序能力");
      await runSaveOperation(async () => {
        await target([...nextModelIds]);
      });
    },
    [providerId, runSaveOperation],
  );
  const optimisticModelOrder = useOptimisticReorder({
    authoritativeIds: modelIds,
    persist: persistModelOrder,
  });
  const orderedModels = useMemo(
    () => projectModelsToOrder(models, optimisticModelOrder.renderedIds),
    [models, optimisticModelOrder.renderedIds],
  );

  const handleModelCommit = useCallback(
    async (
      originalModelId: string,
      nextModel: ProviderSettingsFormModel,
      basedOnRevision: number,
    ): Promise<void> => {
      const trimmed = nextModel.modelId.trim();
      const currentModel = orderedModels.find((model) => model.modelId === originalModelId);
      if (!currentModel || !trimmed || !onSavePersonalModelDraft) {
        throw new Error("当前设置入口未装配原子 Model Draft 保存能力");
      }
      const committed = { ...nextModel, modelId: trimmed, hasPersonalConfig: true };
      // 未改动的编辑不写盘；否则一次打开即保存会刷新 Host View 与 revision。
      if (JSON.stringify(committed) === JSON.stringify(currentModel)) {
        return;
      }
      await runSaveOperation(
        async () => {
          await onSavePersonalModelDraft({
            providerId,
            originalModelId: currentModel.modelId,
            nextModelId: trimmed,
            personalConfig: structuredClone(committed.personalConfig),
            ...(committed.useRecommendedConfig === undefined
              ? {}
              : { useRecommendedConfig: committed.useRecommendedConfig }),
            basedOnRevision,
          });
        },
        { modelId: trimmed, draftOwnsRetry: true },
      );
    },
    [orderedModels, onSavePersonalModelDraft, providerId, runSaveOperation],
  );

  const handleDeleteModel = useCallback(
    (modelId: string) => {
      const model = orderedModels.find((candidate) => candidate.modelId === modelId);
      if (!model || model.builtin) {
        return;
      }
      void runSaveOperation(
        async () => {
          if (!onDeletePersonalModel) throw new Error("当前设置入口未装配 Personal Model 删除能力");
          await onDeletePersonalModel(providerId, model.modelId);
        },
        { modelId: model.modelId, operation: "delete" },
      ).catch((error) => {
        logger.warn("[ModelProviderSection] 删除 Personal Model 失败", {
          providerId,
          modelId: model.modelId,
          error,
        });
      });
    },
    [orderedModels, onDeletePersonalModel, providerId, runSaveOperation],
  );

  const handleModelEnabledChange = useCallback(
    async (modelId: string, enabled: boolean) => {
      if (!onSetPersonalModelEnabled) throw new Error("当前设置入口未装配 Model 启停能力");
      await runSaveOperation(
        () => onSetPersonalModelEnabled(providerId, modelId, enabled).then(() => undefined),
        { modelId },
      );
    },
    [onSetPersonalModelEnabled, providerId, runSaveOperation],
  );

  const handleAddModel = useCallback(
    async (model: ProviderSettingsFormModel) => {
      if (!onAddPersonalModel) throw new Error("当前设置入口未装配 Personal Model 添加能力");
      const added = { ...model, modelId: model.modelId.trim(), hasPersonalConfig: true };
      if (!added.modelId) return;
      await runSaveOperation(
        async () => {
          await onAddPersonalModel(
            providerId,
            added.modelId,
            structuredClone(added.personalConfig),
            added.useRecommendedConfig,
          );
        },
        { modelId: added.modelId, draftOwnsRetry: true },
      );
    },
    [onAddPersonalModel, providerId, runSaveOperation],
  );

  const handleReorderModelIds = useCallback(
    (nextModelIds: string[]) => {
      if (!onReorderModelIds) return;
      void optimisticModelOrder.commit(nextModelIds).catch((error) => {
        logger.warn("[ModelProviderSection] 保存 Personal Model 顺序失败", {
          providerId,
          error,
        });
      });
    },
    [onReorderModelIds, optimisticModelOrder, providerId],
  );

  return {
    models: orderedModels,
    handleModelCommit,
    handleDeleteModel,
    handleModelEnabledChange,
    handleAddModel,
    handleReorderModelIds,
  } as const;
}
