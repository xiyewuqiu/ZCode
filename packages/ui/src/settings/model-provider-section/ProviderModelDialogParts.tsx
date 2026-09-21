import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2Icon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ProviderModelDraftErrorField } from "./modelDraft.js";
import { ModelConfigHelp } from "./modelEditorControls.js";

/** 校验错误只可能出现在高级区或指定输入；定位选择器供展开聚焦使用。 */
const ERROR_TARGETS: Partial<Record<ProviderModelDraftErrorField, string>> = {
  maxOutputTokens: "[data-model-max-output] input",
  reasoningLevelValues: "[data-model-reasoning-level-editor] :is(input, button)",
  reasoningLevelMap: "[data-model-json-slot] textarea",
  inputModalities: '[data-model-input-modality="image"]',
};

/**
 * 「高级配置」折叠区：保持控件挂载以保留推理等级编辑器的局部草稿，
 * 并在校验失败时自动展开、聚焦到出错的输入。
 */
export function ModelEditorAdvanced({
  open,
  errorField,
  validationAttempt,
  children,
}: {
  open: boolean;
  errorField?: ProviderModelDraftErrorField | null;
  validationAttempt: number;
  children: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const ref = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      return;
    }
    // 错误位置随布局变化：最大输出已在基础区；推理等级和映射必须展开才能修正。
    if (errorField && errorField !== "maxOutputTokens" && ERROR_TARGETS[errorField]) {
      setExpanded(true);
    }
  }, [open, errorField, validationAttempt]);
  useEffect(() => {
    const selector = errorField && ERROR_TARGETS[errorField];
    if (!open || !selector || (errorField !== "maxOutputTokens" && !expanded)) return;
    const target = ref.current
      ?.closest("[data-model-settings-scroll]")
      ?.querySelector<HTMLElement>(selector);
    let cancelled = false;
    // 等实际展开动画结束再聚焦，避免滚动到尚被裁切的输入；不依赖猜测的延时。
    const animations = ref.current?.getAnimations({ subtree: true }) ?? [];
    void Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (!cancelled) target?.focus();
    });
    return () => {
      cancelled = true;
    };
  }, [open, expanded, errorField, validationAttempt]);
  return (
    <div ref={ref} data-model-advanced="true">
      <button
        type="button"
        data-model-advanced-trigger="true"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-fit cursor-pointer items-center gap-2 rounded-sm bg-transparent px-2 py-1 text-ui-base text-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ChevronRightIcon
          className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        {intl.formatMessage({ id: "settings.modelProvider.advancedConfig" })}
      </button>
      {/* 保持控件挂载，保留推理等级编辑器的局部草稿；收起时退出键盘及读屏导航。 */}
      <div
        id={contentId}
        inert={!expanded}
        aria-hidden={!expanded}
        className={`-mx-1 grid transition-[grid-template-rows,opacity,visibility] duration-200 motion-reduce:transition-none ${expanded ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-4 px-1 pt-4 pb-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** 弹窗底部的提交反馈条：错误优先，其次是「已载入推荐配置」提示。 */
export function ModelConfigDraftFeedback({
  error,
  matched,
}: {
  error?: string | null;
  matched?: boolean;
}) {
  const { intl } = useZCodeIntl();
  if (!error && !matched) return null;
  const Icon = error ? CircleAlertIcon : CheckCircle2Icon;
  return (
    <div
      role={error ? "alert" : "status"}
      className={
        error
          ? "flex min-h-10 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
          : "flex min-h-10 items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-success"
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="text-ui-sm font-medium">
        {error ?? intl.formatMessage({ id: "settings.modelProvider.modelDefaultsLoaded" })}
      </span>
    </div>
  );
}

export function ModelConfigRestoreButton({
  disabled,
  onRestore,
}: {
  disabled: boolean;
  onRestore?: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 px-0 text-ui-sm text-foreground-subtle underline underline-offset-4 hover:bg-transparent"
      disabled={disabled}
      onClick={onRestore}
    >
      {intl.formatMessage({ id: "settings.modelProvider.resetForm" })}
    </Button>
  );
}

/** 标题栏的「跟随推荐配置」开关；关闭后所有字段都成为可覆盖输入。 */
export function ModelSmartConfigSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "settings.modelProvider.followRecommendedConfig" });
  return (
    <div
      data-model-recommended-config="true"
      className="flex shrink-0 items-center justify-start gap-2 pt-2 text-ui-base text-foreground"
    >
      <span className="inline-flex items-center whitespace-nowrap">
        {label}
        <ModelConfigHelp field="followRecommendedConfig" />
      </span>
      <Switch disabled={disabled} aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
