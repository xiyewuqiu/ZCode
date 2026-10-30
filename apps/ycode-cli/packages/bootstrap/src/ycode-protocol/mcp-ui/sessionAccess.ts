import { resolveMcpToolVisibility } from "@ycode/contracts";
import type { McpUiSessionAccess } from "./contract.js";
import type { McpUiAgentAccess } from "./agentAccess.js";

/**
 * 把 App 的窄 MCP 访问面适配成 mcp-ui 的 session access。
 * descriptor 每次现读 `tools/list` 快照（McpPort 已缓存连接内的工具表），
 * 避免在 CLI 侧再维护一份可能与运行时漂移的工具目录。
 */
export function createMcpUiSessionAccess(access: McpUiAgentAccess): McpUiSessionAccess {
  const findDescriptor = async (serverName: string, toolName: string) => {
    const descriptors = await access.listToolDescriptors();
    return descriptors.find(
      (descriptor) => descriptor.serverName === serverName && descriptor.toolName === toolName,
    );
  };

  return {
    hasMcpServer: (serverName) => access.hasMcpServer(serverName),
    async getToolVisibility(serverName, toolName) {
      const descriptor = await findDescriptor(serverName, toolName);
      return descriptor ? resolveMcpToolVisibility(descriptor) : null;
    },
    async getToolUi(serverName, toolName) {
      const descriptor = await findDescriptor(serverName, toolName);
      return descriptor?.ui ?? null;
    },
    readResource: (serverName, uri, options) => access.readResource(serverName, uri, options),
    readResourceForUi: (serverName, uri, options) =>
      access.readResource(serverName, uri, options),
    // 页面调用优先走 session facade 的授权入口（executor + permission broker + 连接代际固定）；
    // 旧装配 / mock 没有该入口时才回退到裸端口，可见性仍已在 handlers 校验。
    callTool: (serverName, toolName, args, options) =>
      (access.callToolForUi ?? access.callTool)(serverName, toolName, args, options),
    getMcpAppConnectionSnapshot: (serverName) =>
      access.getMcpAppConnectionSnapshot?.(serverName) ?? null,
    ...(access.onMcpAppConnectionInvalidated
      ? { onMcpAppConnectionInvalidated: access.onMcpAppConnectionInvalidated }
      : {}),
  };
}
