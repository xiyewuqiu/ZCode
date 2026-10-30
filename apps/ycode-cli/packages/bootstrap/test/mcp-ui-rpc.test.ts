import assert from "node:assert/strict";
import test from "node:test";
import type { McpAppProvidedToolDefinition, McpAppProvidedToolExecutor } from "@ycode/core";
import type { McpToolDescriptor } from "@ycode/contracts";
import {
  MCP_UI_APP_TOOL_CALL_NOTIFICATION,
  type McpAppInstance,
  type McpUiHostResponse,
} from "@ycode/shared/mcp-apps";
import type { McpUiAgentAccess } from "../src/ycode-protocol/mcp-ui/agentAccess.js";
import { handleMcpUiRpc } from "../src/ycode-protocol/mcp-ui/rpc.js";
import type {
  YCodeProtocolAgentServerContext,
  YCodeProtocolSessionRecord,
} from "../src/ycode-protocol/server-types.js";

const WORKSPACE = { workspacePath: "/workspace", workspaceKey: "/workspace" };
const WORKSPACE_IDENTITY = { ...WORKSPACE, workspaceIdentity: "workspace-identity" };

function descriptor(): McpToolDescriptor {
  return {
    serverName: "srv",
    toolName: "show",
    name: "show",
    inputSchema: { type: "object", properties: {} },
    visibility: ["model", "app"],
    ui: { resourceUri: "ui://app", visibility: ["model", "app"] },
  } as McpToolDescriptor;
}

function createAccess() {
  const calls: Array<{ kind: "callTool" | "callToolForUi"; toolName: string }> = [];
  let snapshot: { identity: string; generation: number } | null = {
    identity: "connection-identity",
    generation: 1,
  };
  const listeners = new Map<string, Set<() => void>>();
  const access: McpUiAgentAccess = {
    async hasMcpServer(name) {
      return name === "srv";
    },
    async listToolDescriptors() {
      return [descriptor()];
    },
    async callTool(_serverName, toolName) {
      calls.push({ kind: "callTool", toolName });
      return { content: [{ type: "text", text: "raw" }] };
    },
    async callToolForUi(_serverName, toolName) {
      calls.push({ kind: "callToolForUi", toolName });
      return { content: [{ type: "text", text: "ui" }] };
    },
    async readResource(_serverName, uri) {
      return {
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: "<html>app</html>",
            _meta: {
              ui: {
                permissions: { camera: {} },
                csp: { connectDomains: ["https://api.example.com"] },
              },
            },
          },
        ],
      };
    },
    getMcpAppConnectionSnapshot: () => snapshot,
    onMcpAppConnectionInvalidated(serverName, listener) {
      let set = listeners.get(serverName);
      if (!set) {
        set = new Set();
        listeners.set(serverName, set);
      }
      set.add(listener);
      return () => set?.delete(listener);
    },
  };
  return {
    access,
    calls,
    setSnapshot(next: { identity: string; generation: number } | null) {
      snapshot = next;
    },
    invalidate(serverName = "srv") {
      for (const listener of listeners.get(serverName) ?? []) listener();
    },
  };
}

function createContext(access: McpUiAgentAccess, workspace = WORKSPACE) {
  const applied: Array<{
    definitions: McpAppProvidedToolDefinition[];
    execute: McpAppProvidedToolExecutor;
  }> = [];
  const notifications: Array<{ method?: string; params?: unknown }> = [];
  const app = {
    mcpUiAgentAccess: () => access,
    replaceMcpAppProvidedTools(
      definitions: readonly McpAppProvidedToolDefinition[],
      execute: McpAppProvidedToolExecutor,
    ) {
      applied.push({ definitions: [...definitions], execute });
      return definitions.map((definition) => definition.modelName);
    },
  };
  const record = {
    app,
    workspace,
    memoryEnabled: true,
    nativeSearchEnhancementsEnabled: false,
    toolSearchMode: "auto",
    modelContextBudgetStrategy: "balanced",
    createdAt: 1,
    eventStore: {},
    persistence: {},
    protocolEventSequences: new Map(),
    protocolToolInputTransmissions: new Map(),
    stateRevision: 0,
    traceContext: {},
    updatedAt: 1,
  } as unknown as YCodeProtocolSessionRecord;
  const context = {
    sessions: new Map([["session-1", record]]),
    notify: (notification: { method?: string; params?: unknown }) =>
      notifications.push(notification),
  } as unknown as YCodeProtocolAgentServerContext;
  return { context, record, applied, notifications };
}

function prepareBody(overrides: Record<string, unknown> = {}) {
  return {
    op: "prepare",
    workspace: WORKSPACE,
    sessionId: "session-1",
    pluginId: "plugin-1",
    serverName: "srv",
    scopeId: "tool:call-1",
    resourceUri: "ui://app",
    toolName: "show",
    ownerWebContentsId: 11,
    ...overrides,
  };
}

function instanceScope(instance: McpAppInstance, overrides: Record<string, unknown> = {}) {
  return {
    workspace: WORKSPACE,
    sessionId: "session-1",
    pluginId: "plugin-1",
    serverName: "srv",
    scopeId: "tool:call-1",
    instance,
    ...overrides,
  };
}

async function prepared(context: YCodeProtocolAgentServerContext) {
  const response = await handleMcpUiRpc(context, prepareBody());
  assert.equal(response.op, "prepare");
  if (response.op !== "prepare") throw new Error("expected prepare");
  return response;
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("prepare is idempotent per scope/connection and returns the validated registration payload", async () => {
  const { access } = createAccess();
  const { context } = createContext(access);

  const first = await prepared(context);
  const second = await prepared(context);

  assert.equal(first.instance.token, second.instance.token);
  assert.equal(first.instance.generation, second.instance.generation);
  assert.equal(first.register.html, "<html>app</html>");
  assert.equal(first.register.ownerWebContentsId, 11);
  assert.equal(first.register.sessionId, "session-1");
  assert.equal(first.register.scopeId, "tool:call-1");
  assert.deepEqual(first.register.permissions, ["camera"]);
  assert.deepEqual(first.register.csp, { connectDomains: ["https://api.example.com"] });
});

test("workspace and remote identity must match the session record", async () => {
  const { access } = createAccess();
  const { context } = createContext(access, WORKSPACE_IDENTITY);

  await assert.rejects(handleMcpUiRpc(context, prepareBody()), (error: unknown) => {
    assert.equal((error as { code?: number }).code, -32602);
    return true;
  });
  await assert.rejects(
    handleMcpUiRpc(
      context,
      prepareBody({ workspace: { ...WORKSPACE, workspaceIdentity: "other-identity" } }),
    ),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, -32602);
      return true;
    },
  );
  // identity 匹配时路径可以不同：身份 key 优先。
  const matched = await handleMcpUiRpc(
    context,
    prepareBody({ workspace: { ...WORKSPACE_IDENTITY, workspacePath: "/mapped" } }),
  );
  assert.equal(matched.op, "prepare");
});

test("close revokes the instance and later validate/callTool fail closed", async () => {
  const { access } = createAccess();
  const { context } = createContext(access);
  const first = await prepared(context);

  const closed = await handleMcpUiRpc(context, { op: "close", ...instanceScope(first.instance) });
  assert.deepEqual(closed, { op: "close", ok: true });

  await assert.rejects(
    handleMcpUiRpc(context, { op: "validate", ...instanceScope(first.instance) }),
    /no longer authorized/,
  );
  await assert.rejects(
    handleMcpUiRpc(context, {
      op: "callTool",
      ...instanceScope(first.instance),
      toolName: "show",
      callId: "call-1",
    }),
    /no longer authorized/,
  );
});

test("connection generation changes revoke credentials and remove exposed app tools", async () => {
  const fakeAccess = createAccess();
  const { context, applied } = createContext(fakeAccess.access);
  const first = await prepared(context);

  await handleMcpUiRpc(context, {
    op: "registerAppTools",
    ...instanceScope(first.instance),
    tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
  });
  assert.deepEqual(
    applied.at(-1)?.definitions.map((definition) => definition.modelName),
    ["app__srv__ping"],
  );

  fakeAccess.setSnapshot({ identity: "connection-identity", generation: 2 });
  await assert.rejects(
    handleMcpUiRpc(context, { op: "validate", ...instanceScope(first.instance) }),
    /no longer authorized/,
  );

  // 主动撤销（重连 / 断开）同样清掉信箱与模型侧工具。
  const second = await prepared(context);
  await handleMcpUiRpc(context, {
    op: "registerAppTools",
    ...instanceScope(second.instance),
    tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
  });
  fakeAccess.invalidate("srv");
  await tick();
  assert.deepEqual(applied.at(-1)?.definitions, []);
  await assert.rejects(
    handleMcpUiRpc(context, { op: "validate", ...instanceScope(second.instance) }),
    /no longer authorized/,
  );
});

test("registered app tools reach the model surface, then claim/resolve round-trip through the mailbox", async () => {
  const { access } = createAccess();
  const { context, applied, notifications } = createContext(access);
  const first = await prepared(context);

  await handleMcpUiRpc(context, {
    op: "registerAppTools",
    ...instanceScope(first.instance),
    tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
  });
  const last = applied.at(-1);
  assert.ok(last);
  assert.equal(last.definitions.length, 1);
  const definition = last.definitions[0];
  assert.equal(definition.modelName, "app__srv__ping");
  assert.equal(definition.toolName, "ping");
  // 模型调用在审批前 pin 住实例；实例撤销后 pin 会拒绝。
  assert.equal(typeof definition.retainExecution, "function");
  const pin = definition.retainExecution?.("approval-call");
  assert.ok(pin);
  pin.release();

  const invocation = last.execute(
    {
      definition,
      arguments: { query: "hello" },
      toolCallId: "model-call-1",
    },
    { signal: new AbortController().signal },
  );
  await tick();

  const notification = notifications.find(
    (entry) => entry.method === MCP_UI_APP_TOOL_CALL_NOTIFICATION,
  );
  assert.ok(notification);
  const params = notification.params as {
    sessionId: string;
    call: { callId: string; toolName: string; arguments: Record<string, unknown> };
  };
  assert.equal(params.sessionId, "session-1");
  assert.equal(params.call.toolName, "ping");
  assert.deepEqual(params.call.arguments, { query: "hello" });

  const claimed = await handleMcpUiRpc(context, {
    op: "claimAppToolCall",
    ...instanceScope(first.instance),
    callId: params.call.callId,
  });
  assert.deepEqual(claimed, { op: "claimAppToolCall", accepted: true });

  const resolved = await handleMcpUiRpc(context, {
    op: "resolveAppToolCall",
    ...instanceScope(first.instance),
    callId: params.call.callId,
    result: { content: [{ type: "text", text: "pong" }] },
  });
  assert.deepEqual(resolved, { op: "resolveAppToolCall", accepted: true });
  assert.deepEqual(await invocation, { content: [{ type: "text", text: "pong" }] });

  const unregistered = await handleMcpUiRpc(context, {
    op: "unregisterAppTools",
    ...instanceScope(first.instance),
  });
  assert.deepEqual(unregistered, { op: "unregisterAppTools", ok: true });
  assert.deepEqual(applied.at(-1)?.definitions, []);

  await handleMcpUiRpc(context, { op: "close", ...instanceScope(first.instance) });
  assert.throws(() => definition.retainExecution?.("late-approval"), /no longer authorized/);
});

test("page tool calls use the authorized executor, not the raw MCP port", async () => {
  const { access, calls } = createAccess();
  const { context } = createContext(access);
  const first = await prepared(context);

  const response = await handleMcpUiRpc(context, {
    op: "callTool",
    ...instanceScope(first.instance),
    toolName: "show",
    arguments: { query: "q" },
    callId: "call-1",
  });
  assert.equal(response.op, "callTool");
  if (response.op !== "callTool") throw new Error("expected callTool");
  assert.deepEqual(response.result, { content: [{ type: "text", text: "ui" }] });
  assert.deepEqual(calls, [{ kind: "callToolForUi", toolName: "show" }]);
});

test("page resource reads bound content and reject unknown servers", async () => {
  const { access } = createAccess();
  const { context } = createContext(access);
  const first = await prepared(context);

  const response: McpUiHostResponse = await handleMcpUiRpc(context, {
    op: "readResource",
    ...instanceScope(first.instance),
    uri: "ui://app/data.json",
  });
  assert.equal(response.op, "readResource");
  if (response.op !== "readResource") throw new Error("expected readResource");
  assert.deepEqual(response.result.contents, [
    { uri: "ui://app/data.json", mimeType: "text/html;profile=mcp-app", text: "<html>app</html>" },
  ]);

  // 实例凭证绑定 server；换 server 的请求在 validate 阶段就失败。
  await assert.rejects(
    handleMcpUiRpc(context, {
      op: "readResource",
      ...instanceScope(first.instance),
      serverName: "other-server",
      uri: "ui://app/data.json",
    }),
    /no longer authorized/,
  );
});
