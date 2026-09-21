import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  getProviderFormApiKey,
  getProviderFormLabel,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import type { ProviderApiType } from "@zcode/provider";
import { logger } from "@/logger.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { resolvePendingProviderDraftSave, type ProviderDraftValues } from "./ProviderDraftSave.js";
import { useIdleTrigger } from "./useIdleTrigger.js";
import { useProviderSaveOperation } from "./useProviderSaveOperation.js";

function resolveProviderNameEditKeyAction(event: {
  key: string;
  compositionActive?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
}): "commit" | "cancel" | null {
  // 中文输入法用 Enter 确认候选时仍处于 composition 阶段。
  // 部分平台的 keydown 标志会先恢复 false，因此同时读取本地 composition 状态，
  // 避免提前 blur 打断候选提交，导致拼音原始按键被留在名称里。
  if (isImeComposingKeyEvent(event)) {
    return null;
  }

  if (event.key === "Enter") {
    return "commit";
  }

  if (event.key === "Escape") {
    return "cancel";
  }

  return null;
}

/**
 * 供应商卡片唯一的一份表单状态：名称 / 连接 / API Key 草稿，以及围绕它的保存事务。
 *
 * 成员与配置只有 Host View 一份事实，这里只持有用户尚未提交的输入意图；
 * 保存反馈与草稿代次由 `useProviderSaveOperation` 提供，并与模型级操作共用同一套语义。
 */
export function useProviderDraft({
  provider,
  onSave,
}: {
  provider: ProviderSettingsFormProvider;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
}) {
  const { providerId } = provider;
  const { runSaveOperation, draftRevisionRef, selfSaveRequestedRef, dismissProviderSaveFeedback } =
    useProviderSaveOperation({
      providerId,
      providerDisplayName: getProviderFormLabel(provider),
    });
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(getProviderFormLabel(provider));
  const [apiFormat, setApiFormat] = useState<ProviderApiType>(
    provider.config.api?.type ?? "anthropic-messages",
  );
  const [baseUrlValue, setBaseUrlValue] = useState(provider.config.api?.baseUrl ?? "");
  const [apiKeyValue, setApiKeyValue] = useState(getProviderFormApiKey(provider));
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const nameCompositionActiveRef = useRef(false);
  const nameEditProviderIdRef = useRef<string | null>(null);
  const technicalInputCompositionActiveRef = useRef(false);
  const deleteRequestedRef = useRef(false);
  const providerIdRef = useRef(providerId);
  const dirtyProviderFieldsRef = useRef(new Set<keyof ProviderDraftValues>());
  const lastSubmittedDraftSignatureRef = useRef<string | null>(null);
  const draftRef = useRef<ProviderDraftValues>({
    nameValue: getProviderFormLabel(provider),
    apiFormat: provider.config.api?.type ?? "anthropic-messages",
    baseUrlValue: provider.config.api?.baseUrl ?? "",
    apiKeyValue: getProviderFormApiKey(provider),
  });

  useEffect(() => {
    const resolvedApiFormat = provider.config.api?.type ?? "anthropic-messages";
    const resolvedBaseUrl = provider.config.api?.baseUrl ?? "";
    const resolvedApiKey = getProviderFormApiKey(provider);
    const resolvedLabel = getProviderFormLabel(provider);
    if (providerIdRef.current !== provider.providerId) {
      providerIdRef.current = provider.providerId;
      nameEditProviderIdRef.current = null;
      nameCompositionActiveRef.current = false;
      setEditingName(false);
      draftRevisionRef.current += 1;
      dirtyProviderFieldsRef.current.clear();
      lastSubmittedDraftSignatureRef.current = null;
    }
    const syncField = <TKey extends keyof ProviderDraftValues>(
      key: TKey,
      value: ProviderDraftValues[TKey],
      apply: (next: ProviderDraftValues[TKey]) => void,
    ) => {
      if (dirtyProviderFieldsRef.current.has(key) && draftRef.current[key] !== value) return;
      dirtyProviderFieldsRef.current.delete(key);
      draftRef.current[key] = value;
      apply(value);
    };
    syncField("nameValue", resolvedLabel, setNameValue);
    syncField("apiFormat", resolvedApiFormat, setApiFormat);
    syncField("baseUrlValue", resolvedBaseUrl, setBaseUrlValue);
    syncField("apiKeyValue", resolvedApiKey, setApiKeyValue);
  }, [draftRevisionRef, provider]);

  const markDraftDirty = useCallback(
    (field: keyof ProviderDraftValues) => {
      dirtyProviderFieldsRef.current.add(field);
      selfSaveRequestedRef.current = false;
      draftRevisionRef.current += 1;
      dismissProviderSaveFeedback();
    },
    [dismissProviderSaveFeedback, draftRevisionRef, selfSaveRequestedRef],
  );

  const saveProvider = useCallback(
    async (nextProvider: ProviderSettingsFormProvider, onFailure?: () => void): Promise<void> => {
      await runSaveOperation(async () => {
        await onSave(nextProvider);
      }).catch((error) => {
        logger.warn("[ModelProviderSection] 自动保存 Provider 草稿失败", {
          providerId: provider.providerId,
          error,
        });
        onFailure?.();
        throw error;
      });
    },
    [onSave, provider.providerId, runSaveOperation],
  );

  const cancelIdleDraftSaveRef = useRef<() => void>(() => undefined);

  const commitPendingDraft = useCallback(
    async (reason: string, nameConfirmed = false): Promise<void> => {
      cancelIdleDraftSaveRef.current();
      const nextProvider = resolvePendingProviderDraftSave({
        provider,
        draft: draftRef.current,
        nameConfirmed,
        now: Date.now,
      });
      if (!nextProvider) {
        return;
      }
      const signature = JSON.stringify({
        ...draftRef.current,
        nameValue: nameConfirmed ? draftRef.current.nameValue : getProviderFormLabel(provider),
      });
      if (lastSubmittedDraftSignatureRef.current === signature) return;
      lastSubmittedDraftSignatureRef.current = signature;

      // Linux 下点击左侧供应商切换时，输入框 blur 与 Popover 关闭顺序不稳定，
      // 连接草稿可能在组件卸载前还没走到 blur 保存。这里在切换/卸载前兜底提交，
      // 避免“新供应商接口地址一切走就恢复为空”。
      logger.info("[ModelProviderSection] 切换前保存未提交的供应商草稿", {
        providerId: provider.providerId,
        reason,
      });
      await saveProvider(nextProvider, () => {
        if (lastSubmittedDraftSignatureRef.current === signature) {
          lastSubmittedDraftSignatureRef.current = null;
        }
      });
    },
    [provider, saveProvider],
  );

  const idleDraftSave = useIdleTrigger(() => {
    void commitPendingDraft("idle").catch(() => undefined);
  });
  cancelIdleDraftSaveRef.current = idleDraftSave.cancel;
  const scheduleIdleDraftSave = idleDraftSave.schedule;
  const cancelIdleDraftSave = idleDraftSave.cancel;

  const handleProviderEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (savingEnabled) return;
      cancelIdleDraftSave();
      setSavingEnabled(true);
      // 同一次保存带上尚未提交的连接草稿，避免开关保存把刚输入的 Key 覆盖回旧值。
      const draft =
        resolvePendingProviderDraftSave({
          provider,
          draft: draftRef.current,
          now: Date.now,
        }) ?? provider;
      try {
        await saveProvider({ ...draft, enabledUpdate: enabled });
      } catch {
        // 统一保存入口已记录错误及可重试反馈；不乐观覆盖权威 enabled。
      } finally {
        setSavingEnabled(false);
      }
    },
    [cancelIdleDraftSave, provider, saveProvider, savingEnabled],
  );

  useEffect(() => {
    return () => {
      cancelIdleDraftSave();
      if (deleteRequestedRef.current) {
        // 确认删除会触发详情卡片卸载；如果 cleanup 继续补保存草稿，
        // 被删除的 provider 会在 delete 后又被 save 重新创建。
        logger.info("[ModelProviderSection] 删除中的供应商跳过 cleanup 草稿保存", {
          providerId: provider.providerId,
        });
        return;
      }
      if (selfSaveRequestedRef.current) {
        selfSaveRequestedRef.current = false;
        // 模型编辑会先保存新的有效模型列表，随后父层乐观更新会触发本组件 cleanup。
        // 此时如果再用旧草稿补保存，会覆盖刚提交的模型列表。
        logger.info("[ModelProviderSection] 内部保存触发的刷新跳过 cleanup 草稿保存", {
          providerId: provider.providerId,
        });
        return;
      }
      void commitPendingDraft("cleanup").catch(() => undefined);
    };
  }, [cancelIdleDraftSave, commitPendingDraft, provider.providerId]);

  const handleNameValueChange = useCallback(
    (value: string) => {
      markDraftDirty("nameValue");
      draftRef.current.nameValue = value;
      setNameValue(value);
    },
    [markDraftDirty],
  );

  const handleBaseUrlValueChange = useCallback(
    (value: string) => {
      markDraftDirty("baseUrlValue");
      draftRef.current.baseUrlValue = value;
      setBaseUrlValue(value);
      scheduleIdleDraftSave();
    },
    [markDraftDirty, scheduleIdleDraftSave],
  );

  const handleApiKeyValueChange = useCallback(
    (value: string) => {
      markDraftDirty("apiKeyValue");
      draftRef.current.apiKeyValue = value;
      setApiKeyValue(value);
      scheduleIdleDraftSave();
    },
    [markDraftDirty, scheduleIdleDraftSave],
  );

  const handleNameBlur = useCallback(() => {
    // Esc/切换供应商先取消编辑意图，随后发生的 blur 不得补发保存。
    if (nameEditProviderIdRef.current !== provider.providerId) return;
    nameEditProviderIdRef.current = null;
    setEditingName(false);
    const trimmed = draftRef.current.nameValue.trim();
    const currentLabel = getProviderFormLabel(provider);
    if (trimmed && trimmed !== currentLabel) {
      void commitPendingDraft("name-blur", true).catch(() => undefined);
    } else {
      draftRef.current.nameValue = currentLabel;
      setNameValue(currentLabel);
      dirtyProviderFieldsRef.current.delete("nameValue");
    }
  }, [commitPendingDraft, provider]);

  const handleNameKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const action = resolveProviderNameEditKeyAction({
        key: event.key,
        compositionActive: nameCompositionActiveRef.current,
        nativeEvent: event.nativeEvent,
      });
      if (action === "commit") {
        event.preventDefault();
        (event.target as HTMLInputElement).blur();
      } else if (action === "cancel") {
        event.preventDefault();
        nameEditProviderIdRef.current = null;
        nameCompositionActiveRef.current = false;
        const label = getProviderFormLabel(provider);
        draftRef.current.nameValue = label;
        dirtyProviderFieldsRef.current.delete("nameValue");
        setNameValue(label);
        setEditingName(false);
      }
    },
    [provider],
  );

  const handleStartEditName = useCallback(() => {
    nameEditProviderIdRef.current = provider.providerId;
    nameCompositionActiveRef.current = false;
    setEditingName(true);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [provider.providerId]);

  const saveConnection = useCallback(
    () => void commitPendingDraft("connection-blur").catch(() => undefined),
    [commitPendingDraft],
  );

  const handleApiFormatChange = useCallback(
    (value: ProviderApiType) => {
      markDraftDirty("apiFormat");
      draftRef.current.apiFormat = value;
      setApiFormat(value);
      void commitPendingDraft("api-format-change").catch(() => undefined);
    },
    [commitPendingDraft, markDraftDirty],
  );

  const handleApiKeyBlur = useCallback(() => {
    void commitPendingDraft("api-key-blur").catch(() => undefined);
  }, [commitPendingDraft]);

  const handleTextCommitKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    // 候选确认的 Enter 不能被当作表单提交。本地 ref 覆盖
    // Electron/macOS 上 nativeEvent.isComposing 过早变回 false 的时序。
    if (
      isImeComposingKeyEvent({
        compositionActive: technicalInputCompositionActiveRef.current,
        nativeEvent: event.nativeEvent,
      })
    ) {
      return;
    }
    event.currentTarget.blur();
  }, []);

  const handleTechnicalInputCompositionStart = useCallback(() => {
    technicalInputCompositionActiveRef.current = true;
  }, []);
  const handleTechnicalInputCompositionEnd = useCallback(() => {
    technicalInputCompositionActiveRef.current = false;
  }, []);

  /** 确认删除会触发详情卡片卸载，cleanup 补保存必须跳过，否则删除后又被 save 复活。 */
  const runGuardedDelete = useCallback((action: () => void | Promise<void>) => {
    deleteRequestedRef.current = true;
    try {
      const result = action();
      if (result instanceof Promise) {
        void result
          .catch(() => undefined)
          .finally(() => {
            deleteRequestedRef.current = false;
          });
        return;
      }
    } catch (error) {
      deleteRequestedRef.current = false;
      throw error;
    }
    deleteRequestedRef.current = false;
  }, []);

  return {
    providerName: getProviderFormLabel(provider),
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
    handleNameCompositionStart: () => {
      nameCompositionActiveRef.current = true;
    },
    handleNameCompositionEnd: () => {
      nameCompositionActiveRef.current = false;
    },
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
  } as const;
}
