import assert from "node:assert/strict";
import test from "node:test";
import type { IPlatformService } from "@ycode/shared";
import type {
  McpAppInstance,
  McpUiAppToolCallNotification,
  McpUiHostRequestBody,
  McpUiHostResponse,
  PluginSandboxHandle,
  PluginSandboxRegisterRequestPayload,
} from "@ycode/shared/mcp-apps";
import type { YCodeAgentMcpUiParams } from "@ycode/services";
import {
  createAgentPluginUiHostPort,
  type PluginUiAgentServicePort,
} from "../src/plugin-ui/adapters/agentHostPort.js";

const INSTANCE: McpAppInstance = {
  runtimeId: "runtime-1",
  generation: 1,
  token: "instance-token",
  appIdentity: "a".repeat(64),
};

const HANDLE: PluginSandboxHandle = {
  instance: INSTANCE,
  sandboxId: "sb-test",
  initId: 1,
  shellUrl: `ycode-sandbox://shell-${INSTANCE.appIdentity}/instance/sb-test/`,
  partition: "persist:plugin-sandbox-v1-test",
};

const TARGET = {
  workspacePath: "/workspace",
  workspaceIdentity: "workspace-identity",
  remoteSessionId: "remote-session",
  sessionId: "session-1",
};

const SCOPE = {
  workspacePath: "/workspace",
  workspaceIdentity: "workspace-identity",
  sessionId: "session-1",
  pluginId: "plugin-1",
  serverName: "srv",
  scopeId: "tool:call-1",
  instance: INSTANCE,
};

function respond(request: McpUiHostRequestBody): McpUiHostResponse {
  switch (request.op) {
    case "prepare":
      return {
        op: "prepare",
        instance: INSTANCE,
        register: {
          instance: INSTANCE,
          ownerWebContentsId: request.ownerWebContentsId,
          sessionId: request.sessionId,
          pluginId: request.pluginId,
          serverName: request.serverName,
          scopeId: request.scopeId,
          html: "<html>app</html>",
          ...(request.csp ? { csp: request.csp } : {}),
          permissions: ["camera"],
        },
      };
    case "validate":
      return { op: "validate", ok: true };
    case "close":
      return { op: "close", ok: true };
    case "callTool":
      return {
        op: "callTool",
        result: { content: [{ type: "text", text: request.toolName }] },
      };
    case "cancelToolCall":
      return { op: "cancelToolCall", cancelled: true };
    case "readResource":
      return {
        op: "readResource",
        result: { contents: [{ uri: request.uri, text: "resource" }] },
      };
    case "registerAppTools":
      return { op: "registerAppTools", ok: true };
    case "unregisterAppTools":
      return { op: "unregisterAppTools", ok: true };
    case "claimAppToolCall":
      return { op: "claimAppToolCall", accepted: true };
    case "resolveAppToolCall":
      return { op: "resolveAppToolCall", accepted: true };
  }
}

function createService() {
  const requests: Array<{ target: YCodeAgentMcpUiParams; request: McpUiHostRequestBody }> = [];
  const listeners = new Set<(event: McpUiAppToolCallNotification) => void>();
  const service: PluginUiAgentServicePort = {
    async mcpUi(params) {
      requests.push({ target: params, request: params.request });
      return respond(params.request);
    },
    onDynamicMcpUiAppToolCall() {
      return (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      };
    },
  };
  return {
    service,
    requests,
    emit(event: McpUiAppToolCallNotification) {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

function createPlatform(options: { failRegister?: boolean } = {}) {
  const registered: PluginSandboxRegisterRequestPayload[] = [];
  const disposed: Array<{ sandboxId: string; initId?: number }> = [];
  const pluginSandbox = {
    getOwnerWebContentsId: async () => 7,
    async disposeSandbox(sandboxId: string, initId?: number) {
      disposed.push({ sandboxId, ...(initId !== undefined ? { initId } : {}) });
    },
    consumeUserGesture: async () => true,
    onPorts: () => () => {},
    async registerSandbox(payload: PluginSandboxRegisterRequestPayload) {
      registered.push(payload);
      if (options.failRegister) throw new Error("main rejected registration");
      return HANDLE;
    },
  };
  const platform = { pluginSandbox } as unknown as IPlatformService;
  return { platform, registered, disposed };
}

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("agent host port fails closed without a sandbox platform port", () => {
  const { service } = createService();
  assert.equal(createAgentPluginUiHostPort({ service, platform: null, target: TARGET }), null);
  assert.equal(
    createAgentPluginUiHostPort({
      service,
      platform: {} as IPlatformService,
      target: TARGET,
    }),
    null,
  );
});

test("prepare forwards the renderer scope, registers the returned payload and uses the main handle", async () => {
  const { service, requests } = createService();
  const { platform, registered } = createPlatform();
  const port = createAgentPluginUiHostPort({ service, platform, target: TARGET });
  assert.ok(port);

  const prepared = await port.prepareSandbox({
    ...SCOPE,
    resourceUri: "ui://app",
    toolName: "show",
    ownerWebContentsId: 7,
    csp: { connectDomains: ["https://api.example.com"] },
    preferredDisplayMode: "pip",
    prefersBorder: true,
  });

  assert.equal(prepared, HANDLE);
  const prepare = requests[0];
  assert.ok(prepare);
  assert.equal(prepare.request.op, "prepare");
  assert.equal(prepare.target.workspacePath, TARGET.workspacePath);
  assert.equal(prepare.target.workspaceIdentity, TARGET.workspaceIdentity);
  assert.equal(prepare.target.remoteSessionId, TARGET.remoteSessionId);
  assert.equal(prepare.target.sessionId, TARGET.sessionId);
  if (prepare.request.op !== "prepare") throw new Error("expected prepare");
  assert.equal(prepare.request.resourceUri, "ui://app");
  assert.equal(prepare.request.toolName, "show");
  assert.equal(prepare.request.ownerWebContentsId, 7);
  assert.equal(prepare.request.preferredDisplayMode, "pip");
  assert.equal(prepare.request.prefersBorder, true);

  assert.equal(registered.length, 1);
  const registration = registered[0];
  assert.ok(registration);
  assert.equal(registration.instance, INSTANCE);
  assert.equal(registration.html, "<html>app</html>");
  assert.deepEqual(registration.csp, { connectDomains: ["https://api.example.com"] });
  assert.equal(typeof registration.requestId, "string");
  assert.ok(registration.requestId.length > 0);
});

test("register failure revokes the just-issued instance credential", async () => {
  const { service, requests } = createService();
  const { platform } = createPlatform({ failRegister: true });
  const port = createAgentPluginUiHostPort({ service, platform, target: TARGET });
  assert.ok(port);

  await assert.rejects(
    port.prepareSandbox({
      ...SCOPE,
      resourceUri: "ui://app",
      toolName: "show",
      ownerWebContentsId: 7,
    }),
    /main rejected registration/,
  );
  await flush();

  const close = requests.find((entry) => entry.request.op === "close");
  assert.ok(close);
  if (close.request.op !== "close") throw new Error("expected close");
  assert.equal(close.request.instance, INSTANCE);
  assert.equal(close.request.scopeId, SCOPE.scopeId);
  assert.equal(close.request.sessionId, SCOPE.sessionId);
});

test("tool calls, cancellation and resource reads stay on the mcp/ui RPC surface", async () => {
  const { service, requests } = createService();
  const { platform } = createPlatform();
  const port = createAgentPluginUiHostPort({ service, platform, target: TARGET });
  assert.ok(port);

  const result = await port.callTool({
    ...SCOPE,
    toolName: "show",
    arguments: { query: "q" },
    callId: "call-1",
  });
  assert.deepEqual(result, { content: [{ type: "text", text: "show" }] });
  const callTool = requests[0]?.request;
  assert.ok(callTool);
  if (callTool.op !== "callTool") throw new Error("expected callTool");
  assert.equal(callTool.instance, INSTANCE);
  assert.equal(callTool.toolName, "show");
  assert.deepEqual(callTool.arguments, { query: "q" });
  assert.equal(callTool.callId, "call-1");

  const cancelled = await port.cancelToolCall({ ...SCOPE, callId: "call-1" });
  assert.equal(cancelled.cancelled, true);
  assert.equal(requests[1]?.request.op, "cancelToolCall");

  const resource = await port.readResource({ ...SCOPE, uri: "ui://app/data.json" });
  assert.deepEqual(resource, { contents: [{ uri: "ui://app/data.json", text: "resource" }] });
  assert.equal(requests[2]?.request.op, "readResource");

  await port.validateInstance(SCOPE);
  assert.equal(requests[3]?.request.op, "validate");
  await port.closeInstance(SCOPE);
  assert.equal(requests[4]?.request.op, "close");
});

test("app tool mailbox operations route through mcp/ui and subscriptions filter by session", async () => {
  const { service, requests, emit, listenerCount } = createService();
  const { platform } = createPlatform();
  const port = createAgentPluginUiHostPort({ service, platform, target: TARGET });
  assert.ok(port);

  await port.registerAppTools?.({
    ...SCOPE,
    tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
  });
  assert.equal(requests.at(-1)?.request.op, "registerAppTools");

  assert.deepEqual(await port.claimAppToolCall?.({ ...SCOPE, callId: "call-9" }), {
    accepted: true,
  });
  assert.deepEqual(
    await port.resolveAppToolCall?.({
      ...SCOPE,
      callId: "call-9",
      result: { content: [{ type: "text", text: "pong" }] },
    }),
    { accepted: true },
  );
  await port.unregisterAppTools?.(SCOPE);
  assert.equal(requests.at(-1)?.request.op, "unregisterAppTools");

  const received: Array<{ sessionId?: string }> = [];
  const unsubscribe = port.subscribeAppToolCalls?.((event) =>
    received.push(event as unknown as { sessionId?: string }),
  );
  assert.equal(listenerCount(), 1);
  const event = (sessionId: string): McpUiAppToolCallNotification => ({
    sessionId,
    scopeId: SCOPE.scopeId,
    instance: INSTANCE,
    call: { callId: "call-9", toolName: "ping", arguments: {} },
  });
  emit(event("session-1"));
  emit(event("session-2"));
  assert.deepEqual(
    received.map((entry) => entry.sessionId),
    ["session-1"],
  );
  unsubscribe?.();
  assert.equal(listenerCount(), 0);
});
