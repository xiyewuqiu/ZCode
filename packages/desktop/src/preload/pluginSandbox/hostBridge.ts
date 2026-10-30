import { contextBridge, ipcRenderer } from "electron";
import { InternalChannels, PlatformChannels } from "@ycode/shared";
import type { PluginSandboxRegisterRequestPayload } from "@ycode/shared/mcp-apps";

/**
 * 宿主 renderer 的插件沙箱桥。独立命名空间（window.ycodePluginSandbox），不进 window.ycode；
 * 只暴露明确的沙箱操作。MessagePort 不能过 contextBridge，走 window.postMessage transfer。
 */
export function installPluginSandboxHostBridge(): void {
  contextBridge.exposeInMainWorld("ycodePluginSandbox", {
    getOwnerWebContentsId: () =>
      ipcRenderer.invoke(PlatformChannels.PluginSandboxOwnerWebContentsId) as Promise<number>,
    registerSandbox: (input: PluginSandboxRegisterRequestPayload) =>
      ipcRenderer.invoke(PlatformChannels.PluginSandboxRegister, input),
    disposeSandbox: (sandboxId: string, initId?: number) =>
      ipcRenderer.invoke(PlatformChannels.PluginSandboxDispose, sandboxId, initId) as Promise<void>,
    consumeUserGesture: (sandboxId: string) =>
      ipcRenderer.invoke(
        PlatformChannels.PluginSandboxConsumeUserGesture,
        sandboxId,
      ) as Promise<boolean>,
  });

  ipcRenderer.on(
    InternalChannels.PluginSandboxPorts,
    (event, payload: { sandboxId?: unknown; initId?: unknown }) => {
      if (typeof payload?.sandboxId !== "string" || typeof payload?.initId !== "number") {
        return;
      }
      window.postMessage(
        {
          type: InternalChannels.PluginSandboxPorts,
          sandboxId: payload.sandboxId,
          initId: payload.initId,
        },
        "*",
        event.ports,
      );
    },
  );
}
