import { ModelErrorCode } from "@ycode/contracts";
import type { Model, ModelRequest, ModelTextResult } from "@ycode/contracts";
import { collectModelStreamResult } from "./collect-model-stream.js";

/**
 * 内部辅助请求（会话标题、goal 标题、goal 完成校验）的统一入口。
 *
 * 部分 openai-compatible 提供方会返回 HTTP 200 和非流式不可解析正文，但 SSE
 * 链路正常。这里只在“完整响应解析失败”时换一次传输，避免把提供方兼容问题
 * 误判成业务失败；鉴权、限流、5xx 和网络错误仍原样抛出。
 *
 * 调用方必须用 `runWithModelInvocationContext` 包住整个调用，使两条传输共享
 * 同一 trace、statusSink 和请求头刷新逻辑。
 */
export async function generateAuxiliaryModelText(input: {
  model: Model;
  onStreamingFallback?: (error: unknown) => void;
  request: ModelRequest;
}): Promise<ModelTextResult> {
  try {
    return await input.model.generateText(input.request);
  } catch (error) {
    if (!isNonStreamingProviderResponseFailure(error)) throw error;
    input.onStreamingFallback?.(error);
    return collectModelStreamResult(input.model.streamText(input.request));
  }
}

function isNonStreamingProviderResponseFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; context?: unknown };
  if (record.code !== ModelErrorCode.ModelRequestFailed) return false;
  if (typeof record.context !== "object" || record.context === null) return false;
  // 只有收到完整响应却解析失败的 2xx 才值得换传输；鉴权、限流、5xx 和网络错误
  // 在流式链路上同样失败，重试只会放大延迟。
  return (record.context as { statusCode?: unknown }).statusCode === 200;
}
