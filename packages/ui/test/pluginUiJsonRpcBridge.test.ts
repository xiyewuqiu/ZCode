import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_APPS_JSON_RPC_ERRORS,
  MCP_APPS_MCP_METHODS,
  MCP_APPS_SET_WIDGET_STATE_METHOD,
  MCP_APPS_UI_METHODS,
} from "@ycode/shared/mcp-apps";
import {
  createPluginUiJsonRpcBridge,
  type PluginUiBridgeHandlers,
} from "../src/plugin-ui/app/pluginUiJsonRpcBridge.js";
import type { PluginUiMessageTransport } from "../src/plugin-ui/adapters/messagePortTransport.js";

interface SentFrame {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function createTransport() {
  const sent: SentFrame[] = [];
  let handler: ((message: unknown) => void) | null = null;
  let closed = false;
  const transport: PluginUiMessageTransport = {
    send(message) {
      sent.push(message as SentFrame);
    },
    onMessage(next) {
      handler = next;
      return () => {
        handler = null;
      };
    },
    close() {
      closed = true;
    },
  };
  return {
    transport,
    sent,
    isClosed: () => closed,
    receive(message: unknown) {
      handler?.(message);
    },
  };
}

function createManualTimers() {
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  return {
    setTimer(callback: () => void, ms: number) {
      const id = next++;
      timers.set(id, { callback, ms });
      return () => timers.delete(id);
    },
    fire(ms: number) {
      for (const [id, timer] of Array.from(timers)) {
        if (timer.ms !== ms) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    pending: () => timers.size,
  };
}

function createHandlers(overrides: Partial<PluginUiBridgeHandlers> = {}): PluginUiBridgeHandlers {
  return {
    async callTool(params) {
      return { content: [{ type: "text", text: params.name }] };
    },
    async readResource(uri) {
      return { contents: [{ uri, text: "resource" }] };
    },
    openLink() {},
    requestDisplayMode(mode) {
      return mode;
    },
    setWidgetState() {},
    ...overrides,
  };
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function frame(sent: SentFrame[], predicate: (entry: SentFrame) => boolean) {
  return sent.find(predicate);
}

test("bridge handshakes, buffers the tool feed before ready and exposes host info/context", async () => {
  const t = createTransport();
  const timers = createManualTimers();
  const lifecycle: string[] = [];
  const bridge = createPluginUiJsonRpcBridge({
    transport: t.transport,
    hostInfo: { name: "ycode", version: "1" },
    hostCapabilities: { serverTools: {} },
    hostContext: {
      theme: "light",
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    },
    initialWidgetState: { selected: "one" },
    handlers: createHandlers(),
    setTimer: timers.setTimer,
    handshakeTimeoutMs: 50,
    teardownTimeoutMs: 5,
    onInitialized: ({ appCapabilities }) =>
      lifecycle.push(`initialized:${String(appCapabilities?.tools?.listChanged)}`),
    onFailed: (reason) => lifecycle.push(`failed:${reason}`),
    onClosed: (reason) => lifecycle.push(`closed:${reason}`),
  });

  bridge.sendToolResult({ content: [{ type: "text", text: "early" }] });
  assert.equal(t.sent.length, 0);

  // 握手完成前，除 ui/initialize 外的请求一律 invalidRequest。
  t.receive({ jsonrpc: "2.0", id: 9, method: MCP_APPS_MCP_METHODS.ping });
  await tick();
  const early = frame(t.sent, (entry) => entry.id === 9);
  assert.equal(early?.error?.code, MCP_APPS_JSON_RPC_ERRORS.invalidRequest);

  t.receive({
    jsonrpc: "2.0",
    id: 1,
    method: MCP_APPS_UI_METHODS.initialize,
    params: {
      protocolVersion: "2025-06-18",
      appCapabilities: { tools: { listChanged: true } },
    },
  });
  await tick();
  const initialized = frame(t.sent, (entry) => entry.id === 1);
  assert.ok(initialized);
  const initResult = initialized.result as {
    protocolVersion: string;
    hostInfo: { name: string };
    hostCapabilities: Record<string, unknown>;
    hostContext: Record<string, unknown>;
  };
  assert.equal(initResult.protocolVersion, "2025-06-18");
  assert.deepEqual(initResult.hostInfo, { name: "ycode", version: "1" });
  assert.deepEqual(initResult.hostCapabilities, { serverTools: {} });
  assert.deepEqual(initResult.hostContext["ycode/widgetState"], { selected: "one" });
  assert.equal(bridge.phase, "handshaking");

  t.receive({ jsonrpc: "2.0", method: MCP_APPS_UI_METHODS.initialized });
  assert.equal(bridge.phase, "ready");
  assert.equal(bridge.appCapabilities?.tools?.listChanged, true);
  assert.deepEqual(lifecycle, ["initialized:true"]);

  // 握手前保留的 tool-result 在 ready 时补发。
  const flushed = frame(t.sent, (entry) => entry.method === MCP_APPS_UI_METHODS.toolResult);
  assert.deepEqual(flushed?.params, { content: [{ type: "text", text: "early" }] });

  bridge.sendToolInput({ arguments: { query: "q" } });
  const input = t.sent.at(-1);
  assert.equal(input?.method, MCP_APPS_UI_METHODS.toolInput);
  assert.deepEqual(input?.params, { arguments: { query: "q" } });

  bridge.sendToolCancelled();
  assert.equal(t.sent.at(-1)?.method, MCP_APPS_UI_METHODS.toolCancelled);
  bridge.dispose("test");
  assert.equal(t.isClosed(), true);
});

test("unsupported ui/* methods fail closed while tool/resource/link requests route to handlers", async () => {
  const t = createTransport();
  const timers = createManualTimers();
  const opened: string[] = [];
  const widgets: unknown[] = [];
  createPluginUiJsonRpcBridge({
    transport: t.transport,
    hostInfo: { name: "ycode", version: "1" },
    hostCapabilities: {},
    hostContext: {
      theme: "light",
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    },
    handlers: createHandlers({
      openLink: (url) => opened.push(url),
      setWidgetState: (state) => widgets.push(state),
    }),
    setTimer: timers.setTimer,
    handshakeTimeoutMs: 50,
  });
  t.receive({
    jsonrpc: "2.0",
    id: 1,
    method: MCP_APPS_UI_METHODS.initialize,
    params: { protocolVersion: "2025-06-18" },
  });
  t.receive({ jsonrpc: "2.0", method: MCP_APPS_UI_METHODS.initialized });
  await tick();

  t.receive({ jsonrpc: "2.0", id: 2, method: MCP_APPS_UI_METHODS.message, params: {} });
  t.receive({ jsonrpc: "2.0", id: 3, method: MCP_APPS_MCP_METHODS.resourcesRead, params: {} });
  t.receive({
    jsonrpc: "2.0",
    id: 4,
    method: MCP_APPS_UI_METHODS.openLink,
    params: { url: "file:///etc/passwd" },
  });
  t.receive({
    jsonrpc: "2.0",
    id: 5,
    method: MCP_APPS_UI_METHODS.openLink,
    params: { url: "https://example.com/docs" },
  });
  t.receive({
    jsonrpc: "2.0",
    id: 6,
    method: MCP_APPS_MCP_METHODS.toolsCall,
    params: { name: "show", arguments: { a: 1 } },
  });
  t.receive({
    jsonrpc: "2.0",
    id: 7,
    method: MCP_APPS_MCP_METHODS.resourcesRead,
    params: { uri: "ui://app/data.json" },
  });
  t.receive({
    jsonrpc: "2.0",
    id: 8,
    method: MCP_APPS_SET_WIDGET_STATE_METHOD,
    params: { widgetState: { view: "list" } },
  });
  t.receive({ jsonrpc: "2.0", id: 10, method: MCP_APPS_MCP_METHODS.resourcesList, params: {} });
  await tick();

  assert.equal(
    frame(t.sent, (entry) => entry.id === 2)?.error?.code,
    MCP_APPS_JSON_RPC_ERRORS.methodNotFound,
  );
  assert.equal(
    frame(t.sent, (entry) => entry.id === 3)?.error?.code,
    MCP_APPS_JSON_RPC_ERRORS.invalidParams,
  );
  assert.equal(
    frame(t.sent, (entry) => entry.id === 4)?.error?.code,
    MCP_APPS_JSON_RPC_ERRORS.invalidParams,
  );
  assert.deepEqual(frame(t.sent, (entry) => entry.id === 5)?.result, {});
  assert.deepEqual(opened, ["https://example.com/docs"]);
  assert.deepEqual(frame(t.sent, (entry) => entry.id === 6)?.result, {
    content: [{ type: "text", text: "show" }],
  });
  assert.deepEqual(frame(t.sent, (entry) => entry.id === 7)?.result, {
    contents: [{ uri: "ui://app/data.json", text: "resource" }],
  });
  assert.deepEqual(widgets, [{ view: "list" }]);
  assert.equal(
    frame(t.sent, (entry) => entry.id === 10)?.error?.code,
    MCP_APPS_JSON_RPC_ERRORS.methodNotFound,
  );
});

test("page notification cancellation aborts the in-flight tool call", async () => {
  const t = createTransport();
  const timers = createManualTimers();
  let aborted = false;
  let cancelledCallId: string | undefined;
  let callId: string | undefined;
  createPluginUiJsonRpcBridge({
    transport: t.transport,
    hostInfo: { name: "ycode", version: "1" },
    hostCapabilities: {},
    hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
    handlers: createHandlers({
      callTool: (params, { signal }) =>
        new Promise((_resolve, reject) => {
          callId = params.callId;
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
      cancelToolCall: (id) => {
        cancelledCallId = id;
      },
    }),
    setTimer: timers.setTimer,
    handshakeTimeoutMs: 50,
  });
  t.receive({
    jsonrpc: "2.0",
    id: 1,
    method: MCP_APPS_UI_METHODS.initialize,
    params: { protocolVersion: "2025-06-18" },
  });
  t.receive({ jsonrpc: "2.0", method: MCP_APPS_UI_METHODS.initialized });
  await tick();

  t.receive({
    jsonrpc: "2.0",
    id: 20,
    method: MCP_APPS_MCP_METHODS.toolsCall,
    params: { name: "show" },
  });
  await tick();
  assert.ok(callId);
  t.receive({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 20 },
  });
  await tick();

  assert.equal(aborted, true);
  assert.equal(cancelledCallId, callId);
  assert.equal(
    frame(t.sent, (entry) => entry.id === 20)?.error?.code,
    MCP_APPS_JSON_RPC_ERRORS.internalError,
  );
});

test("display mode only changes inside available modes and pushes host-context-changed", async () => {
  const t = createTransport();
  const timers = createManualTimers();
  const bridge = createPluginUiJsonRpcBridge({
    transport: t.transport,
    hostInfo: { name: "ycode", version: "1" },
    hostCapabilities: {},
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    },
    handlers: createHandlers(),
    setTimer: timers.setTimer,
    handshakeTimeoutMs: 50,
  });
  t.receive({
    jsonrpc: "2.0",
    id: 1,
    method: MCP_APPS_UI_METHODS.initialize,
    params: { protocolVersion: "2025-06-18" },
  });
  t.receive({ jsonrpc: "2.0", method: MCP_APPS_UI_METHODS.initialized });
  await tick();

  t.receive({
    jsonrpc: "2.0",
    id: 2,
    method: MCP_APPS_UI_METHODS.requestDisplayMode,
    params: { mode: "fullscreen" },
  });
  await tick();
  t.receive({
    jsonrpc: "2.0",
    id: 3,
    method: MCP_APPS_UI_METHODS.requestDisplayMode,
    params: { mode: "pip" },
  });
  await tick();

  assert.deepEqual(frame(t.sent, (entry) => entry.id === 2)?.result, { mode: "fullscreen" });
  assert.deepEqual(frame(t.sent, (entry) => entry.id === 3)?.result, { mode: "fullscreen" });
  const changed = t.sent.filter((entry) => entry.method === MCP_APPS_UI_METHODS.hostContextChanged);
  assert.equal(changed.length, 1);
  assert.equal(bridge.getHostContext().displayMode, "fullscreen");
});

test("teardown waits for the page window then releases the transport", async () => {
  const t = createTransport();
  const timers = createManualTimers();
  const lifecycle: string[] = [];
  const bridge = createPluginUiJsonRpcBridge({
    transport: t.transport,
    hostInfo: { name: "ycode", version: "1" },
    hostCapabilities: {},
    hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
    handlers: createHandlers(),
    setTimer: timers.setTimer,
    handshakeTimeoutMs: 50,
    teardownTimeoutMs: 5,
    onClosed: (reason) => lifecycle.push(reason),
  });
  t.receive({
    jsonrpc: "2.0",
    id: 1,
    method: MCP_APPS_UI_METHODS.initialize,
    params: { protocolVersion: "2025-06-18" },
  });
  t.receive({ jsonrpc: "2.0", method: MCP_APPS_UI_METHODS.initialized });
  await tick();

  const teardown = bridge.teardown();
  await tick();
  assert.ok(frame(t.sent, (entry) => entry.method === MCP_APPS_UI_METHODS.resourceTeardown));
  timers.fire(5);
  await teardown;
  assert.equal(t.isClosed(), true);
  assert.equal(bridge.phase, "disposed");
  assert.deepEqual(lifecycle, ["teardown"]);
});

test("handshake timeout fails the bridge before any page request", () => {
  const t = createTransport();
  const timers = createManualTimers();
  const failures: string[] = [];
  const bridge = createPluginUiJsonRpcBridge({
    transport: t.transport,
    hostInfo: { name: "ycode", version: "1" },
    hostCapabilities: {},
    hostContext: { displayMode: "inline" },
    handlers: createHandlers(),
    setTimer: timers.setTimer,
    handshakeTimeoutMs: 25,
    onFailed: (reason) => failures.push(reason),
  });
  assert.equal(bridge.phase, "handshaking");

  timers.fire(25);
  assert.equal(bridge.phase, "disposed");
  assert.equal(t.isClosed(), true);
  assert.deepEqual(failures, ["ui/initialize handshake timed out"]);
});
