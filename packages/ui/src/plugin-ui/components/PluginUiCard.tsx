import { PanelRightOpenIcon, PuzzleIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { cn } from "@/components/lib/utils.js";
import { resolveTheme, type Theme } from "@/useTheme.js";
import { usePluginUiAppRuntime } from "@/plugin-ui/adapters/usePluginUiAppRuntime.js";
import { PluginUiSurfaceFrame } from "@/plugin-ui/components/PluginUiSidePane.js";
import { usePluginUiHostContext } from "@/plugin-ui/components/PluginUiHostProvider.js";
import {
  formatPluginUiFallbackReason,
  parsePluginUiJson,
  readPluginUiPreview,
  type PluginUiAppLoader,
  type PluginUiDisplay,
  type PluginUiPermission,
} from "@/plugin-ui/domain/contract.js";

export interface PluginUiCardProps {
  display: PluginUiDisplay;
  toolCallId: string;
  serverName: string;
  toolName: string;
  sessionId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  theme?: Theme;
  /** 工具输入 / 结果：握手完成后经 `ui/notifications/tool-input|tool-result` 投递给页面。 */
  toolInput?: unknown;
  toolResult?: unknown;
  toolCancelled?: boolean;
  /** 兼容基础切片的注入；优先使用宿主 context 的 host port。 */
  appLoader?: PluginUiAppLoader;
  permissions?: PluginUiPermission[];
  className?: string;
}

const MAX_PREVIEW_CHARS = 4_000;
const PERMISSION_LABEL_KEYS: Record<PluginUiPermission, string> = {
  camera: "pluginUi.permission.camera",
  microphone: "pluginUi.permission.microphone",
  geolocation: "pluginUi.permission.geolocation",
  clipboardWrite: "pluginUi.permission.clipboardWrite",
};

/**
 * 单个 MCP App 卡片：宿主可用时在独立 partition 的 `<webview>` 里渲染沙箱页面，
 * 经 MessagePort 完成 `ui/*` 握手并投递工具结果；fullscreen / pip / surface 时同一个沙箱浮到侧栏。
 * 宿主 / 资源 / 桥不可用时退回结构化摘要与原始工具输出，绝不阻塞工具结果或会话。
 */
export function PluginUiCard({
  display,
  toolCallId,
  serverName,
  toolName,
  sessionId: sessionIdProp,
  workspacePath,
  workspaceIdentity: workspaceIdentityProp,
  theme,
  toolInput,
  toolResult,
  toolCancelled,
  appLoader,
  permissions,
  className,
}: PluginUiCardProps) {
  const { intl, locale } = useYCodeIntl();
  const hostContext = usePluginUiHostContext();
  const sessionId = sessionIdProp ?? hostContext.sessionId;
  const workspaceIdentity = workspaceIdentityProp ?? hostContext.workspaceIdentity;
  const platform = useOptionalPlatform();
  const sandbox = platform?.pluginSandbox;
  const containerRef = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  const runtime = usePluginUiAppRuntime({
    display,
    toolCallId,
    serverName,
    toolName,
    ...(sessionId ? { sessionId } : {}),
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(toolInput !== undefined ? { toolInput } : {}),
    ...(toolResult !== undefined ? { toolResult } : {}),
    ...(toolCancelled ? { toolCancelled: true } : {}),
    theme: resolveTheme(theme ?? "system"),
    locale,
    width,
    ...(hostContext.host ? { host: hostContext.host } : {}),
    ...((appLoader ?? hostContext.loader) ? { legacyLoader: appLoader ?? hostContext.loader } : {}),
    ...(hostContext.onOpenExternal ? { onOpenExternal: hostContext.onOpenExternal } : {}),
    ...(hostContext.hostVersion ? { hostVersion: hostContext.hostVersion } : {}),
    ...(sandbox ? { platformOverride: sandbox } : {}),
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === "number" && Number.isFinite(next)) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const effectivePermissions = useMemo(
    () => runtime.handle?.resourceMeta?.permissions ?? permissions ?? [],
    [permissions, runtime.handle?.resourceMeta?.permissions],
  );
  const preview = useMemo(() => readPluginUiPreview(display), [display]);
  const previewText = useMemo(() => formatPreview(preview), [preview]);
  const statusLabel = intl.formatMessage({ id: "pluginUi.card.app" });
  const openLabel = locale.toLocaleLowerCase().startsWith("zh")
    ? "在侧栏打开"
    : "Open in side panel";
  const permissionText =
    effectivePermissions.length > 0
      ? effectivePermissions.map((permission) =>
          intl.formatMessage({ id: PERMISSION_LABEL_KEYS[permission] }),
        )
      : [];
  const title = `${formatPluginLabel(display.pluginId)} · ${serverName}`;
  const surfaceMode = runtime.handle && runtime.sideMode !== "inline" ? runtime.sideMode : "inline";
  const showWebview =
    Boolean(runtime.handle) && (runtime.status === "ready" || runtime.status === "loading");

  return (
    <section
      ref={containerRef}
      data-testid="plugin-ui-card"
      data-plugin-ui-status={runtime.status}
      data-plugin-ui-surface={display.surface ?? ""}
      className={cn(
        "overflow-hidden rounded-xl border bg-card text-foreground",
        display.prefersBorder ? "border-border" : "border-border/60",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <PuzzleIcon className="size-4 shrink-0 text-foreground-subtle" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-ui-base font-medium">
            <span className="truncate" title={`${serverName} · ${toolName}`}>
              {formatPluginLabel(display.pluginId)}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-ui-sm text-foreground-subtle">
              {statusLabel}
            </span>
          </div>
          <p className="truncate text-ui-sm text-foreground-subtlest">{display.resourceUri}</p>
        </div>
        {permissionText.length > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-ui-sm text-foreground-subtle"
            title={permissionText.join(", ")}
          >
            <ShieldCheckIcon className="size-3.5" />
            {permissionText.join(", ")}
          </span>
        ) : null}
        {showWebview && surfaceMode === "inline" ? (
          <button
            type="button"
            className="rounded-md p-1 text-foreground-subtle hover:bg-muted hover:text-foreground"
            aria-label={openLabel}
            title={openLabel}
            onClick={() =>
              runtime.setSideMode(display.preferredDisplayMode === "pip" ? "pip" : "fullscreen")
            }
          >
            <PanelRightOpenIcon className="size-4" />
          </button>
        ) : null}
      </header>

      {showWebview ? (
        <PluginUiSurfaceFrame
          mode={surfaceMode}
          title={title}
          onClose={() => runtime.setSideMode("inline")}
          className={surfaceMode === "inline" ? "bg-background" : undefined}
        >
          <webview
            data-zcode-retained-sandbox="true"
            partition={runtime.handle?.partition}
            src={runtime.handle?.shellUrl}
            className="block w-full border-0"
            style={{
              height: `${runtime.height}px`,
              minHeight: runtime.minHeight ? `${runtime.minHeight}px` : undefined,
            }}
          />
        </PluginUiSurfaceFrame>
      ) : (
        <div className="space-y-2 px-3 py-2" data-testid="plugin-ui-fallback">
          <p className="text-ui-sm text-foreground-subtlest">
            {runtime.status === "loading"
              ? intl.formatMessage({ id: "pluginUi.card.loading" })
              : intl.formatMessage({ id: "pluginUi.card.unavailable" })}
          </p>
          {runtime.status === "fallback" ? (
            <p
              className="break-words text-ui-sm text-foreground-subtlest"
              data-testid="plugin-ui-fallback-reason"
              data-plugin-ui-fallback-reason={runtime.reason ?? "error"}
            >
              {formatPluginUiFallbackReason(runtime.reason, runtime.message)}
            </p>
          ) : null}
          {previewText ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-2 py-1.5 text-ui-sm text-foreground-subtle">
              {previewText}
            </pre>
          ) : null}
        </div>
      )}

      {showWebview && runtime.status === "loading" ? (
        <p className="border-t border-border/60 px-3 py-1 text-ui-sm text-foreground-subtlest">
          {intl.formatMessage({ id: "pluginUi.card.loading" })}
        </p>
      ) : null}
    </section>
  );
}

function formatPluginLabel(pluginId: string): string {
  const segments = pluginId.split(":");
  return segments.at(-1) || pluginId;
}

function formatPreview(preview: string | undefined): string | undefined {
  if (!preview) return undefined;
  const parsed = parsePluginUiJson(preview);
  const text = parsed === undefined ? preview : JSON.stringify(parsed, null, 2);
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text;
}
