import { InternalChannels } from "@ycode/shared";
import type { IPlatformService } from "@ycode/shared";
import type {
  PluginSandboxPlatformPort,
  PluginSandboxPortsEvent,
  PluginSandboxRegisterRequestPayload,
  PluginSandboxTransportPort,
} from "@ycode/shared/mcp-apps";

/**
 * 桌面 renderer 的插件沙箱平台端口。只有 preload 暴露 `window.ycodePluginSandbox` 时才存在；
 * 旧 preload / Web 端缺失该字段，UI 据此回退为普通工具输出。
 * MessagePort 走 preload 的 window.postMessage transfer，本模块只做校验与分发。
 */
function createDesktopPluginSandboxPlatform(): PluginSandboxPlatformPort | undefined {
  const bridge = window.ycodePluginSandbox;
  if (!bridge) return undefined;
  return {
    getOwnerWebContentsId: () => bridge.getOwnerWebContentsId(),
    registerSandbox: async (input: PluginSandboxRegisterRequestPayload) => {
      const result = await bridge.registerSandbox(input);
      if (!result?.ok) throw new Error(result?.error ?? "Sandbox registration failed");
      return {
        instance: result.instance,
        sandboxId: result.sandboxId,
        initId: result.initId,
        shellUrl: result.shellUrl,
        partition: result.partition,
        ...(result.resourceMeta ? { resourceMeta: result.resourceMeta } : {}),
      };
    },
    disposeSandbox: (sandboxId, initId) => bridge.disposeSandbox(sandboxId, initId),
    consumeUserGesture: (sandboxId) => bridge.consumeUserGesture(sandboxId),
    onPorts(handler) {
      const listener = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as { type?: unknown; sandboxId?: unknown; initId?: unknown };
        if (
          data?.type !== InternalChannels.PluginSandboxPorts ||
          typeof data.sandboxId !== "string" ||
          typeof data.initId !== "number"
        ) {
          return;
        }
        const [port] = event.ports;
        if (!port) return;
        handler({
          sandboxId: data.sandboxId,
          initId: data.initId,
          port: port as unknown as PluginSandboxTransportPort,
        } satisfies PluginSandboxPortsEvent);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}

export const desktopPluginSandboxPlatform = {
  pluginSandbox: createDesktopPluginSandboxPlatform(),
} satisfies Pick<IPlatformService, "pluginSandbox">;
