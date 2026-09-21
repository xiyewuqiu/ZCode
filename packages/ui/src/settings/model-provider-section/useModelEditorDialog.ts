import { useCallback, useRef, useState } from "react";
import type { ModelConfigObject, ModelConfigResolution } from "@zcode/provider";
import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ProviderModelDraftErrorField } from "./modelDraft.js";
import { useProviderModelDraft } from "./useProviderModelDraft.js";

/**
 * 模型编辑弹窗（新增/编辑共用）的单一状态源。
 *
 * 草稿会话固定在打开瞬间的模型基线上：外部 View 每次投影都会产生新对象，
 * 编辑事务不能跟随对象刷新重置。保存期间锁定开关，避免旧保存回包关闭新一轮编辑。
 */
export function useModelEditorDialog({
  providerId,
  resolveDraft,
  getSessionModel,
  settingsRevision = 0,
  onCommitModel,
}: {
  providerId: string;
  /** 向 Host 解析推荐基线；originalModelId 为空表示新增场景。 */
  resolveDraft: (input: {
    originalModelId: string | undefined;
    modelId: string;
    personalConfig: ModelConfigObject;
  }) => Promise<ModelConfigResolution>;
  getSessionModel: () => ProviderSettingsFormModel;
  settingsRevision?: number;
  onCommitModel: (model: ProviderSettingsFormModel, basedOnRevision: number) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [draftErrorField, setDraftErrorField] = useState<ProviderModelDraftErrorField | null>(null);
  const [sessionModel, setSessionModel] = useState<ProviderSettingsFormModel>(() =>
    getSessionModel(),
  );
  const [basedOnRevision, setBasedOnRevision] = useState(settingsRevision);

  const resolve = useCallback(
    (modelId: string, personalConfig: ModelConfigObject) =>
      resolveDraft({
        originalModelId: sessionModel.modelId.trim() || undefined,
        modelId,
        personalConfig,
      }),
    [resolveDraft, sessionModel.modelId],
  );
  const editor = useProviderModelDraft({
    model: sessionModel,
    open,
    scopeKey: providerId,
    resolve,
  });

  const clearDraftFeedback = () => {
    setDraftErrorField(null);
    setCommitError(null);
  };

  const openDialog = () => {
    const model = getSessionModel();
    setSessionModel(model);
    editor.reset(model);
    clearDraftFeedback();
    setBasedOnRevision(settingsRevision);
    setOpen(true);
  };

  const closeDialog = () => {
    editor.reset(sessionModel);
    clearDraftFeedback();
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    // 保存中的关闭/再打开会让旧请求结束掉新草稿，等待本次提交完成再结束编辑。
    if (savingRef.current) return;
    if (!open && next) openDialog();
    else if (open && !next) closeDialog();
  };

  const commit = async (): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setCommitError(null);
    try {
      const result = await editor.commit();
      if (result.status === "invalid") {
        setDraftErrorField(result.field);
        return false;
      }
      setDraftErrorField(null);
      await onCommitModel(result.model, basedOnRevision);
      closeDialog();
      return true;
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const restore = () => {
    clearDraftFeedback();
    void editor.restore().catch((error) => {
      setCommitError(error instanceof Error ? error.message : String(error));
    });
  };

  const change = (patch: Parameters<typeof editor.change>[0]) => {
    editor.change(patch);
    setDraftErrorField(null);
  };

  const draftErrorMessage =
    commitError ??
    (draftErrorField
      ? intl.formatMessage({
          id: `settings.modelProvider.modelMetadata.invalid.${draftErrorField}`,
        })
      : null);

  return {
    open,
    saving,
    draft: editor.draft,
    inheritedConfig: editor.inheritedConfig,
    overrideFields: editor.overrides,
    resolutionPending: editor.pending,
    defaultsLoaded: editor.defaultsLoaded,
    draftErrorField,
    draftErrorMessage,
    change,
    commit,
    restore,
    handleOpenChange,
    flush: editor.flush,
  } as const;
}
