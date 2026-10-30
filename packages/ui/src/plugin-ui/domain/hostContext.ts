import {
  MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY,
  MCP_APPS_SURFACE_EXPERIMENTAL_KEY,
  MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY,
  buildMcpAppsCspExperimentalCapability,
  type McpAppsAppCapabilities,
  type McpAppsDisplayMode,
  type McpAppsHostCapabilities,
  type McpAppsHostContext,
  type McpAppsHostTitleBar,
  type McpAppsStyleVariables,
} from "@ycode/shared/mcp-apps";

/** 内联卡片默认高度上限：页面可经 size-changed 长到该值，超出由宿主滚动。 */
export const PLUGIN_UI_CARD_MAX_HEIGHT_PX = 720;

export interface PluginUiHostContextInput {
  theme: "light" | "dark";
  locale: string;
  displayMode: McpAppsDisplayMode;
  /** 容器宽度（px）；未知时 0。 */
  width: number;
  maxHeight?: number;
  titleBar?: McpAppsHostTitleBar;
  availableDisplayModes?: readonly McpAppsDisplayMode[];
  styleVariables?: McpAppsStyleVariables;
  /** 工具信息：页面据此在控件里展示当前工具名。 */
  toolInfo?: { name: string; description?: string; inputSchema?: unknown };
  platform?: "desktop" | "web" | "mobile";
}

/** hostContext 的唯一构造点：桌面与 Web 只在 platform / 尺寸上不同。 */
export function buildPluginUiHostContext(input: PluginUiHostContextInput): McpAppsHostContext {
  return {
    theme: input.theme,
    locale: input.locale,
    displayMode: input.displayMode,
    availableDisplayModes: [...(input.availableDisplayModes ?? ["inline", "fullscreen"])],
    containerDimensions: {
      width: Math.max(0, Math.round(input.width)),
      maxHeight: input.maxHeight ?? PLUGIN_UI_CARD_MAX_HEIGHT_PX,
    },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    platform: input.platform ?? "desktop",
    userAgent: "ycode",
    timeZone: resolveTimeZone(),
    deviceCapabilities: { hover: true, touch: false },
    ...(input.toolInfo ? { toolInfo: { tool: input.toolInfo } } : {}),
    ...(input.styleVariables ? { styles: { variables: input.styleVariables } } : {}),
    ...(input.titleBar ? { titleBar: input.titleBar } : {}),
  };
}

/** 页面未声明 availableDisplayModes 视为都支持；声明了就只能切到声明过的模式。 */
export function appAllowsDisplayMode(
  capabilities: McpAppsAppCapabilities | undefined,
  mode: McpAppsDisplayMode,
): boolean {
  const declared = capabilities?.availableDisplayModes;
  return !declared || declared.includes(mode);
}

/** 宿主裁决：请求的模式必须在可用集合内；pip 不是本宿主的独立模式，落回当前模式。 */
export function resolveRequestedDisplayMode(
  requested: McpAppsDisplayMode,
  current: McpAppsDisplayMode,
  available: readonly McpAppsDisplayMode[],
): McpAppsDisplayMode {
  return requested !== "pip" && available.includes(requested) ? requested : current;
}

export interface PluginUiHostCapabilityInput {
  canOpenLinks?: boolean;
  canSendFollowUpMessage?: boolean;
  canUpdateModelContext?: boolean;
  canSetWidgetState?: boolean;
  canSubscribeResources?: boolean;
  canDownloadFile?: boolean;
  surfaceId?: string;
}

/**
 * hostCapabilities 的唯一构造点。扩展能力一律放 experimental，页面按键 feature detect；
 * 没有实现的能力不声明，页面自行降级（例如无 downloadFile 时隐藏下载按钮）。
 */
export function buildPluginUiHostCapabilities(
  input: PluginUiHostCapabilityInput = {},
): McpAppsHostCapabilities {
  return {
    ...(input.canOpenLinks === false ? {} : { openLinks: {} }),
    serverTools: {},
    ...(input.canSubscribeResources ? { serverResources: { listChanged: true } } : {}),
    logging: {},
    ...(input.canDownloadFile ? { downloadFile: {} } : {}),
    ...(input.canSendFollowUpMessage ? { message: { text: {}, image: {} } } : {}),
    ...(input.canUpdateModelContext
      ? { updateModelContext: { text: {}, structuredContent: {}, image: {} } }
      : {}),
    experimental: {
      ...buildMcpAppsCspExperimentalCapability(),
      ...(input.canSetWidgetState ? { [MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY]: {} } : {}),
      ...(input.canSubscribeResources
        ? { [MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY]: {} }
        : {}),
      ...(input.surfaceId ? { [MCP_APPS_SURFACE_EXPERIMENTAL_KEY]: { id: input.surfaceId } } : {}),
    },
  };
}

interface StyleSource {
  token: string;
  fallback: string;
}

const STYLE_SOURCES: Record<string, StyleSource> = {
  "--color-background-primary": { token: "--color-background", fallback: "#ffffff" },
  "--color-background-secondary": { token: "--color-panel", fallback: "#f5f5f5" },
  "--color-background-tertiary": { token: "--color-surface", fallback: "#ededed" },
  "--color-background-inverse": { token: "--color-primary", fallback: "#0a0a0a" },
  "--color-text-primary": { token: "--color-foreground", fallback: "#404040" },
  "--color-text-secondary": { token: "--color-foreground-subtle", fallback: "#737373" },
  "--color-text-tertiary": { token: "--color-foreground-subtlest", fallback: "#a3a3a3" },
  "--color-text-inverse": { token: "--color-primary-foreground", fallback: "#fafafa" },
  "--color-border-primary": { token: "--color-border", fallback: "rgba(10, 10, 10, 0.1)" },
  "--color-border-secondary": { token: "--color-border-hover", fallback: "rgba(10, 10, 10, 0.2)" },
  "--color-ring-primary": { token: "--color-brand", fallback: "#38bdf8" },
  "--font-sans": {
    token: "--font-sans",
    fallback: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  "--font-mono": { token: "--font-mono", fallback: "ui-monospace, SFMono-Regular, monospace" },
  "--font-text-sm-size": { token: "--text-ui-sm", fallback: "12px" },
  "--font-text-md-size": { token: "--text-ui-base", fallback: "14px" },
  "--font-text-lg-size": { token: "--text-ui-lg", fallback: "16px" },
  "--border-radius-sm": { token: "--radius-sm", fallback: "4px" },
  "--border-radius-md": { token: "--radius-md", fallback: "6px" },
  "--border-radius-lg": { token: "--radius-lg", fallback: "8px" },
  "--border-radius-xl": { token: "--radius-xl", fallback: "12px" },
};

/**
 * 把宿主主题 token 映射成 MCP Apps 标准变量。页面在沙箱 origin 里无法读宿主 CSS，
 * 只能用握手时下发的值；`readToken` 由卡片从宿主根元素读取计算值，缺省用字面量兜底。
 */
export function buildPluginUiStyleVariables(
  readToken: (token: string) => string | undefined = () => undefined,
): McpAppsStyleVariables {
  const variables: McpAppsStyleVariables = {};
  for (const [key, source] of Object.entries(STYLE_SOURCES)) {
    variables[key] = readToken(source.token)?.trim() || source.fallback;
  }
  return variables;
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
