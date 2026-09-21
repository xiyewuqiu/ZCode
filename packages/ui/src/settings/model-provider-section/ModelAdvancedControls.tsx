import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LockKeyholeIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import type { ModelConfigObject } from "@zcode/provider";
import type { ProviderModelDraftValues, ProviderModelInputFormatDraft } from "./modelDraft.js";
import {
  ModelConfigHelp,
  ModelOptionCheckbox,
  ModelSettingsGroup,
  modelEditorControlStyle,
} from "./modelEditorControls.js";

function JsonSlotEditor({
  label,
  labelHelp,
  value,
  effectiveValue,
  overridden = false,
  onChange,
}: {
  label: string;
  labelHelp?: ReactNode;
  value: string;
  effectiveValue?: string;
  overridden?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1" data-model-json-slot="true">
      <div className="mb-1 block text-ui-base text-foreground-subtle">
        {label}
        {labelHelp}
      </div>
      <Textarea
        {...TECHNICAL_INPUT_ATTRIBUTES}
        data-language="json"
        // 共享 Textarea 默认按内容自适应高度，长 Effective JSON placeholder 会撑高整个弹窗。
        // JSON 槽位保持固定高度，超出内容只在输入框内部滚动。
        className={cn(
          "field-sizing-fixed h-32 min-h-32 max-h-32 resize-none overflow-y-auto rounded-lg px-3 py-2 font-mono text-foreground placeholder:text-foreground-subtlest",
          modelEditorControlStyle(overridden),
        )}
        data-personal-override={overridden}
        value={value}
        placeholder={effectiveValue}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// PDF 已经是正式的模型输入事实和可执行附件能力，旧列表漏掉它后用户无法修正该事实。
// Audio 仍没有设置页附件入口，因此继续只在 Draft 中无损保留。
const INPUT_MODALITY_OPTIONS = ["text", "image", "video", "pdf"] as const;

const INPUT_MODALITY_FIELDS = {
  image: "supportsImage",
  video: "supportsVideo",
  pdf: "supportsPdf",
} as const satisfies Record<Exclude<(typeof INPUT_MODALITY_OPTIONS)[number], "text">, string>;

type VisibleModelFormat = (typeof INPUT_MODALITY_OPTIONS)[number];

function ModalityOption({
  modality,
  selected,
  disabled = false,
  overridden = false,
  onToggle,
}: {
  modality: VisibleModelFormat;
  selected: boolean;
  disabled?: boolean;
  overridden?: boolean;
  onToggle?: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      aria-pressed={selected}
      disabled={disabled}
      data-selected={selected}
      data-personal-override={overridden}
      data-model-input-modality={modality}
      className={cn(
        "gap-2 px-3 disabled:opacity-100",
        modelEditorControlStyle(overridden, selected),
      )}
      onClick={onToggle}
    >
      <ModelOptionCheckbox selected={selected} />
      <span>{intl.formatMessage({ id: `settings.modelProvider.modality.${modality}` })}</span>
      {disabled ? (
        <LockKeyholeIcon
          className="size-3.5 shrink-0 text-foreground-subtle"
          aria-hidden="true"
          data-model-modality-lock="true"
        />
      ) : null}
    </Button>
  );
}

export function ProviderModelInputModalityOptions({
  value,
  onChange,
  overrideFields,
}: {
  value: ProviderModelInputFormatDraft;
  onChange: (value: ProviderModelInputFormatDraft) => void;
  overrideFields?: ReadonlySet<string>;
}) {
  const selected = {
    text: value.supportsText,
    image: value.supportsImage,
    video: value.supportsVideo,
    pdf: value.supportsPdf,
  };
  return (
    <div className="flex flex-wrap gap-2">
      {INPUT_MODALITY_OPTIONS.map((modality) => {
        const disabled = modality === "text";
        const field = disabled ? "supportsText" : INPUT_MODALITY_FIELDS[modality];
        const overridden = !disabled && (overrideFields?.has(`inputFormatValue.${field}`) ?? false);
        return (
          <div key={modality}>
            <ModalityOption
              modality={modality}
              selected={disabled || selected[modality]}
              disabled={disabled}
              overridden={overridden}
              onToggle={
                disabled
                  ? undefined
                  : () => onChange({ ...value, supportsText: true, [field]: !value[field] })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function ProviderModelReasoningLevelEditor({
  values,
  overridden,
  addLabel,
  deleteLabel,
  onChange,
}: {
  values: readonly string[];
  overridden: boolean;
  addLabel: string;
  deleteLabel: string;
  onChange: (values: readonly string[]) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIndex !== null) inputRef.current?.focus();
  }, [editingIndex]);

  const beginEdit = (index: number, value = values[index] ?? "") => {
    setEditingIndex(index);
    setEditingValue(value);
  };
  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };
  const commitEdit = () => {
    if (editingIndex === null) return;
    const nextValue = editingValue.trim();
    if (
      !nextValue ||
      values.some((value, index) => index !== editingIndex && value === nextValue)
    ) {
      return;
    }
    // 打开后原样失焦不是用户覆盖；否则仅查看档位就会把整组写成个人配置。
    if (editingIndex < values.length && nextValue === values[editingIndex]) {
      cancelEdit();
      return;
    }
    const next = [...values];
    if (editingIndex === values.length) next.push(nextValue);
    else next[editingIndex] = nextValue;
    onChange(next);
    cancelEdit();
  };
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= values.length || to >= values.length) return;
    const next = [...values];
    const [value] = next.splice(from, 1);
    next.splice(to, 0, value!);
    // drop 时立即提交本地顺序，避免等待外部刷新后先回位再跳转。
    onChange(next);
  };
  const handleChipKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      move(index, event.key === "ArrowLeft" ? index - 1 : index + 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginEdit(index);
    }
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault();
    if (draggingIndex !== null) move(draggingIndex, targetIndex);
    setDraggingIndex(null);
  };

  // 档位外层是普通 div；若沿用 content-box，h-8 会再叠加 2px 边框，
  // 导致静态档位、编辑框和新增按钮的实际高度不一致。
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-personal-override={overridden}
      data-model-reasoning-level-editor="true"
    >
      {values.map((value, index) => (
        <div
          key={`${value}-${index}`}
          data-model-reasoning-chip="true"
          data-personal-override={overridden}
          draggable={editingIndex !== index}
          onDragStart={(event) => {
            setDraggingIndex(index);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDrop(event, index)}
          onDragEnd={() => setDraggingIndex(null)}
          className={cn(
            "group box-border inline-flex h-8 select-none items-center rounded-lg border focus-within:bg-hover",
            modelEditorControlStyle(overridden, false),
            draggingIndex === index && "opacity-60",
          )}
        >
          {editingIndex === index ? (
            <input
              {...TECHNICAL_INPUT_ATTRIBUTES}
              ref={inputRef}
              value={editingValue}
              className="h-8 field-sizing-content min-w-10 max-w-32 border-0 bg-transparent px-2 text-ui-base text-foreground outline-none"
              data-model-reasoning-level-input="true"
              onChange={(event) => setEditingValue(event.target.value)}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEdit();
                }
              }}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-w-10 shrink cursor-grab rounded-lg border-0 bg-transparent px-2 active:cursor-grabbing hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0"
              onClick={() => beginEdit(index)}
              onKeyDown={(event) => handleChipKeyDown(event, index)}
            >
              {value}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="mr-0.5 size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
            aria-label={`${deleteLabel}: ${value}`}
            disabled={values.length <= 1}
            onClick={() => onChange(values.filter((_, valueIndex) => valueIndex !== index))}
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {editingIndex === values.length ? (
        <input
          {...TECHNICAL_INPUT_ATTRIBUTES}
          ref={inputRef}
          value={editingValue}
          className={cn(
            "h-8 field-sizing-content min-w-10 max-w-32 rounded-lg border px-2 text-ui-base text-foreground",
            modelEditorControlStyle(false),
          )}
          data-model-reasoning-level-input="true"
          onChange={(event) => setEditingValue(event.target.value)}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitEdit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          data-model-reasoning-level-add="true"
          className={modelEditorControlStyle(false, false)}
          onClick={() => beginEdit(values.length)}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{addLabel}</span>
        </Button>
      )}
    </div>
  );
}

export function ProviderModelReasoningSettings({
  draft,
  inheritedConfig,
  overrideFields,
  onDraftChange,
}: {
  draft: ProviderModelDraftValues;
  inheritedConfig?: ModelConfigObject;
  overrideFields?: ReadonlySet<string>;
  onDraftChange: (patch: Partial<ProviderModelDraftValues>) => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <ModelSettingsGroup group="reasoning">
      <div className="space-y-1">
        <div className="block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.reasoningLevelsOrdered" })}
          <ModelConfigHelp field="reasoningLevelsOrdered" />
        </div>
        <ProviderModelReasoningLevelEditor
          values={draft.reasoningLevelValuesValue}
          overridden={overrideFields?.has("reasoningLevelValuesValue") ?? false}
          addLabel={intl.formatMessage({ id: "settings.modelProvider.reasoningLevelAdd" })}
          deleteLabel={intl.formatMessage({
            id: "settings.modelProvider.reasoningLevelDelete",
          })}
          onChange={(reasoningLevelValuesValue) => onDraftChange({ reasoningLevelValuesValue })}
        />
      </div>
      <div data-model-reasoning-level-map-editor="true">
        <JsonSlotEditor
          label={intl.formatMessage({ id: "settings.modelProvider.reasoningLevelMapping" })}
          labelHelp={<ModelConfigHelp field="reasoningLevelMapping" />}
          value={draft.reasoningLevelMapValue}
          effectiveValue={
            draft.useRecommendedConfigValue === false
              ? undefined
              : (inheritedConfig?.optionSpecs?.reasoningLevel?.map ?? undefined)
          }
          overridden={overrideFields?.has("reasoningLevelMapValue") ?? false}
          onChange={(reasoningLevelMapValue) => onDraftChange({ reasoningLevelMapValue })}
        />
      </div>
    </ModelSettingsGroup>
  );
}
