import type {
  ModelStreamEvent,
  ModelTextResult,
  ModelToolCall,
  ModelUsage,
} from "@ycode/contracts";
import { normalizeStreamError } from "../runtime/helpers/model-errors.js";

/**
 * 消费一次完整的模型流并归约为非流式结果形状。
 *
 * 只适用于“内部辅助请求”：调用方自己负责把 streamText 包进模型调用上下文，
 * 本函数不设置 trace、status 或重试策略。
 */
export async function collectModelStreamResult(
  events: AsyncIterable<ModelStreamEvent>,
): Promise<ModelTextResult> {
  let text = "";
  let finishReason = "unknown";
  let providerMetadata: Record<string, unknown> | undefined;
  let usage: ModelUsage = {};
  const toolCalls: ModelToolCall[] = [];

  for await (const event of events) {
    switch (event.type) {
      case "text_delta":
        text += event.text;
        break;
      case "tool_call":
        toolCalls.push(event.toolCall);
        break;
      case "finish":
        finishReason = event.finishReason;
        usage = event.usage;
        providerMetadata = event.providerMetadata;
        break;
      case "error":
        throw normalizeStreamError(event.error);
    }
  }

  return {
    finishReason,
    ...(providerMetadata ? { providerMetadata } : {}),
    text,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    usage,
  };
}
