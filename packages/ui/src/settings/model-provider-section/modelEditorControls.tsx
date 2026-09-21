import { useState, type ReactNode } from "react";
import { CheckIcon, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 模型编辑器专用：边框仅标记覆盖，Hover/焦点用同一底色，不修改全站控件。 */
export function modelEditorControlStyle(overridden: boolean, selected?: boolean) {
  return cn(
    "outline-none focus-visible:ring-0",
    overridden
      ? "border-primary/35 hover:border-primary/35 focus-visible:border-primary/35"
      : "border-border hover:border-border focus-visible:border-border",
    // 浅色 selected 与 hover 原本同为 5%，点击后看不出变化；仅方块底色增强，覆盖边框不变。
    selected === true
      ? "bg-foreground/15 bg-clip-border hover:bg-foreground/20 focus-visible:bg-foreground/20"
      : selected === false
        ? "bg-transparent hover:bg-hover focus-visible:bg-hover"
        : "bg-input hover:bg-hover focus-visible:bg-hover",
  );
}

type ModelConfigHelpField =
  | "contextWindow"
  | "maxOutputTokens"
  | "inputModalities"
  | "capabilities"
  | "reasoningLevelsOrdered"
  | "reasoningLevelMapping"
  | "followRecommendedConfig";

export function ModelConfigHelp({ field }: { field: ModelConfigHelpField }) {
  const [open, setOpen] = useState(false);
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: `settings.modelProvider.${field}` });
  const copy = intl.formatMessage({ id: `settings.modelProvider.help.${field}` });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="ml-1 size-6 align-middle text-foreground-subtle"
          data-model-help={field}
          aria-label={intl.formatMessage(
            { id: "settings.modelProvider.fieldHelp" },
            { field: label },
          )}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setOpen(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setOpen(false);
          }}
          onFocus={() => setOpen(true)}
          onClick={(event) => {
            // 点击/触摸只打开说明；阻止 Radix 在已由 focus/hover 打开时反向关闭，不触发相邻表单控件。
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        data-model-help-content={field}
        align="start"
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[min(28rem,calc(100vh-2rem))] overflow-y-auto p-3 text-ui-sm leading-relaxed"
      >
        <div className="space-y-2">
          {copy.split("\n\n").map((paragraph, index) =>
            paragraph.startsWith("- ") ? (
              <ul key={index} className="list-disc space-y-1 pl-4">
                {paragraph.split("\n").map((line, lineIndex) => (
                  <li key={lineIndex}>{emphasis(line.slice(2))}</li>
                ))}
              </ul>
            ) : (
              <p key={index} className="whitespace-pre-line">
                {emphasis(paragraph)}
              </p>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ModelConfigInputLabel({
  field,
  htmlFor,
}: {
  field: ModelConfigHelpField;
  htmlFor: string;
}) {
  const { intl } = useZCodeIntl();
  return (
    // 帮助按钮必须是 label 的兄弟，避免抢走输入关联和标题点击焦点。
    <>
      <label htmlFor={htmlFor}>
        {intl.formatMessage({ id: `settings.modelProvider.${field}` })}
      </label>
      <ModelConfigHelp field={field} />
    </>
  );
}

// 只呈现定稿语言包的加粗/行内代码，不解释 HTML、链接或用户输入。
function emphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") ? (
      <code key={index} className="font-mono">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

export function ModelSettingsGroup({
  group,
  children,
}: {
  group: "basic" | "tokens" | "modalities" | "capabilities" | "reasoning";
  children: ReactNode;
}) {
  return (
    <section className="space-y-4" data-model-settings-group={group}>
      {children}
    </section>
  );
}

/** 外层按钮负责完整点击与键盘语义；指示框不可再嵌一个可聚焦控件。 */
export function ModelOptionCheckbox({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-model-option-checkbox="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
        // 边框不能跟随勾号的反色，否则选中后框体出现反色描边；与系统 Checkbox 使用相同颜色。
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input-border bg-input",
      )}
    >
      {selected ? <CheckIcon className="size-3" /> : null}
    </span>
  );
}

export function BooleanModelOption({
  label,
  selected,
  onToggle,
  overridden = false,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  overridden?: boolean;
}) {
  return (
    <Button
      type="button"
      role="checkbox"
      variant="outline"
      size="lg"
      aria-checked={selected}
      data-selected={selected}
      data-model-boolean-option="true"
      data-model-capability-option="true"
      data-personal-override={overridden}
      className={cn(
        "gap-2 disabled:opacity-100",
        "px-3",
        modelEditorControlStyle(overridden, selected),
      )}
      onClick={onToggle}
    >
      <ModelOptionCheckbox selected={selected} />
      <span>{label}</span>
    </Button>
  );
}
