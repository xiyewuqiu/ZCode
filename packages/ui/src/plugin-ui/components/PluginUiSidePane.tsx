import { XIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

export type PluginUiSurfaceMode = "inline" | "fullscreen" | "pip";

export interface PluginUiSurfaceFrameProps {
  mode: PluginUiSurfaceMode;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Gen UI 承载框：inline 时是卡片内容区，fullscreen / pip 时用 fixed 定位浮在侧栏位置。
 * 始终挂同一个子节点（不 portal、不换父节点），沙箱 webview 不会因打开 / 关闭面板而重载。
 * 只负责布局与关闭，不持有桥 / 沙箱生命周期。
 */
export function PluginUiSurfaceFrame({
  mode,
  title,
  onClose,
  children,
  className,
}: PluginUiSurfaceFrameProps) {
  const { intl } = useYCodeIntl();
  useEffect(() => {
    if (mode === "inline") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, onClose]);

  return (
    <div
      data-testid="plugin-ui-surface-frame"
      data-plugin-ui-surface-mode={mode}
      role={mode === "inline" ? undefined : "dialog"}
      aria-label={mode === "inline" ? undefined : title}
      className={cn(
        mode === "inline"
          ? "w-full"
          : cn(
              "fixed z-50 flex flex-col overflow-hidden border border-border bg-card text-foreground shadow-xl",
              mode === "fullscreen"
                ? "inset-y-3 right-3 w-[min(760px,calc(100vw-1.5rem))] rounded-xl"
                : "bottom-4 right-4 h-[min(420px,50vh)] w-[min(460px,calc(100vw-2rem))] rounded-xl",
            ),
        className,
      )}
    >
      {mode === "inline" ? null : (
        <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-ui-base font-medium" title={title}>
            {title}
          </span>
          <button
            type="button"
            className="rounded-md p-1 text-foreground-subtle hover:bg-muted hover:text-foreground"
            aria-label={intl.formatMessage({ id: "common.close" })}
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </button>
        </header>
      )}
      <div className={mode === "inline" ? undefined : "min-h-0 flex-1"}>{children}</div>
    </div>
  );
}
