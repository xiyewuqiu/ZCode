/* eslint-disable max-lines -- compact 提交事务、摘要重试与保留边界共享 selection/持久化顺序；拆分前需稳定原子提交边界。 */
import { collectRuntimeAgentListing } from "../helpers/agent-listing.js";
import { collectDiscoveredTools } from "../../tool/search/history.js";
import {
  CompactPhase,
  CompactReason,
  CompactTrigger,
  CompactTimelineStatus,
  CoreErrorType,
  SessionEventType,
  createChildTraceContext,
  createCoreError,
  isCoreError,
  createMessageId,
  createPartId,
  traceContextToLogContext,
  buildCompactPrompt,
  buildCompactSummaryMessage,
  buildManualCompactBoundary,
  createCompactBoundaryId,
  getUsageTotalTokens,
} from "../deps.js";
import type { SessionEvent, TraceContext } from "../deps.js";
import { resolveModelRequestSessionTypeFromTaskType } from "./model-request-session-type.js";
import {
  defaultCompactPhaseForTrigger,
  defaultCompactReasonForTrigger,
  buildPostCompactReadStateReminderEntries,
  countCompactPreservedRuntimeMessages,
  buildPostCompactRuntimeEntries,
  compactFailureReasonFromError,
  estimateRuntimeEntryTokens,
  getRuntimeEntriesToSummarize,
  hasEnoughRuntimeEntriesToCompact,
  resolveCompactRecentTailTokenBudget,
  selectCompactEntries,
  selectCompactEntriesAfterPromptTooLong,
  selectCompactEntriesForInitialPromptTooLong,
  throwIfTurnAborted,
  isTurnCancellationError,
  isModelContextExceededError,
  isModelMediaTooLargeError,
  logMediaBudgetProjection,
  logMediaCapabilityProjection,
  truncateCompactSummaryRequestEntriesAfterPromptTooLong,
  projectCompactMediaForRetry,
  projectMessagesForModelMediaPolicy,
  logCompactMediaRetryProjection,
  prepareRuntimeProviderRequest,
  readApprovedPlanFileReferenceEntry,
} from "../helpers/index.js";
import type { CompactTimelineContext, RuntimeModelTextResult } from "../types.js";
import type { Model } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { CompactAttemptOutcome } from "./turn-loop-state.js";
import {
  legacySyntheticRuntimeMetadata,
  runtimeEntrySnapshotSuffix,
  type RuntimeMessageEntry,
} from "../../agent/message-history.js";
import { selectPersistedCompactTail } from "../helpers/compact-preservation.js";
import {
  assertCompactionShrink,
  buildCompactSummaryRequestMessages,
  capCompactSummaryMaxOutputTokens,
  createCompactContextExceededFinishError,
  createCompactPromptTooLongError,
  formatCompactSummaryOrThrow,
  persistCompactTimelineEvent,
} from "./compact-active-helpers.js";
import { runCompactSummaryModelRequest } from "./compact-summary-model-request.js";
import { rollbackCompactPersistenceMessages } from "./compact-persistence.js";
import type { SpeculativeCompactCandidate } from "./compact-speculative.js";
import { createRefreshRuntimeHeadersBeforeModelAttempt } from "./model-runtime-headers.js";
import { recordModelUsageFact } from "./usage-observability.js";
import { createRuntimeModel } from "./runtime-model.js";
import {
  filterOutputTokenContinuationEntries,
  preserveCanonicalContextPrefix,
} from "./turn-output-token-continuation.js";

const AUTO_COMPACT_MAX_ATTEMPTS = 3;
const COMPACT_TOOL_KEEP_MAX_COUNT = 100;
// 压缩 transcript 是摘要丢失细节时的唯一精确回查路径；超过上限时宁可不写，也不把
// 单次压缩变成几十 MB 的隐性磁盘放大。
const MAX_COMPACTION_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

interface CompactActiveOptions {
  abortSignal?: AbortSignal;
  compactContextTelemetry?: {
    inputTokens: number;
    policyContextWindowTokens: number;
    thresholdTokens?: number;
    tokenSource: "estimate" | "provider_usage";
  };
  autoCompactThreshold?: number;
  compactReason?: CompactReason;
  initialPromptTooLongCause?: unknown;
  phase?: CompactPhase;
  sourceCommandId?: string;
  trigger?: CompactTrigger;
  model?: Model;
  /** 压缩后重建 Agent 目录所用的工具面；缺席时按当前模型工具面兜底。 */
  agentListingTools?: readonly { name: string }[];
  activeEntries?: readonly RuntimeMessageEntry[];
  /** 当前权威 entries 读取器；用于提交前确认基准仍是前缀并保留新增 suffix。 */
  getCurrentEntries?: () => readonly RuntimeMessageEntry[];
  /** 已完成的投机摘要；命中时跳过模型请求，但仍走 shrink 与原子提交。 */
  speculativeResult?: SpeculativeCompactCandidate;
}

export async function compactActiveConversation(
  this: AgentRuntimeInternal,
  customInstructions: string | undefined,
  turnTraceContext: TraceContext,
  events: SessionEvent[],
  options: CompactActiveOptions = {},
): Promise<{
  displayText: string;
  entries: readonly RuntimeMessageEntry[];
  outcome: Extract<CompactAttemptOutcome, "compacted" | "skipped">;
  tokenCount: number;
}> {
  const trigger = options.trigger ?? CompactTrigger.Manual;
  const phase = options.phase ?? defaultCompactPhaseForTrigger(trigger);
  const compactTelemetry = this.agentTelemetry.compaction({
    trigger,
    phase,
    maxAttempts: AUTO_COMPACT_MAX_ATTEMPTS,
    modelMode: this.config.modelStreaming === "off" ? "non_streaming" : "streaming",
    policyContextWindowTokens: options.compactContextTelemetry?.policyContextWindowTokens,
    thresholdTokens: options.compactContextTelemetry?.thresholdTokens,
    tokenSource: options.compactContextTelemetry?.tokenSource,
    traceContext: turnTraceContext,
  });
  if (options.compactContextTelemetry) {
    // Auto 复用策略决策，Reactive 复用 overflow 路径 activeMessages；其他 trigger 不额外投影。
    compactTelemetry.setInputTokens(options.compactContextTelemetry.inputTokens);
  }
  // 同步压缩与投机摘要互斥：非采纳路径先取消后台任务，避免两个摘要请求并发。
  if (!options.speculativeResult) {
    this.compactionController.cancelSpeculative("foreground_compaction");
  }
  return compactTelemetry.run(async () => {
    try {
      // 同一会话同一时间只允许一个压缩提交；排队任务获得锁后才捕获基准。
      const result = await this.compactionController.runExclusive(() =>
        compactActiveConversationImpl.call(this, customInstructions, turnTraceContext, events, options),
      );
      compactTelemetry.setOutputTokens(result.tokenCount);
      compactTelemetry.finishCompleted();
      return result;
    } catch (error) {
      if (isTurnCancellationError(error, options.abortSignal)) {
        compactTelemetry.finishCancelled("abort_signal");
      } else {
        compactTelemetry.finishFailed("unhandled", "unknown", error);
      }
      throw error;
    }
  });
}

async function compactActiveConversationImpl(
  this: AgentRuntimeInternal,
  customInstructions: string | undefined,
  turnTraceContext: TraceContext,
  events: SessionEvent[],
  options: CompactActiveOptions = {},
): Promise<{
  displayText: string;
  entries: readonly RuntimeMessageEntry[];
  outcome: Extract<CompactAttemptOutcome, "compacted" | "skipped">;
  tokenCount: number;
}> {
  throwIfTurnAborted(options.abortSignal);
  const trigger = options.trigger ?? CompactTrigger.Manual;
  const phase = options.phase ?? defaultCompactPhaseForTrigger(trigger);
  const compactReason = options.compactReason ?? defaultCompactReasonForTrigger(trigger);
  const compactModel =
    options.model ??
    createRuntimeModel(this, {
      selection: this.getSessionModelSelection(),
    });
  // 压缩基准：投机候选使用生成时的快照；普通压缩使用当前 active entries。
  // RuntimeMessageEntry 按不可变约定浅快照；提交时只允许在其后追加 suffix。
  const speculative = options.speculativeResult;
  const activeEntries = [
    ...(speculative?.snapshot.entries ??
      options.activeEntries ??
      this.messageHistory.borrowReadOnlyRuntimeEntries()),
  ];
  const baseGeneration = this.compactionController.generation;
  if (speculative && speculative.snapshot.generation !== baseGeneration) {
    throw createStaleCompactionError({
      baseGeneration,
      candidateGeneration: speculative.snapshot.generation,
    });
  }
  const readCurrentEntries = (): readonly RuntimeMessageEntry[] =>
    options.getCurrentEntries?.() ?? this.messageHistory.borrowReadOnlyRuntimeEntries();
  const useMidConversationSystem =
    this.config.midConversationSystem?.mode === "force" ||
    compactModel.properties.supportsMidConversationSystem;
  const preserveRecentTokenBudget = resolveCompactRecentTailTokenBudget(
    options.compactContextTelemetry?.policyContextWindowTokens,
  );
  const initialSelection =
    speculative?.selection ??
    selectInitialCompactEntriesForActiveConversation({
      activeEntries,
      initialPromptTooLongCause: options.initialPromptTooLongCause,
      preserveRecentTokenBudget,
      trigger,
      useMidConversationSystem,
    });
  let currentSelection = initialSelection;
  let preservedEntries = currentSelection.preservedEntries;
  const initialEntriesForSummary = currentSelection.entriesForSummary;
  let entriesForSummary = initialEntriesForSummary;
  let entriesToSummarize = getRuntimeEntriesToSummarize(entriesForSummary);
  const preCompactTokenCount =
    speculative?.preCompactTokenCount ??
    estimateRuntimeEntryTokens(activeEntries, {
      useMidConversationSystem,
    });
  const maxAttempts = trigger === CompactTrigger.Auto ? AUTO_COMPACT_MAX_ATTEMPTS : 1;
  let attempt = 1;
  const compactTimeline: CompactTimelineContext = {
    operationId: `cmp_${crypto.randomUUID()}`,
    messageId: createMessageId(),
    partId: createPartId(),
    trigger,
    phase,
    compactReason,
    ...(options.sourceCommandId ? { sourceCommandId: options.sourceCommandId } : {}),
    startedAt: Date.now(),
    preCompactTokenCount,
  };

  if (!hasEnoughRuntimeEntriesToCompact(entriesForSummary)) {
    const skippedPayload = this.buildCompactTimelinePayload(compactTimeline, {
      endedAt: Date.now(),
      replace: true,
      status: CompactTimelineStatus.Skipped,
    });
    // 刚压缩过或历史太少时，/compact 是健康 no-op，不能暴露成系统故障。
    // 上层快速回填 tracker 只能记录真实 boundary，因此必须显式返回 skipped。
    await persistCompactTimelineEvent(
      this,
      SessionEventType.CompactCompleted,
      skippedPayload,
      turnTraceContext,
      events,
    );
    return {
      displayText: "Context is up to date; no compression needed",
      entries: activeEntries,
      outcome: "skipped",
      tokenCount: preCompactTokenCount,
    };
  }

  const compactStartedPayload = this.buildCompactTimelinePayload(compactTimeline, {
    ...(maxAttempts > 1 ? { attempt, maxAttempts } : {}),
    status: CompactTimelineStatus.Started,
  });
  await persistCompactTimelineEvent(
    this,
    SessionEventType.CompactStarted,
    compactStartedPayload,
    turnTraceContext,
    events,
  );
  // 止血原因：massive MCP 工具会把 compact summary request 的 provider context 撑爆。
  // ToolSearch/deferred tools 完成前，仅在工具数超过阈值时让 compact summary 保持无工具。
  await this.initializeMcp(turnTraceContext);
  throwIfTurnAborted(options.abortSignal);
  const registry = this.getToolRegistry();
  const runtimeCompactTools = this.getTools(compactModel);
  const compactTools =
    runtimeCompactTools.length > COMPACT_TOOL_KEEP_MAX_COUNT ? [] : runtimeCompactTools;
  // 稳定摘要前缀：所有 outer retry / prompt-too-long retry 复用同一份字符串。
  const compactPrompt = buildCompactPrompt(customInstructions);

  while (true) {
    try {
      const lastSummarizedMessageId =
        speculative?.lastSummarizedMessageId ?? this.latestConversationMessageId;
      const modelTraceContext = createChildTraceContext(turnTraceContext, {
        attributes: {
          model: `${compactModel.providerId}/${compactModel.modelId}`,
          querySource: "compact",
        },
      });
      let result: RuntimeModelTextResult | undefined;
      let compactPromptTooLongAttempts = 0;
      let stripMediaForSummary = false;
      const reselectEntriesAfterPromptTooLong = (cause: unknown): boolean => {
        const reselected = selectCompactEntriesAfterPromptTooLong({
          currentGroupsPreserved: currentSelection.groupsPreserved,
          entries: activeEntries,
          promptTooLongCause: cause,
          trigger,
          useMidConversationSystem,
        });
        if (!reselected) return false;

        compactPromptTooLongAttempts += 1;
        currentSelection = reselected;
        preservedEntries = reselected.preservedEntries;
        entriesForSummary = reselected.entriesForSummary;
        entriesToSummarize = getRuntimeEntriesToSummarize(entriesForSummary);
        return true;
      };
      const truncateEntriesAfterPromptTooLong = (cause: unknown): boolean => {
        if (!canUseCompactSummaryTruncationFallback(trigger)) return false;

        const truncated = truncateCompactSummaryRequestEntriesAfterPromptTooLong({
          attempt: compactPromptTooLongAttempts,
          cause,
          entriesForSummary,
          logger: this.logger,
          traceContext: modelTraceContext,
          useMidConversationSystem,
        });
        if (!truncated) return false;

        compactPromptTooLongAttempts += 1;
        entriesForSummary = truncated;
        entriesToSummarize = getRuntimeEntriesToSummarize(entriesForSummary);
        return true;
      };

      while (!speculative) {
        // 压缩摘要必须与正常 Turn 走同一套 ToolSearch 暴露决策：native 保留
        // tool_reference 并发送 defer_loading schema，local 展开为 <functions>，
        // off 保持全量工具。compactPrompt 与 compactTools 在重试间不变，因此
        // prompt-too-long / outer retry 不会在 native/local/off 之间抖动。
        const prepared = prepareRuntimeProviderRequest(this, {
          model: compactModel,
          tools: compactTools,
          registry,
          entries: entriesForSummary,
          prompt: compactPrompt,
          applyCacheControl: true,
          skipCacheWrite: true,
        });
        const requestMessages = prepared.request.messages;
        const recordableEntries = filterOutputTokenContinuationEntries(prepared.entries);
        const recordableRequestMessages =
          recordableEntries === prepared.entries
            ? requestMessages
            : buildCompactSummaryRequestMessages(recordableEntries, compactPrompt, {
                useMidConversationSystem,
                loadedToolCallIds: prepared.loadedToolCallIds,
              });
        // Compact 曾只执行 capability projection，漏掉普通 turn 共用的聚合
        // 媒体预算；统一走模型媒体策略，避免 summary 请求绕过全局请求上限。
        const mediaPolicyProjection = projectMessagesForModelMediaPolicy(
          requestMessages,
          compactModel.properties.inputFormat,
        );
        logMediaCapabilityProjection(
          this.logger,
          modelTraceContext,
          mediaPolicyProjection.capabilityProjection,
          {
            event: "compact.request.media_capability_projection",
            message: "Compact request media capability projection",
            model: `${compactModel.providerId}/${compactModel.modelId}`,
          },
        );
        logMediaBudgetProjection(
          this.logger,
          modelTraceContext,
          mediaPolicyProjection.mediaBudgetProjection,
          {
            event: "compact.request.media_projection",
            message: "Compact request media budget projection",
          },
        );
        let projectedRequestMessages = mediaPolicyProjection.messages;
        let projectedRecordableMessages =
          recordableRequestMessages === requestMessages
            ? projectedRequestMessages
            : projectMessagesForModelMediaPolicy(
                recordableRequestMessages,
                compactModel.properties.inputFormat,
              ).messages;
        if (stripMediaForSummary) {
          // 复用通用 media budget 文案会污染 summary 的 provider-visible 内容。
          const mediaProjection = projectCompactMediaForRetry(projectedRequestMessages);
          projectedRequestMessages = mediaProjection.messages;
          projectedRecordableMessages =
            recordableRequestMessages === requestMessages
              ? projectedRequestMessages
              : projectCompactMediaForRetry(projectedRecordableMessages).messages;
          logCompactMediaRetryProjection(this.logger, modelTraceContext, mediaProjection);
        }

        const modelRequestEvent = this.createEvent(
          SessionEventType.ModelRequest,
          {
            // 事件误用了含 Continue 的实际请求数组，导致 query-local 提示进入持久化轨迹。
            // 与 v0.16.6 一致：事件记录过滤后的投影，下面的 provider 请求仍使用完整上下文。
            messages: projectedRecordableMessages,
            providerId: String(compactModel.providerId),
            modelId: String(compactModel.modelId),
            querySource: "compact",
            toolCount: prepared.request.tools.length,
            compactPromptTooLongRetry: compactPromptTooLongAttempts,
          },
          modelTraceContext,
        );
        await this.appendEvent(modelRequestEvent, modelTraceContext);
        events.push(modelRequestEvent);
        const modelStartedAt = Date.now();
        const networkEventStartIndex = events.length;
        const compactSummaryMaxOutputTokens = capCompactSummaryMaxOutputTokens(compactModel);
        const compactModelRequest = {
          abortSignal: options.abortSignal,
          maxOutputTokens: compactSummaryMaxOutputTokens,
          messages: projectedRequestMessages,
          metadata: traceContextToLogContext(modelTraceContext),
          modelRequestSessionType: resolveModelRequestSessionTypeFromTaskType(this.config.taskType),
          modelCall: {
            attributes: {
              compactionOuterAttempt: attempt,
              compactionTrigger: trigger,
            },
            operation: "context_compaction" as const,
            operationId: compactTimeline.operationId,
          },
          statusSink: this.createModelStatusSink(modelTraceContext, events),
          // compact 的首个真实 provider event 结束 SSE retry 资格；隐藏 partial 在
          // content block 提交前仍可丢弃并 HTTP fallback，block end 后则禁止任何重放。
          preserveProviderStreamBoundaries: true,
          traceContext: modelTraceContext,
          tools: prepared.request.tools,
          toolSearchEnabled: prepared.request.toolSearchEnabled,
          refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(this, {
            abortSignal: options.abortSignal,
            model: compactModel,
            traceContext: modelTraceContext,
          }),
        };

        try {
          result = await runCompactSummaryModelRequest({
            logger: this.logger,
            model: compactModel,
            request: compactModelRequest,
          });
        } catch (error) {
          await recordModelUsageFact(this, {
            attemptIndex: compactPromptTooLongAttempts,
            error,
            events,
            model: compactModel,
            networkEventStartIndex,
            querySource: "compact",
            startedAt: modelStartedAt,
            status: isTurnCancellationError(error, options.abortSignal) ? "cancelled" : "error",
            traceContext: modelTraceContext,
          });
          if (isTurnCancellationError(error, options.abortSignal)) {
            throw error;
          }
          if (isModelMediaTooLargeError(error) && !stripMediaForSummary) {
            stripMediaForSummary = true;
            this.logger?.info(
              "Compact summary hit media-size error; retrying with stripped media",
              {
                ...traceContextToLogContext(modelTraceContext),
                errorMessage: error instanceof Error ? error.message : String(error),
                event: "compact.request.media_too_large.retry",
                module: "core.runtime",
              },
            );
            continue;
          }
          if (isModelContextExceededError(error)) {
            if (reselectEntriesAfterPromptTooLong(error)) continue;
            if (truncateEntriesAfterPromptTooLong(error)) continue;
            throw createCompactPromptTooLongError({
              attempt: compactPromptTooLongAttempts,
              cause: error,
              preCompactTokenCount,
            });
          }
          throw error;
        }

        await recordModelUsageFact(this, {
          attemptIndex: compactPromptTooLongAttempts,
          events,
          model: compactModel,
          networkEventStartIndex,
          querySource: "compact",
          result,
          startedAt: modelStartedAt,
          status: "completed",
          toolCallCount: this.extractToolCallsFromResult(result).length,
          traceContext: modelTraceContext,
        });
        const contextError = createCompactContextExceededFinishError(result);
        if (contextError) {
          // compact summary 也可能以 finishReason 返回超窗而不是 throw；
          // 必须先进入同一套 recent preserve 重选逻辑，避免 finishReason 路径丢上下文。
          if (reselectEntriesAfterPromptTooLong(contextError)) continue;
          if (truncateEntriesAfterPromptTooLong(contextError)) continue;
          throw createCompactPromptTooLongError({
            attempt: compactPromptTooLongAttempts,
            cause: contextError,
            preCompactTokenCount,
          });
        }
        break;
      }

      const summary = speculative?.summary ?? formatCompactSummaryOrThrow(this, result!);
      const summaryUsage = speculative?.usage ?? result!.usage;
      const persistedSummary = summary;
      const planFileReferenceEntry = this.fileSystemPort
        ? await readApprovedPlanFileReferenceEntry({
            abortSignal: options.abortSignal,
            fileSystemPort: this.fileSystemPort,
            sessionId: this.sessionId,
            traceContext: modelTraceContext,
            workspaceRoot: this.workspaceRoot,
          })
        : undefined;
      // 压缩会丢弃大多数历史 reminder；按保留尾部重算 Agent 目录，
      // 未公告过的类型在下一次模型请求前重新出现。
      const agentListingEntry = collectRuntimeAgentListing(
        this,
        preservedEntries,
        options.agentListingTools ?? this.getTools(options.model ?? compactModel),
      );
      const postCompactReminderEntries = [
        ...(agentListingEntry ? [agentListingEntry] : []),
        ...(planFileReferenceEntry ? [planFileReferenceEntry] : []),
        ...buildPostCompactReadStateReminderEntries({
          preservedEntries,
          readFileState: this.readFileState,
        }),
      ];

      const modelCompleteEvent = this.createEvent(
        SessionEventType.ModelComplete,
        {
          content: summary,
          stopReason: speculative ? "stop" : result?.finishReason,
          usage: summaryUsage,
          querySource: "compact",
          toolCallCount: 0,
        },
        modelTraceContext,
      );
      await this.appendEvent(modelCompleteEvent, modelTraceContext);
      events.push(modelCompleteEvent);

      const summaryMessageId = createMessageId();
      // 摘要必然是 lossy 的。把被摘要掉的 transcript 落成 session artifact，
      // 摘要消息里给出路径；模型需要精确代码/规则时可用 Read 回查，而不是只相信摘要。
      const transcriptPath = await persistCompactionTranscript.call(
        this,
        entriesToSummarize,
        compactTimeline.operationId,
        turnTraceContext,
      );
      const summaryMessageContent = buildCompactSummaryMessage(persistedSummary, {
        suppressFollowup: true,
        ...(transcriptPath ? { transcriptPath } : {}),
      });
      // Continue 没有对应 Session message；无 store 的统计也不能把它计入保留记录。
      const recordablePreservedEntries = filterOutputTokenContinuationEntries(preservedEntries);
      const preservation = this.sessionStore
        ? await selectPersistedCompactTail({
            sessionStore: this.sessionStore,
            sessionId: this.sessionId,
            groupsPreserved: currentSelection.groupsPreserved,
            summaryMessageId,
          })
        : { keptMessageCount: countCompactPreservedRuntimeMessages(recordablePreservedEntries) };
      const postCompactEntries = buildPostCompactRuntimeEntries(
        activeEntries,
        {
          message: {
            role: "user",
            content: summaryMessageContent,
          },
          metadata: legacySyntheticRuntimeMetadata(),
        },
        {
          postCompactReminderEntries,
          preservedEntries,
        },
      );
      // 提交前确认基准仍是当前前缀；并发追加的 suffix 原样保留，
      // 但微压缩/rewind/另一个替换导致前缀失效时必须整体丢弃。
      const commitSuffix = resolveCompactionCommitSuffix(
        this.compactionController,
        activeEntries,
        baseGeneration,
        readCurrentEntries(),
      );
      const finalEntries = [...postCompactEntries, ...commitSuffix];
      const currentPreCompactTokenCount = estimateRuntimeEntryTokens(readCurrentEntries(), {
        useMidConversationSystem,
      });
      const truePostCompactTokenCount = estimateRuntimeEntryTokens(finalEntries, {
        useMidConversationSystem,
      });
      // 压缩是状态转换，不是“生成过摘要”就算成功：摘要 + 保留尾部 + 并发 suffix
      // 必须真的小于提交时上下文，否则下一次请求仍会触发压缩，形成静默抖动。
      assertCompactionShrink({
        preservedGroups: currentSelection.groupsPreserved,
        preCompactTokenCount: currentPreCompactTokenCount,
        postCompactTokenCount: truePostCompactTokenCount,
      });
      const providerPostCompactTokenCount = getUsageTotalTokens(summaryUsage);
      // 只保存发现事实（工具名），让 Local 在 compact 后继续把已加载工具视为常驻；
      // 不在边界里复制 schema 或搜索结果。
      const preCompactDiscoveredTools = collectDiscoveredTools(activeEntries);
      const compactBoundary = buildManualCompactBoundary({
        boundaryId: createCompactBoundaryId(),
        autoCompactThreshold: options.autoCompactThreshold,
        historyGeneration: baseGeneration + 1,
        compactReason,
        customInstructions,
        lastSummarizedMessageId,
        phase,
        postCompactTokenCount: providerPostCompactTokenCount,
        preCompactTokenCount,
        ...(preCompactDiscoveredTools.size > 0
          ? { preCompactDiscoveredTools: [...preCompactDiscoveredTools] }
          : {}),
        summarizedMessageCount: entriesToSummarize.length,
        summaryMessageId,
        traceContext: turnTraceContext,
        trigger,
        ...(currentSelection.groupsPreserved > 0
          ? {
              keptMessageCount: preservation.keptMessageCount,
            }
          : {}),
        preservedSegment: preservation.preservedSegment,
        truePostCompactTokenCount,
        willRetriggerNextTurn:
          options.autoCompactThreshold !== undefined
            ? truePostCompactTokenCount >= options.autoCompactThreshold
            : undefined,
      });

      const persistedMessageIds = await this.persistCompactSummary(
        summaryMessageId,
        summaryMessageContent,
        persistedSummary,
        compactBoundary,
        modelTraceContext,
        {
          model: compactModel,
          operationId: compactTimeline.operationId,
          postCompactReminderEntries,
        },
      );
      // 持久化也可能跨 await；落 boundary 前再次确认基准，失败时回滚已写消息。
      const commitSuffixAfterPersist = resolveCompactionCommitSuffix(
        this.compactionController,
        activeEntries,
        baseGeneration,
        readCurrentEntries(),
      );
      if (!sameRuntimeEntrySequence(commitSuffixAfterPersist, commitSuffix)) {
        await rollbackCompactPersistenceMessages.call(
          this,
          persistedMessageIds,
          modelTraceContext,
        );
        throw createStaleCompactionError({
          baseGeneration,
          reason: "snapshot_changed_during_persist",
        });
      }

      const compactBoundaryEvent = this.createEvent(
        SessionEventType.CompactBoundary,
        compactBoundary,
        turnTraceContext,
      );
      await this.appendEvent(compactBoundaryEvent, turnTraceContext);
      events.push(compactBoundaryEvent);

      const compactCompletedPayload = this.buildCompactTimelinePayload(compactTimeline, {
        ...(maxAttempts > 1 ? { attempt, maxAttempts } : {}),
        boundaryId: compactBoundary.boundaryId,
        endedAt: Date.now(),
        postCompactTokenCount: providerPostCompactTokenCount,
        replace: true,
        status: CompactTimelineStatus.Completed,
        summaryMessageId,
        tailStartMessageId: lastSummarizedMessageId,
        truePostCompactTokenCount,
      });
      await persistCompactTimelineEvent(
        this,
        SessionEventType.CompactCompleted,
        compactCompletedPayload,
        turnTraceContext,
        events,
      );

      // 原子提交：最后一次同步校验 + 一次 replaceMessages + 推进代数。
      const finalCommitSuffix = resolveCompactionCommitSuffix(
        this.compactionController,
        activeEntries,
        baseGeneration,
        readCurrentEntries(),
      );
      if (!sameRuntimeEntrySequence(finalCommitSuffix, commitSuffix)) {
        throw createStaleCompactionError({
          baseGeneration,
          reason: "snapshot_changed_before_commit",
        });
      }
      this.latestConversationMessageId = summaryMessageId;
      const recordablePostCompactEntries = filterOutputTokenContinuationEntries(finalEntries);
      this.messageHistory.replaceMessages(
        options.activeEntries
          ? preserveCanonicalContextPrefix(
              this.messageHistory.borrowReadOnlyRuntimeEntries(),
              recordablePostCompactEntries,
            )
          : recordablePostCompactEntries,
      );
      this.compactionController.commitGeneration(baseGeneration);
      this.readFileState.clear();
      return {
        displayText: "Compacted",
        entries: finalEntries,
        outcome: "compacted",
        tokenCount: providerPostCompactTokenCount,
      };
    } catch (error) {
      if (
        trigger === CompactTrigger.Auto &&
        attempt < maxAttempts &&
        !isTurnCancellationError(error, options.abortSignal) &&
        isAutoCompactRetryableError(error)
      ) {
        attempt += 1;
        const retryPayload = this.buildCompactTimelinePayload(compactTimeline, {
          attempt,
          maxAttempts,
          reason: compactFailureReasonFromError(error),
          status: CompactTimelineStatus.Retrying,
        });
        // 自动 compact 的中间失败不能提前落成 failed 横线。
        // 这里在同一个 operation 上发 retrying，直到第 3 次仍失败才写最终 failed。
        await persistCompactTimelineEvent(
          this,
          SessionEventType.CompactStarted,
          retryPayload,
          turnTraceContext,
          events,
        );
        this.logger?.warn("Auto compact retrying", {
          ...traceContextToLogContext(turnTraceContext),
          attempt,
          errorMessage: error instanceof Error ? error.message : String(error),
          event: "compact.auto.retrying",
          maxAttempts,
          module: "core.runtime",
          timelineStatus: CompactTimelineStatus.Retrying,
        });
        currentSelection = initialSelection;
        preservedEntries = currentSelection.preservedEntries;
        entriesForSummary = initialEntriesForSummary;
        entriesToSummarize = getRuntimeEntriesToSummarize(entriesForSummary);
        continue;
      }
      await this.finishCompactTimelineFailure({
        abortSignal: options.abortSignal,
        attempt,
        error,
        events,
        maxAttempts: maxAttempts > 1 ? maxAttempts : undefined,
        timeline: compactTimeline,
        traceContext: turnTraceContext,
      });
      throw error;
    }
  }
}

async function persistCompactionTranscript(
  this: AgentRuntimeInternal,
  entries: readonly RuntimeMessageEntry[],
  operationId: string,
  traceContext: TraceContext,
): Promise<string | undefined> {
  if (!this.artifactStore || entries.length === 0) return undefined;
  let content: string;
  try {
    content = entries
      .map((entry) =>
        JSON.stringify(
          "message" in entry
            ? {
                message: entry.message,
                ...(entry.metadata?.source ? { source: entry.metadata.source } : {}),
              }
            : {
                content: entry.content,
                ...(entry.metadata?.source ? { source: entry.metadata.source } : {}),
              },
        ),
      )
      .join("\n");
  } catch (error) {
    this.logger?.warn("Compaction transcript serialization failed", {
      ...traceContextToLogContext(traceContext),
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "compact.transcript.serialization_failed",
      module: "core.runtime",
      status: "failed",
    });
    return undefined;
  }
  if (Buffer.byteLength(content, "utf8") > MAX_COMPACTION_TRANSCRIPT_BYTES) {
    this.logger?.warn("Compaction transcript skipped because it exceeds the size budget", {
      ...traceContextToLogContext(traceContext),
      bytes: Buffer.byteLength(content, "utf8"),
      event: "compact.transcript.skipped_too_large",
      maxBytes: MAX_COMPACTION_TRANSCRIPT_BYTES,
      module: "core.runtime",
      status: "failed",
    });
    return undefined;
  }
  try {
    const artifact = await this.artifactStore.writeToolResultArtifact({
      sessionId: this.sessionId,
      toolCallId: `compaction-${operationId}`,
      toolName: "CompactionTranscript",
      content,
      contentType: "application/x-ndjson",
      retention: "session",
      trace: traceContext,
    });
    return artifact.path;
  } catch (error) {
    this.logger?.warn("Compaction transcript persistence failed", {
      ...traceContextToLogContext(traceContext),
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "compact.transcript.write_failed",
      module: "core.runtime",
      status: "failed",
    });
    return undefined;
  }
}

function isAutoCompactRetryableError(error: unknown): boolean {
  return isCoreError(error) ? error.retryable : true;
}

function canUseCompactSummaryTruncationFallback(trigger: CompactTrigger): boolean {
  return trigger !== CompactTrigger.Auto && trigger !== CompactTrigger.Reactive;
}

function createStaleCompactionError(input: {
  baseGeneration: number;
  candidateGeneration?: number;
  reason?: string;
}): Error {
  return createCoreError(
    CoreErrorType.InvalidStateTransition,
    "Compaction base changed; discarding stale result",
    {
      context: {
        baseGeneration: input.baseGeneration,
        ...(input.candidateGeneration !== undefined
          ? { candidateGeneration: input.candidateGeneration }
          : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      recoverable: true,
      retryable: true,
    },
  );
}

function sameRuntimeEntrySequence(
  left: readonly RuntimeMessageEntry[],
  right: readonly RuntimeMessageEntry[],
): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function resolveCompactionCommitSuffix(
  controller: AgentRuntimeInternal["compactionController"],
  baseEntries: readonly RuntimeMessageEntry[],
  baseGeneration: number,
  currentEntries: readonly RuntimeMessageEntry[],
): RuntimeMessageEntry[] {
  if (controller.generation !== baseGeneration) {
    throw createStaleCompactionError({
      baseGeneration,
      candidateGeneration: controller.generation,
      reason: "generation_changed",
    });
  }
  const suffix = runtimeEntrySnapshotSuffix(baseEntries, currentEntries);
  if (suffix === undefined) {
    throw createStaleCompactionError({
      baseGeneration,
      reason: "snapshot_not_prefix",
    });
  }
  return suffix;
}

function selectInitialCompactEntriesForActiveConversation(input: {
  activeEntries: readonly RuntimeMessageEntry[];
  initialPromptTooLongCause?: unknown;
  preserveRecentTokenBudget?: number;
  trigger: CompactTrigger;
  useMidConversationSystem?: boolean;
}) {
  const baseSelection = selectCompactEntries({
    entries: input.activeEntries,
    preserveRecentTokenBudget: input.preserveRecentTokenBudget,
    trigger: input.trigger,
    useMidConversationSystem: input.useMidConversationSystem,
  });
  if (input.initialPromptTooLongCause === undefined) {
    return baseSelection;
  }

  return (
    selectCompactEntriesForInitialPromptTooLong({
      entries: input.activeEntries,
      promptTooLongCause: input.initialPromptTooLongCause,
      trigger: input.trigger,
      useMidConversationSystem: input.useMidConversationSystem,
    }) ?? baseSelection
  );
}
