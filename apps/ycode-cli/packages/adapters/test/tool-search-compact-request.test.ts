import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_SEARCH_BETA, ModelTransportKind } from "@ycode/contracts";
import type { LanguageModel } from "ai";
import type { AiSdkModelTextRequest, ResolvedAiSdkModel } from "../src/model/runner-runtime.js";
import { createGenerateTextOptions, createStreamTextOptions } from "../src/model/runner-options.js";
import { createStatusContext } from "../src/model/runner-status.js";

/**
 * compact 摘要请求复用正常 Turn 的 ToolSearch 暴露结果：core 决定 mode 与 schema/引用投影，
 * adapter 只把 toolSearchEnabled 落成 beta header、defer_loading 与 tool-reference。
 * 这里固定 compact 请求形态，断言 native 与非 native 的 wire body 差异。
 */
const compactRequest = (toolSearchEnabled: boolean): AiSdkModelTextRequest => ({
  toolSearchEnabled,
  messages: [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "toolu_search", name: "ToolSearch", input: { query: "select:mcp" } }],
    },
    {
      role: "tool",
      toolCallId: "toolu_search",
      toolName: "ToolSearch",
      content: [
        { type: "text", text: "found" },
        { type: "tool_reference", toolName: "mcp__server__query" },
      ],
    },
    { role: "user", content: "Summarize the conversation so far." },
  ],
  tools: [
    residentTool("ToolSearch"),
    deferredTool("mcp__server__query"),
    deferredTool("mcp__server__unloaded"),
  ],
});

const resolvedModel: ResolvedAiSdkModel = {
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
  model: {} as LanguageModel,
  providerKind: "anthropic",
  headers: { "anthropic-beta": "existing-beta" },
  properties: {
    requiresMfjsToolSchema: false,
    contextWindow: 200_000,
    inputFormat: {
      supportsText: true,
      supportsImage: true,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: true,
    },
    outputFormat: { supportsText: true },
    supportsToolCall: true,
    supportsJsonSchemaOutput: true,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: true,
  },
};

function residentTool(name: string) {
  return { name, description: name, inputSchema: { type: "object" as const, properties: {} } };
}

function deferredTool(name: string) {
  return {
    ...residentTool(name),
    // core 的 native 投影给已发现/受控 deferred 工具标记 deferLoading。
    deferLoading: true,
  };
}

function streamOptions(toolSearchEnabled: boolean) {
  const request = compactRequest(toolSearchEnabled);
  const statusContext = createStatusContext({
    maxAttempts: 1,
    request,
    resolved: resolvedModel,
    transport: ModelTransportKind.Sse,
  });
  return createStreamTextOptions({
    includeModelIO: false,
    request,
    resolved: resolvedModel,
    statusContext,
  });
}

function generateOptions(toolSearchEnabled: boolean) {
  const request = compactRequest(toolSearchEnabled);
  const statusContext = createStatusContext({
    maxAttempts: 1,
    request,
    resolved: resolvedModel,
    transport: ModelTransportKind.Http,
  });
  return createGenerateTextOptions({
    includeModelIO: false,
    request,
    resolved: resolvedModel,
    statusContext,
  });
}

function toolProviderOptions(options: ReturnType<typeof streamOptions>, name: string) {
  const tools = options.tools as Record<string, { providerOptions?: Record<string, unknown> }>;
  return tools[name]?.providerOptions as { anthropic?: { deferLoading?: boolean } } | undefined;
}

function toolResultValue(options: ReturnType<typeof streamOptions>) {
  const messages = options.messages as Array<{
    role: string;
    content: Array<{ type: string; output?: { type: string; value?: unknown } }>;
  }>;
  const toolMessage = messages.find((message) => message.role === "tool");
  assert.ok(toolMessage, "compact request must carry the ToolSearch tool result");
  const output = toolMessage.content[0]?.output;
  assert.equal(output?.type, "content");
  return output?.value as Array<{ type: string; text?: string; providerOptions?: unknown }>;
}

test("native compact body sends beta header, defer_loading and tool-reference", () => {
  const options = streamOptions(true);

  assert.match(String(options.headers?.["anthropic-beta"]), new RegExp(`${TOOL_SEARCH_BETA}$`));
  assert.equal(String(options.headers?.["anthropic-beta"]).startsWith("existing-beta,"), true);
  assert.equal(toolProviderOptions(options, "mcp__server__query")?.anthropic?.deferLoading, true);
  assert.equal(
    toolProviderOptions(options, "ToolSearch")?.anthropic?.deferLoading,
    undefined,
    "resident control tool must not be deferred",
  );

  const value = toolResultValue(options);
  assert.deepEqual(value.find((part) => part.type === "custom")?.providerOptions, {
    anthropic: { type: "tool-reference", toolName: "mcp__server__query" },
  });
});

test("local/off compact body keeps refs as names and sends no native fields", () => {
  for (const options of [streamOptions(false), generateOptions(false)]) {
    assert.equal(options.headers?.["anthropic-beta"], "existing-beta");
    assert.equal(
      toolProviderOptions(options, "mcp__server__query")?.anthropic?.deferLoading,
      undefined,
    );
    const value = toolResultValue(options);
    assert.equal(
      value.some((part) => part.type === "custom"),
      false,
      "non-native projection must not emit tool-reference blocks",
    );
    assert.deepEqual(
      value.find((part) => part.type === "text" && part.text === "mcp__server__query"),
      { type: "text", text: "mcp__server__query" },
    );
  }
});

test("stream retry and non-stream fallback keep the same native body", () => {
  const streamed = streamOptions(true);
  const fallback = generateOptions(true);
  assert.equal(streamed.headers?.["anthropic-beta"], fallback.headers?.["anthropic-beta"]);
  assert.equal(
    toolProviderOptions(streamed, "mcp__server__query")?.anthropic?.deferLoading,
    toolProviderOptions(fallback, "mcp__server__query")?.anthropic?.deferLoading,
  );
  assert.deepEqual(toolResultValue(streamed), toolResultValue(fallback));
});
