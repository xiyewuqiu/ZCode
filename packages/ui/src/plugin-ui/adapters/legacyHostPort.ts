import type {
  PluginSandboxHandle,
  PluginSandboxPlatformPort,
  PluginUiHostPort,
  PluginUiPrepareSandboxParams,
} from "@ycode/shared/mcp-apps";
import type { PluginUiAppLoader, PluginUiDisplay } from "@/plugin-ui/domain/contract.js";

/**
 * 兼容基础切片：宿主只提供 HTML 加载器时，仍能登记沙箱并完成握手；
 * 页面发起的工具 / 资源请求一律 -32601（在桥上由“无 handler”处理），不能绕过正常执行器。
 * 完整 host port 由桌面 Host 注入，优先使用它。
 */
export function createLegacyPluginUiHostPort(input: {
  display: PluginUiDisplay;
  loader: PluginUiAppLoader;
  platform: PluginSandboxPlatformPort & {
    registerSandbox: (
      payload: import("@ycode/shared/mcp-apps").PluginSandboxRegisterRequestPayload,
    ) => Promise<PluginSandboxHandle>;
  };
}): PluginUiHostPort {
  return {
    async prepareSandbox(params: PluginUiPrepareSandboxParams) {
      const source = await input.loader(input.display);
      if (!source) throw new Error("MCP App resource is unavailable");
      const ownerWebContentsId = await input.platform.getOwnerWebContentsId();
      return input.platform.registerSandbox({
        instance: source.instance,
        requestId: params.scopeId,
        ownerWebContentsId,
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        html: source.html,
        ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.csp ? { csp: params.csp } : {}),
        ...(params.cspRelaxations ? { cspRelaxations: params.cspRelaxations } : {}),
        ...(params.prefersBorder !== undefined ? { prefersBorder: params.prefersBorder } : {}),
      });
    },
    async validateInstance() {},
    async closeInstance() {},
    async callTool() {
      throw new Error("MCP App tool calls require the full host bridge");
    },
    async cancelToolCall() {
      return { cancelled: false };
    },
    async readResource() {
      throw new Error("MCP App resource reads require the full host bridge");
    },
  };
}
