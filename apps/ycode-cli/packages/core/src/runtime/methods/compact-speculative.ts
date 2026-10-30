import {
  CompactTrigger,
  buildCompactPrompt,
  createChildTraceContext,
  formatCompactSummary,
  getSpeculativeCompactThreshold,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  traceContextToLogContext,
} from "../deps.js";
import type { AutoCompactDecision, MessageId, Model, TraceContext } from "../deps.js";
import {
  estimateRuntimeEntryTokens,
  hasEnoughRuntimeEntriesToCompact,
  projectMessagesForModelMediaPolicy,
  resolveCompactRecentTailTokenBudget,
  selectCompactEntries,
  type CompactEntrySelection,
} from "../helpers/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import type { RuntimeModelTextResult } from "../types.js";
import {
  buildCompactSummaryRequestMessages,
  capCompactSummaryMaxOutputTokens,
} from "./compact-active-helpers.js";
import { runCompactSummaryModelRequest } from "./compact-summary-model-request.js";
import { createRefreshRuntimeHeadersBeforeModelAttempt } from "./model-runtime-headers.js";
import { resolveModelRequestSessionTypeFromTaskType } from "./model-request-session-type.js";
import type { CompactionHistorySnapshot } from "./compaction-controller.js";

export function takeReadySpeculativeCompaction(
  this: AgentRuntimeInternal,
  input: { model: Model; entries: readonly RuntimeMessageEntry[] },
): SpeculativeCompactCandidate | undefined {
  const candidate = this.compactionController.takeSettledSpeculative<SpeculativeCompactCandidate>({
    generation: this.compactionController.generation,
    modelKey: resolveCompactionModelKey(input.model),
    entries: input.entries,
  });
  if (candidate) return candidate.value;
  // 硬阈值已到：不等待后台请求；未完成或基准变化都取消，回退同步压缩。
  this.compactionController.cancelSpeculative("compaction_due");
  return undefined;
}

export interface SpeculativeCompactCandidate {
  snapshot: CompactionHistorySnapshot;
  summary: string;
  usage: RuntimeModelTextResult["usage"];
  selection: CompactEntrySelection;
  preCompactTokenCount: number;
  lastSummarizedMessageId: MessageId | undefined;
}

export function resolveCompactionModelKey(model: Model): string {
  return `${String(model.providerId)}/${String(model.modelId)}`;
}

/**
 * 在硬阈值前触发一次后台摘要。只生成 summary 文本，不写 timeline/boundary，
 * 也不替换历史；同一会话最多一个 in-flight 投机任务。
 */
export function maybeStartSpeculativeCompaction(
  this: AgentRuntimeInternal,
  input: {
    model: Model;
    decision: AutoCompactDecision;
    entries: readonly RuntimeMessageEntry[];
    turnTraceContext: TraceContext;
    maxOutputTokens?: number;
  },
): boolean {
  if (this.config.compact?.enabled === false) return false;
  const maxFailures =
    this.config.compact?.maxConsecutiveFailures ?? MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  if (this.autoCompactConsecutiveFailures >= maxFailures) return false;
  const threshold = getSpeculativeCompactThreshold({
    contextWindow: input.model.properties.contextWindow,
    ...this.config.compact,
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    modelContextBudgetStrategy: this.config.modelContextBudgetStrategy,
  });
  if (!Number.isFinite(threshold) || input.decision.tokenCount < threshold) return false;
  if (input.decision.tokenCount >= input.decision.threshold) return false;

  const snapshot: CompactionHistorySnapshot = {
    generation: this.compactionController.generation,
    modelKey: resolveCompactionModelKey(input.model),
    entries: [...input.entries],
  };
  const started = this.compactionController.startSpeculative(snapshot, (signal) =>
    generateSpeculativeSummary.call(this, {
      ...input,
      signal,
      snapshot,
    }),
  );
  if (started) {
    this.logger?.debug("Speculative compaction started", {
      ...traceContextToLogContext(input.turnTraceContext),
      event: "compact.speculative.started",
      generation: snapshot.generation,
      model: snapshot.modelKey,
      module: "core.runtime",
      thresholdTokens: threshold,
      tokenCount: input.decision.tokenCount,
    });
  }
  return started;
}

async function generateSpeculativeSummary(
  this: AgentRuntimeInternal,
  input: {
    model: Model;
    decision: AutoCompactDecision;
    entries: readonly RuntimeMessageEntry[];
    turnTraceContext: TraceContext;
    signal: AbortSignal;
    snapshot: CompactionHistorySnapshot;
  },
): Promise<SpeculativeCompactCandidate | undefined> {
  const modelTraceContext = createChildTraceContext(input.turnTraceContext, {
    attributes: {
      model: resolveCompactionModelKey(input.model),
      querySource: "compact.speculative",
    },
  });
  const useMidConversationSystem =
    this.config.midConversationSystem?.mode === "force" ||
    input.model.properties.supportsMidConversationSystem;
  const selection = selectCompactEntries({
    entries: input.snapshot.entries,
    preserveRecentTokenBudget: resolveCompactRecentTailTokenBudget(
      input.decision.effectiveContextWindow,
    ),
    trigger: CompactTrigger.Auto,
    useMidConversationSystem,
  });
  if (!hasEnoughRuntimeEntriesToCompact(selection.entriesForSummary)) {
    return undefined;
  }

  const compactPrompt = buildCompactPrompt(undefined);
  const requestMessages = buildCompactSummaryRequestMessages(
    selection.entriesForSummary,
    compactPrompt,
    { useMidConversationSystem },
  );
  const projectedMessages = projectMessagesForModelMediaPolicy(
    requestMessages,
    input.model.properties.inputFormat,
  ).messages;

  try {
    const result = await runCompactSummaryModelRequest({
      logger: this.logger,
      model: input.model,
      request: {
        abortSignal: input.signal,
        maxOutputTokens: capCompactSummaryMaxOutputTokens(input.model),
        messages: projectedMessages,
        metadata: traceContextToLogContext(modelTraceContext),
        modelRequestSessionType: resolveModelRequestSessionTypeFromTaskType(this.config.taskType),
        modelCall: {
          attributes: {
            compactionOuterAttempt: 1,
            compactionTrigger: CompactTrigger.Auto,
          },
          operation: "context_compaction",
          operationId: `cmp_spec_${crypto.randomUUID()}`,
        },
        preserveProviderStreamBoundaries: true,
        traceContext: modelTraceContext,
        tools: [],
        refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(this, {
          abortSignal: input.signal,
          model: input.model,
          traceContext: modelTraceContext,
        }),
      },
    });
    if (input.signal.aborted) return undefined;
    const summary = formatCompactSummary(result.text);
    if (!summary) return undefined;
    return {
      snapshot: input.snapshot,
      summary,
      usage: result.usage,
      selection,
      preCompactTokenCount: estimateRuntimeEntryTokens(input.snapshot.entries, {
        useMidConversationSystem,
      }),
      lastSummarizedMessageId: this.latestConversationMessageId,
    };
  } catch (error) {
    this.logger?.debug("Speculative compaction discarded", {
      ...traceContextToLogContext(modelTraceContext),
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "compact.speculative.discarded",
      generation: input.snapshot.generation,
      module: "core.runtime",
    });
    return undefined;
  }
}
