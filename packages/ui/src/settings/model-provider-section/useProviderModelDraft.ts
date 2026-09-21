import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelConfigObject, ModelConfigResolution } from "@zcode/provider";
import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";
import {
  createProviderModelDraftValues,
  modelDraftOverrides,
  projectModelDraft,
  resolveProviderModelDraftCommit,
  restoreModelDraft,
  updateModelDraft,
  type ProviderModelDraftValues,
} from "./modelDraft.js";
import { useIdleTrigger } from "./useIdleTrigger.js";

/**
 * 模型草稿编辑的单一状态来源：添加与编辑共用“个人意图草稿 + Host 推荐基线解析”的生命周期。
 * 业务入口只负责初始化基线、权限装配和各自的保存事务。
 */
export function useProviderModelDraft({
  model,
  open,
  scopeKey,
  resolve,
}: {
  model: ProviderSettingsFormModel;
  open: boolean;
  scopeKey: string;
  resolve?: (modelId: string, personalConfig: ModelConfigObject) => Promise<ModelConfigResolution>;
}) {
  const [rawDraft, setRawDraft] = useState(() => createProviderModelDraftValues(model));
  const [draftScope, setDraftScope] = useState(scopeKey);
  const editGeneration = useRef(0);
  if (draftScope !== scopeKey) {
    // 切换供应商必须同时丢弃旧草稿和旧请求，不能把上一供应商的用户意图带到新目标。
    setDraftScope(scopeKey);
    setRawDraft(createProviderModelDraftValues(model));
  }
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const resolveRecommended = useCallback(
    (id: string) => {
      if (!resolveRef.current) throw new Error("Model Config Resolution 未配置");
      // 公共草稿持有个人意图；只向 Host 取推荐基线，不用半有效表单拼装第二份 Overlay。
      return resolveRef.current(id, {});
    },
    [scopeKey],
  );
  const smart = rawDraft.useRecommendedConfigValue !== false;
  const originalModelId =
    model.useRecommendedConfig !== false && !rawDraft.clearPersonalConfigValue
      ? model.modelId
      : undefined;
  const config = useModelConfigResolution({
    open,
    enabled: smart,
    modelId: rawDraft.idValue,
    originalModelId,
    resolve: resolve ? resolveRecommended : undefined,
  });
  const modelWithResolution = (
    resolution: ModelConfigResolution | null | undefined,
  ): ProviderSettingsFormModel => {
    if (resolution)
      return {
        ...model,
        inheritedConfig: resolution.inheritedConfig,
        config: resolution.inheritedConfig,
      };
    if (rawDraft.idValue.trim() === model.modelId) return model;
    return { ...model, config: {}, inheritedConfig: undefined };
  };
  const currentModel = modelWithResolution(config.resolution);
  const draft = projectModelDraft(rawDraft, currentModel);
  const change = (patch: Partial<ProviderModelDraftValues>) => {
    editGeneration.current += 1;
    setRawDraft(updateModelDraft(draft, patch, currentModel));
  };
  const reset = (nextModel: ProviderSettingsFormModel) => {
    editGeneration.current += 1;
    config.cancel();
    setRawDraft(createProviderModelDraftValues(nextModel));
  };
  const restore = async () => {
    const generation = ++editGeneration.current;
    const apply = (resolvedModel: ProviderSettingsFormModel) =>
      setRawDraft(restoreModelDraft(draft, resolvedModel));
    if (!draft.idValue.trim() || !resolve) {
      config.cancel();
      apply(currentModel);
      return;
    }
    await config.restore({
      isCurrent: () => editGeneration.current === generation,
      apply: (resolution) => apply(modelWithResolution(resolution)),
    });
  };
  const commit = async () => {
    editGeneration.current += 1;
    const requiresResolution = smart && resolve && rawDraft.idValue.trim() !== originalModelId;
    const resolution = requiresResolution
      ? (config.resolution ?? (await config.flush()))
      : config.resolution;
    if (requiresResolution && !resolution) throw new Error("Model Config Resolution 尚未就绪");
    const resolvedModel = modelWithResolution(resolution);
    return resolveProviderModelDraftCommit({
      currentModel: resolvedModel,
      draft: projectModelDraft(rawDraft, resolvedModel),
    });
  };
  return {
    draft,
    change,
    reset,
    restore,
    commit,
    overrides: modelDraftOverrides(draft),
    inheritedConfig: currentModel.inheritedConfig,
    pending:
      smart &&
      Boolean(resolve) &&
      rawDraft.idValue.trim() !== originalModelId &&
      !config.resolution,
    defaultsLoaded: smart && config.defaultsLoaded,
    flush: config.flush,
  };
}

interface ResolutionState {
  readonly modelId: string;
  readonly identity: object;
  readonly resolution: ModelConfigResolution;
}

/**
 * 推荐配置基线解析：模型 ID 变化后空闲触发一次解析，恢复/提交时同步 flush。
 * A→B→A 不能复用第一次 A 的回包；同 ID 不代表同一编辑/账号环境代次。
 */
function useModelConfigResolution({
  open,
  enabled = true,
  originalModelId,
  modelId,
  resolve,
}: {
  open: boolean;
  enabled?: boolean;
  originalModelId?: string;
  modelId: string;
  resolve?: (modelId: string) => Promise<ModelConfigResolution>;
}) {
  const [result, setResult] = useState<ResolutionState | null>(null);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const generationRef = useRef(0);
  const identity = useMemo(() => ({}), [open, modelId, resolve]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const inheritedSignatureRef = useRef<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveCurrent = useCallback(
    async (restore?: {
      isCurrent: () => boolean;
      apply: (resolution: ModelConfigResolution) => void;
    }): Promise<ModelConfigResolution | undefined> => {
      const normalizedModelId = modelId.trim();
      if (
        !open ||
        !resolve ||
        !normalizedModelId ||
        (!restore && (!enabled || normalizedModelId === originalModelId))
      ) {
        return undefined;
      }
      const generation = ++generationRef.current;
      const isCurrent = () =>
        generationRef.current === generation &&
        identityRef.current === identity &&
        (restore ? restore.isCurrent() : enabledRef.current === enabled);
      try {
        const resolution = await resolve(normalizedModelId);
        if (!isCurrent()) return undefined;
        const inheritedSignature = JSON.stringify(resolution.inheritedConfig);
        if (
          resolution.issues.length === 0 &&
          inheritedSignatureRef.current !== inheritedSignature
        ) {
          inheritedSignatureRef.current = inheritedSignature;
          setDefaultsLoaded(true);
          if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
          feedbackTimerRef.current = setTimeout(() => {
            feedbackTimerRef.current = null;
            setDefaultsLoaded(false);
          }, 3_500);
        }
        setResult({ modelId: normalizedModelId, identity, resolution });
        restore?.apply(resolution);
        return resolution;
      } catch (error) {
        // 旧恢复请求的错误也必须服从身份/编辑代次，不能覆盖用户后来的字段反馈。
        if (!isCurrent()) return undefined;
        throw error;
      }
    },
    [enabled, identity, modelId, open, originalModelId, resolve],
  );

  const idle = useIdleTrigger(() => resolveCurrent());

  useEffect(() => {
    generationRef.current += 1;
    const normalizedModelId = modelId.trim();
    if (
      !open ||
      !enabled ||
      !resolve ||
      !normalizedModelId ||
      normalizedModelId === originalModelId
    ) {
      idle.cancel();
      setResult(null);
      setDefaultsLoaded(false);
      if (!open) inheritedSignatureRef.current = null;
      return;
    }
    // 恢复成功与开启智能模式同批提交，沿用同一结果，不紧接着再发一次自动解析。
    if (result?.identity === identity) return;
    idle.schedule();
  }, [
    enabled,
    identity,
    idle.cancel,
    idle.schedule,
    modelId,
    open,
    originalModelId,
    resolve,
    result,
  ]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  const activeResult = result?.identity === identity ? result.resolution : null;
  return {
    cancel: () => {
      generationRef.current += 1;
      idle.cancel();
      setResult(null);
    },
    restore: (intent: {
      isCurrent: () => boolean;
      apply: (resolution: ModelConfigResolution) => void;
    }) => {
      idle.cancel();
      return resolveCurrent(intent);
    },
    defaultsLoaded,
    flush: idle.flush,
    resolution: activeResult,
  } as const;
}
