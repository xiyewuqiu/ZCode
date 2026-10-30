import { ipcRenderer } from "electron";
import { PluginSandboxChannels } from "@ycode/shared";

/**
 * 插件 UI 沙箱 guest 的 preload。只做一件事：把 main 送来的 MessagePort 经 window.postMessage
 * 原样转交给 guest 顶层文档（contextBridge 会把 MessagePort 包成 Proxy，丢失原生方法）。
 * 不暴露任何 contextBridge API；页面自己仍是 sandbox + contextIsolation，无 Node。
 */
const PLUGIN_SANDBOX_SCHEME = "ycode-sandbox:";

if (window.location.protocol === PLUGIN_SANDBOX_SCHEME) {
  ipcRenderer.on(
    PluginSandboxChannels.Init,
    (event, payload: { sandboxId?: unknown; initId?: unknown; allow?: unknown }) => {
      if (
        typeof payload?.sandboxId !== "string" ||
        typeof payload?.initId !== "number" ||
        event.ports.length !== 1
      ) {
        return;
      }
      window.postMessage(
        {
          type: "ycode-plugin-sandbox-init",
          sandboxId: payload.sandboxId,
          initId: payload.initId,
          ...(typeof payload.allow === "string" ? { allow: payload.allow } : {}),
        },
        window.location.origin,
        event.ports,
      );
    },
  );
}
