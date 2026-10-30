import {
  COMPACT_PROMPT_TOO_LONG_USER_MESSAGE,
  CoreErrorType,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  createCoreError,
  formatCompactSummary,
} from "../deps.js";
import type { Model } from "../deps.js";
import { resolveNormalRequestMaxOutputTokens } from "./model-token-limits.js";
import type {
  CompactTimelinePayload,
  SessionEvent,
  SessionEventType,
  TraceContext,
} from "../deps.js";
import {
  buildProviderRequestMessages,
  createModelContextExceededFinishError,
  isContextExceededFinishReason,
  readRawFinishReason,
} from "../helpers/index.js";
import type { RuntimeModelTextResult, RunModelTextRequestOptions } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";

const COMPACT_TOOL_USE_DENIAL_MESSAGE = "Tool use is not allowed during compaction";
const COMPACT_TOOL_USE_DENIAL_REASON = "compaction agent should only produce text summary";

export function createCompactPromptTooLongError(options: {
  attempt: number;
  cause?: unknown;
  preCompactTokenCount: number;
}): Error {
  return createCoreError(CoreErrorType.ModelContextExceeded, COMPACT_PROMPT_TOO_LONG_USER_MESSAGE, {
    cause: options.cause instanceof Error ? options.cause : undefined,
    context: {
      compactPromptTooLongAttempts: options.attempt,
      preCompactTokenCount: options.preCompactTokenCount,
    },
    recoverable: true,
    // compact 内部已经完成最多 3 次旧轮次截断重试；
    // 最终仍超窗时不能再被 auto compact 外层重试放大成 3x3。
    retryable: false,
  });
}

export function createCompactContextExceededFinishError(
  result: RuntimeModelTextResult,
): Error | undefined {
  const rawFinishReason = readRawFinishReason(result.providerMetadata);
  if (
    !isContextExceededFinishReason(result.finishReason, rawFinishReason) &&
    !isCompactEmptyLengthFinish(result)
  ) {
    return undefined;
  }

  return createModelContextExceededFinishError({
    finishReason: result.finishReason,
    rawFinishReason,
  });
}

function isCompactEmptyLengthFinish(result: RuntimeModelTextResult): boolean {
  // GLM/Z.AI compact 可能以 length + 空文本完成，真实含义是没有可保存的 summary；
  // 仅在 compact 路径把它归类为超窗压力，复用已有 prompt-too-long 降输入重试。
  return result.finishReason.trim().toLowerCase() === "length" && result.text.trim().length === 0;
}

export async function persistCompactTimelineEvent(
  runtime: AgentRuntimeInternal,
  type: SessionEventType,
  payload: CompactTimelinePayload,
  traceContext: TraceContext,
  events: SessionEvent[],
): Promise<void> {
  await runtime.persistCompactTimeline(payload, traceContext);
  const event = runtime.createEvent(type, payload, traceContext);
  await runtime.appendEvent(event, traceContext);
  events.push(event);
}

export function buildCompactSummaryRequestMessages(
  entriesForSummary: readonly RuntimeMessageEntry[],
  compactPrompt: string,
  options: {
    useMidConversationSystem?: boolean;
    // 与正常 Turn 共用 ToolSearch 成功提示投影；recordable 重渲染必须复用同一批
    // 成功 tool call，避免提示遗漏或重复。
    loadedToolCallIds?: ReadonlySet<string>;
  } = {},
): RunModelTextRequestOptions["messages"] {
  return buildProviderRequestMessages({
    entries: [...entriesForSummary, { message: { role: "user" as const, content: compactPrompt } }],
    applyCacheControl: true,
    skipCacheWrite: true,
    useMidConversationSystem: options.useMidConversationSystem,
    loadedToolCallIds: options.loadedToolCallIds,
  }).messages;
}

export function formatCompactSummaryOrThrow(
  runtime: AgentRuntimeInternal,
  result: RuntimeModelTextResult,
): string {
  const compactToolCalls = runtime.extractToolCallsFromResult(result);
  if (compactToolCalls.length > 0) {
    throw createCoreError(CoreErrorType.ModelError, COMPACT_TOOL_USE_DENIAL_MESSAGE, {
      context: {
        behavior: "deny",
        decisionReason: {
          reason: COMPACT_TOOL_USE_DENIAL_REASON,
          type: "other",
        },
        toolNames: compactToolCalls.map((toolCall) => toolCall.name),
      },
      recoverable: true,
      retryable: false,
    });
  }

  const summary = formatCompactSummary(result.text);
  if (!summary) {
    throw createCoreError(CoreErrorType.ModelError, "Failed to generate compact summary", {
      recoverable: true,
      retryable: true,
    });
  }
  return summary;
}

/** 压缩结果必须严格小于提交时上下文；失败时不触碰历史，由调用方直接抛出。 */
export function assertCompactionShrink(input: {
  preservedGroups: number;
  preCompactTokenCount: number;
  postCompactTokenCount: number;
}): void {
  if (input.postCompactTokenCount < input.preCompactTokenCount) return;
  throw createCoreError(
    CoreErrorType.InvalidStateTransition,
    `Compaction did not reduce context (${input.preCompactTokenCount} -> ${input.postCompactTokenCount})`,
    {
      context: {
        preservedGroups: input.preservedGroups,
        preCompactTokenCount: input.preCompactTokenCount,
        postCompactTokenCount: input.postCompactTokenCount,
      },
      recoverable: true,
    },
  );
}

export function capCompactSummaryMaxOutputTokens(model: Model): number {
  // Compact 是独立执行链，在这里显式选择模型上限与 summary 20K 上限中的较小值。
  const desired = Math.min(
    resolveNormalRequestMaxOutputTokens({
      modelMaxOutputTokens: model.optionSpecs.maxOutputTokens.max,
    }),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  );
  return Math.min(desired, model.optionSpecs.maxOutputTokens.max);
}
