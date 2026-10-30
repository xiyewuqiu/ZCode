import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_SEARCH_NAME } from "@ycode/contracts";
import type { ModelToolContract } from "@ycode/contracts";
import type { RuntimeMessageEntry } from "../src/agent/message-history.js";
import { prepareRuntimeProviderRequest } from "../src/runtime/helpers/runtime-provider-request-messages.js";

/**
 * compact 摘要请求依赖 prepareRuntimeProviderRequest 做 ToolSearch 暴露决策。
 * 这里固定 compact 形态（同一份 prompt/tools，仅重试时 entries 变化），断言
 * native/local/off 三种模式的 schema、引用投影与 toolSearchEnabled 保持一致。
 */
const prompt = "Summarize the conversation so far.";

const tools: ModelToolContract[] = [
  contract(TOOL_SEARCH_NAME),
  contract("DeferredToolCall"),
  contract("Read"),
  contract("mcp__server__query"),
  contract("mcp__server__unloaded"),
];

function contract(name: string): ModelToolContract {
  return { name, description: name, inputSchema: { type: "object", properties: {} } };
}

function deferredRegistry() {
  return {
    get(name: string) {
      return name.startsWith("mcp__server__")
        ? ({ metadata: { mcpPresentation: { serverName: "server", toolName: name } } } as never)
        : undefined;
    },
  };
}

function model() {
  return {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    requestCapabilities: {
      toolSearch: { protocolSupported: true, defaultEnabled: true },
    },
    properties: { supportsToolCall: true, supportsMidConversationSystem: true },
  } as never;
}

function runtime(mode: "native" | "local" | "off") {
  return { config: { toolSearch: { mode }, midConversationSystem: undefined } } as never;
}

/** 已发现 mcp__server__query 的历史；compact 重试会从头截断旧轮次。 */
function entries(): RuntimeMessageEntry[] {
  return [
    {
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "toolu_search", name: TOOL_SEARCH_NAME, input: { query: "select" } }],
      },
      metadata: {},
    },
    {
      message: {
        role: "tool",
        toolCallId: "toolu_search",
        toolName: TOOL_SEARCH_NAME,
        content: [
          { type: "text", text: "found" },
          { type: "tool_reference", toolName: "mcp__server__query" },
        ],
      },
      metadata: {},
    },
    { message: { role: "user", content: "older turn" }, metadata: {} },
  ] as RuntimeMessageEntry[];
}

function prepare(mode: "native" | "local" | "off", requestEntries = entries()) {
  return prepareRuntimeProviderRequest(runtime(mode), {
    model: model(),
    tools,
    registry: deferredRegistry(),
    entries: requestEntries,
    prompt,
    applyCacheControl: true,
    skipCacheWrite: true,
  });
}

function messageBlocks(messages: ReturnType<typeof prepare>["request"]["messages"]) {
  return messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
}

test("native compact exposure keeps references and marks discovered deferred schemas", () => {
  const prepared = prepare("native");
  assert.equal(prepared.request.toolSearchEnabled, true);
  assert.equal(prepared.toolSearch.mode, "native");

  const deferred = prepared.request.tools.find((tool) => tool.name === "mcp__server__query");
  const unloaded = prepared.request.tools.find((tool) => tool.name === "mcp__server__unloaded");
  assert.equal(deferred?.deferLoading, true);
  assert.equal(unloaded, undefined, "undiscovered deferred tools stay out of provider tools");
  assert.equal(
    prepared.request.tools.find((tool) => tool.name === "DeferredToolCall"),
    undefined,
  );
  assert.equal(
    messageBlocks(prepared.request.messages).some((block) => block.type === "tool_reference"),
    true,
  );
});

test("local compact exposure expands references and exposes control tools", () => {
  const prepared = prepare("local");
  assert.equal(prepared.request.toolSearchEnabled, false);
  assert.equal(prepared.toolSearch.mode, "local");
  assert.equal(
    prepared.request.tools.find((tool) => tool.name === "DeferredToolCall")?.name,
    "DeferredToolCall",
  );
  assert.equal(
    prepared.request.tools.find((tool) => tool.name === "mcp__server__query"),
    undefined,
  );
  const blocks = messageBlocks(prepared.request.messages);
  assert.equal(
    blocks.some((block) => block.type === "tool_reference"),
    false,
  );
  assert.equal(
    blocks.some((block) => block.type === "text" && block.text.includes("mcp__server__query")),
    true,
  );
});

test("off compact exposure sends full non-control tools without native projection", () => {
  const prepared = prepare("off");
  assert.equal(prepared.request.toolSearchEnabled, false);
  assert.deepEqual(
    prepared.request.tools.map((tool) => tool.name),
    ["Read", "mcp__server__query", "mcp__server__unloaded"],
  );
  assert.equal(
    messageBlocks(prepared.request.messages).some((block) => block.type === "tool_reference"),
    false,
  );
});

test("prompt-too-long retries keep the same ToolSearch mode and exposure flags", () => {
  const nativeFirst = prepare("native");
  // 重试会截断更早的轮次，但 compactPrompt/tools/mode 不变。
  const nativeRetry = prepare("native", entries().slice(1));
  assert.equal(nativeFirst.request.toolSearchEnabled, nativeRetry.request.toolSearchEnabled);
  assert.equal(nativeFirst.toolSearch.mode, nativeRetry.toolSearch.mode);
  assert.deepEqual(
    nativeFirst.request.tools.map((tool) => [tool.name, tool.deferLoading]),
    nativeRetry.request.tools.map((tool) => [tool.name, tool.deferLoading]),
  );
});
