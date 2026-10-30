import { createContext, useContext, type ReactNode } from "react";
import type { PluginUiHostPort } from "@ycode/shared/mcp-apps";
import type { PluginUiAppLoader, PluginUiPermission } from "@/plugin-ui/domain/contract.js";

export interface PluginUiHostContextValue {
  /**
   * 宿主端口：读取 `ui://` 资源、签发实例凭证、登记沙箱、回调工具 / 资源与实例信箱。
   * 未提供时卡片走 fallback（展示结构化结果），工具结果本身照常渲染。
   */
  host?: PluginUiHostPort;
  /** 兼容旧注入：只返回 HTML + 凭证，不提供工具 / 资源回调。 */
  loader?: PluginUiAppLoader;
  /** 按 serverName 提供权限声明；缺省表示未声明（宿主一律拒绝）。 */
  permissionsFor?: (input: {
    serverName: string;
    pluginId: string;
  }) => readonly PluginUiPermission[] | undefined;
  /** 页面 `ui/open-link` 的宿主出口；缺省时桥拒绝该请求。 */
  onOpenExternal?: (url: string) => void;
  /** 宿主平台，进 hostContext。 */
  platform?: "desktop" | "web" | "mobile";
  /** 当前会话 id；工具行本身不带会话身份，由宿主 provider 绑定。 */
  sessionId?: string;
  /** 当前工作区身份；远程 workspace 用 identity 关联，缺省按路径。 */
  workspaceIdentity?: string;
  /** hostInfo.version；只供页面 feature detect。 */
  hostVersion?: string;
}

const PluginUiHostContext = createContext<PluginUiHostContextValue>({});

/**
 * 宿主 bridge 的注入点：桌面 Host / 完整 plugin-ui-bridge 在应用根部提供 `host`，
 * 由它负责资源读取、凭证签发与沙箱登记。未提供时卡片只展示结构化摘要，工具结果照常渲染。
 */
export function PluginUiHostProvider({
  host,
  loader,
  permissionsFor,
  onOpenExternal,
  platform,
  sessionId,
  workspaceIdentity,
  hostVersion,
  children,
}: PluginUiHostContextValue & { children: ReactNode }) {
  return (
    <PluginUiHostContext.Provider
      value={{
        ...(host ? { host } : {}),
        ...(loader ? { loader } : {}),
        ...(permissionsFor ? { permissionsFor } : {}),
        ...(onOpenExternal ? { onOpenExternal } : {}),
        ...(platform ? { platform } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(hostVersion ? { hostVersion } : {}),
      }}
    >
      {children}
    </PluginUiHostContext.Provider>
  );
}

export function usePluginUiHostContext(): PluginUiHostContextValue {
  return useContext(PluginUiHostContext);
}
