import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Loader2Icon, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import type { ModelConfigObject } from "@zcode/provider";
import type { ProviderModelDraftErrorField, ProviderModelDraftValues } from "./modelDraft.js";
import {
  BooleanModelOption,
  ModelConfigHelp,
  ModelConfigInputLabel,
  ModelSettingsGroup,
  modelEditorControlStyle,
} from "./modelEditorControls.js";
import {
  ProviderModelInputModalityOptions,
  ProviderModelReasoningSettings,
} from "./ModelAdvancedControls.js";
import {
  ModelConfigDraftFeedback,
  ModelConfigRestoreButton,
  ModelEditorAdvanced,
  ModelSmartConfigSwitch,
} from "./ProviderModelDialogParts.js";

function selectFocusedInputText(event: Pick<FocusEvent<HTMLInputElement>, "currentTarget">) {
  event.currentTarget.select();
}

export function ProviderModelDialog({
  mode = "edit",
  open,
  draft,
  draftErrorMessage,
  draftErrorField,
  overrideFields,
  inheritedConfig,
  onOpenChange,
  onDraftChange,
  onRestore,
  onCommit,
  modelConfigResolutionPending = false,
  modelIdReadOnly = false,
  saving = false,
  modelDefaultsLoaded = false,
  onModelIdBlur,
}: {
  mode?: "add" | "edit";
  open: boolean;
  draft: ProviderModelDraftValues;
  draftErrorMessage: string | null;
  draftErrorField?: ProviderModelDraftErrorField | null;
  overrideFields?: ReadonlySet<string>;
  inheritedConfig?: ModelConfigObject;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (patch: Partial<ProviderModelDraftValues>) => void;
  onRestore?: () => void;
  onCommit: () => boolean | Promise<boolean>;
  modelConfigResolutionPending?: boolean;
  modelIdReadOnly?: boolean;
  saving?: boolean;
  modelDefaultsLoaded?: boolean;
  onModelIdBlur?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [validationAttempt, setValidationAttempt] = useState(0);
  const commit = async () => {
    const result = await onCommit();
    if (!result) setValidationAttempt((value) => value + 1);
  };
  const contextWindowInputId = useId();
  const maxOutputInputId = useId();
  const smart = draft.useRecommendedConfigValue !== false;
  const activeOverrides = smart ? overrideFields : undefined;
  const overridden = (field: string) => smart && (activeOverrides?.has(field) ?? false);
  const editModelLabel = intl.formatMessage({
    id: "settings.modelProvider.editModel",
  });
  // 新增模型时模型 ID 为空，如果沿用编辑态的上下文窗口自动聚焦，会让用户先落到默认数值字段。
  // 编辑态仍保留上下文窗口自动聚焦和选中，方便直接修改已有模型配置。
  const shouldFocusModelIdInput = mode === "add";
  const shouldFocusContextWindowInput = mode === "edit";
  const addModelConfigResolutionPending = smart && modelConfigResolutionPending;
  const compositionActiveRef = useRef(false);
  const handleTechnicalInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    // 输入法候选确认也会发出 Enter。某些 Electron/macOS 版本的
    // nativeEvent.isComposing 会过早恢复 false，因此同时保留本地 composition 状态。
    if (
      isImeComposingKeyEvent({
        compositionActive: compositionActiveRef.current,
        nativeEvent: event.nativeEvent,
      })
    ) {
      return;
    }
    event.preventDefault();
    void commit();
  };
  const handleCompositionStart = () => {
    compositionActiveRef.current = true;
  };
  const handleCompositionEnd = () => {
    compositionActiveRef.current = false;
  };
  const maxOutputTokensInputDisabled = mode === "add" && !draft.idValue.trim();
  const restoreButton = onRestore ? (
    <ModelConfigRestoreButton disabled={saving} onRestore={onRestore} />
  ) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mode === "edit" ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 p-0"
            aria-label={editModelLabel}
            title={editModelLabel}
          >
            <Pencil className="size-3.5 text-foreground-subtle" />
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        // overflow-hidden 仍允许聚焦触发外层滚动；语言换行后曾滚走标题。仅正文滚动，外框只裁切。
        className="max-h-[min(48rem,calc(100vh-4rem))] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {intl.formatMessage({
              id:
                mode === "add"
                  ? "settings.modelProvider.addModel"
                  : "settings.modelProvider.editModel",
            })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({
              id: "settings.modelProvider.editModelDescription",
            })}
          </DialogDescription>
          <ModelSmartConfigSwitch
            disabled={saving}
            checked={smart}
            onChange={(useRecommendedConfigValue) => onDraftChange({ useRecommendedConfigValue })}
          />
        </DialogHeader>
        {/* 保存期间锁定正文交互，不改变原有滚动容器；页脚单独显示提交状态。 */}
        <div
          inert={saving}
          className="min-h-0 min-w-0 -mr-3 space-y-4 overflow-y-auto pr-4"
          data-model-settings-scroll="true"
        >
          <ModelSettingsGroup group="basic">
            <div data-model-identity-row="true" className="flex flex-col gap-4">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-ui-base text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.modelProvider.modelId" })}
                </label>
                <Input
                  {...TECHNICAL_INPUT_ATTRIBUTES}
                  type="text"
                  autoFocus={shouldFocusModelIdInput}
                  size="lg"
                  className={cn("font-mono", modelEditorControlStyle(false))}
                  readOnly={modelIdReadOnly}
                  value={draft.idValue}
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.modelId",
                  })}
                  onChange={(event) => {
                    onDraftChange({ idValue: event.target.value });
                  }}
                  onBlur={onModelIdBlur}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelSettingsGroup group="tokens">
            <div className="space-y-3">
              <div>
                <div className="mb-1 block text-ui-base text-foreground-subtle">
                  <ModelConfigInputLabel field="contextWindow" htmlFor={contextWindowInputId} />
                </div>
                <Input
                  {...TECHNICAL_INPUT_ATTRIBUTES}
                  id={contextWindowInputId}
                  type="text"
                  autoFocus={shouldFocusContextWindowInput}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  size="lg"
                  value={draft.contextWindowValue}
                  data-personal-override={overridden("contextWindowValue")}
                  className={modelEditorControlStyle(overridden("contextWindowValue"))}
                  placeholder={
                    draft.useRecommendedConfigValue === false ||
                    inheritedConfig?.properties?.contextWindow === undefined
                      ? undefined
                      : String(inheritedConfig.properties.contextWindow)
                  }
                  onChange={(event) => {
                    onDraftChange({ contextWindowValue: event.target.value });
                  }}
                  onFocus={selectFocusedInputText}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelSettingsGroup group="tokens">
            <div className="space-y-3">
              <div data-model-max-output="true">
                <div className="mb-1 flex items-center gap-2">
                  <div className="text-ui-base text-foreground-subtle">
                    <ModelConfigInputLabel field="maxOutputTokens" htmlFor={maxOutputInputId} />
                  </div>
                  {addModelConfigResolutionPending ? (
                    <span
                      className="inline-flex shrink-0 items-center text-foreground-subtlest"
                      role="status"
                    >
                      <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                      <span className="sr-only">
                        {intl.formatMessage({ id: "common.loading" })}
                      </span>
                    </span>
                  ) : null}
                </div>
                <Input
                  {...TECHNICAL_INPUT_ATTRIBUTES}
                  id={maxOutputInputId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  size="lg"
                  value={draft.maxOutputTokensValue}
                  data-personal-override={overridden("maxOutputTokensValue")}
                  className={modelEditorControlStyle(overridden("maxOutputTokensValue"))}
                  placeholder={
                    draft.useRecommendedConfigValue === false ||
                    inheritedConfig?.optionSpecs?.maxOutputTokens?.max === undefined
                      ? undefined
                      : String(inheritedConfig.optionSpecs.maxOutputTokens.max)
                  }
                  disabled={maxOutputTokensInputDisabled}
                  aria-label={intl.formatMessage({
                    id: "settings.modelProvider.maxOutputTokens",
                  })}
                  aria-busy={addModelConfigResolutionPending}
                  onChange={(event) => onDraftChange({ maxOutputTokensValue: event.target.value })}
                  onFocus={selectFocusedInputText}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelEditorAdvanced
            open={open}
            errorField={draftErrorField}
            validationAttempt={validationAttempt}
          >
            <ModelSettingsGroup group="modalities">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 block text-ui-base text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.modelProvider.inputModalities" })}
                    <ModelConfigHelp field="inputModalities" />
                  </div>
                  <ProviderModelInputModalityOptions
                    value={draft.inputFormatValue}
                    onChange={(inputFormatValue) => onDraftChange({ inputFormatValue })}
                    overrideFields={activeOverrides}
                  />
                </div>
              </div>
            </ModelSettingsGroup>
            <ModelSettingsGroup group="capabilities">
              <div>
                <div
                  className="mb-1 block text-ui-base text-foreground-subtle"
                  data-model-capabilities-label="true"
                >
                  {intl.formatMessage({ id: "settings.modelProvider.capabilities" })}
                  <ModelConfigHelp field="capabilities" />
                </div>
                <div className="flex flex-wrap gap-2" data-model-capabilities-options="true">
                  {(
                    [
                      "supportsJsonSchemaOutput",
                      "supportsNativeWebSearch",
                      "supportsMidConversationSystem",
                    ] as const
                  ).map((property) => {
                    const field = `${property}Value` as const;
                    return (
                      <BooleanModelOption
                        key={property}
                        label={intl.formatMessage({ id: `settings.modelProvider.${property}` })}
                        selected={draft[field] ?? false}
                        onToggle={() => onDraftChange({ [field]: !(draft[field] ?? false) })}
                        overridden={overridden(field)}
                      />
                    );
                  })}
                </div>
              </div>
            </ModelSettingsGroup>
            <ProviderModelReasoningSettings
              draft={draft}
              overrideFields={activeOverrides}
              inheritedConfig={inheritedConfig}
              onDraftChange={onDraftChange}
            />
          </ModelEditorAdvanced>
        </div>
        <ModelConfigDraftFeedback error={draftErrorMessage} matched={modelDefaultsLoaded} />
        <div
          data-model-settings-footer="true"
          className="flex items-center justify-between gap-2 pt-1"
        >
          {restoreButton}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              variant="default"
              size="lg"
              disabled={saving}
              onClick={() => void commit()}
            >
              {saving ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
