import type { PluginSandboxTransportPort } from "@ycode/shared/mcp-apps";

/**
 * 宿主 renderer 侧的宿主 ↔ relay shell 消息通道：一条 MessagePort 上跑原始 JSON-RPC。
 * 不解析业务，只做帧形状检查；协议状态（握手、超时、teardown）在 pluginUiJsonRpcBridge。
 */
export interface PluginUiMessageTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
  close(): void;
}

export function createPluginUiMessageTransport(
  port: PluginSandboxTransportPort,
): PluginUiMessageTransport {
  let closed = false;
  const handlers = new Set<(message: unknown) => void>();
  port.onmessage = (event) => {
    if (closed) return;
    for (const handler of handlers) handler(event.data);
  };
  port.start?.();

  return {
    send(message) {
      if (closed) throw new Error("plugin-ui: sandbox transport closed");
      port.postMessage(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      port.onmessage = null;
      port.close();
    },
  };
}
