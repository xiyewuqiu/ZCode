/* eslint-disable max-lines -- compact round 选择、prompt-too-long 降级与整组保留预算共享同一套 token 估算。 */
import {
  COMPACT_PROMPT_TOO_LONG_RETRY_MARKER,
  CompactTrigger,
  MAX_COMPACT_PROMPT_TOO_LONG_RETRIES,
  countContextPrefixMessages,
  estimateMessageTokens,
  modelMessageContentToText,
  traceContextToLogContext,
} from "../deps.js";
import type { TraceContext } from "../deps.js";
import {
  cloneRuntimeMessageEntry,
  isRuntimeAttachmentEntry,
  type RuntimeMessageEntry,
} from "../../agent/message-history.js";
import { groupByAssistantStartedRounds } from "../../compact/rounds.js";
import { buildProviderRequestMessages } from "./provider-request-messages.js";

interface CompactRetryLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface CompactEntrySelection {
  entriesForSummary: RuntimeMessageEntry[];
  groupsPreserved: number;
  preservedEntries: RuntimeMessageEntry[];
  totalGroups: number;
}

export const COMPACT_RECENT_TAIL_MIN_TOKENS = 4_000;
export const COMPACT_RECENT_TAIL_MAX_TOKENS = 50_000;
export const COMPACT_RECENT_TAIL_RATIO = 0.1;
// Codex 对齐的保留预算：工具输出最多 64k，用户消息最多 20k。
// YCode 现有 10% / 50k tail 仍是总预算；这两个上限只在更大窗口或自定义 tail 时兜底。
export const COMPACT_RETAINED_TOOL_OUTPUT_MAX_TOKENS = 64_000;
export const COMPACT_RETAINED_USER_MESSAGE_MAX_TOKENS = 20_000;

/**
 * 活跃边缘预算：保留最近 10% 上下文（上限 50k），确保压缩后仍能直接看到
 * 当前代码、工具输出和用户约束，而不是只靠摘要转述。
 */
export function resolveCompactRecentTailTokenBudget(contextWindowTokens?: number): number {
  const window = positiveInt(contextWindowTokens) ?? 200_000;
  return Math.min(
    COMPACT_RECENT_TAIL_MAX_TOKENS,
    Math.max(COMPACT_RECENT_TAIL_MIN_TOKENS, Math.floor(window * COMPACT_RECENT_TAIL_RATIO)),
  );
}

export function selectCompactEntries(input: {
  entries: readonly RuntimeMessageEntry[];
  minimumGroupsToPreserve?: number;
  preserveRecentTokenBudget?: number;
  trigger: CompactTrigger;
  useMidConversationSystem?: boolean;
}): CompactEntrySelection {
  const split = splitRuntimeEntriesForCompactSelection(input.entries, input.trigger);
  const baseGroupsToPreserve = split.shouldPreserveRecent && split.groups.length > 1 ? 1 : 0;
  const requestedGroupsToPreserve = Math.max(
    baseGroupsToPreserve,
    positiveInt(input.minimumGroupsToPreserve) ?? 0,
  );
  const maxGroupsToPreserve = Math.max(0, split.groups.length - 1);
  let groupsToPreserve = split.shouldPreserveRecent
    ? Math.min(requestedGroupsToPreserve, maxGroupsToPreserve)
    : 0;
  const tailBudget = positiveInt(input.preserveRecentTokenBudget);
  if (split.shouldPreserveRecent && tailBudget !== undefined && tailBudget > 0) {
    const groupTokenEstimates = estimateCompactGroupTokens(split.groups, {
      useMidConversationSystem: input.useMidConversationSystem,
    });
    groupsToPreserve = Math.max(
      groupsToPreserve,
      countWholeGroupsToPreserve(split.groups, groupTokenEstimates, tailBudget, {
        useMidConversationSystem: input.useMidConversationSystem,
      }),
    );
    // 至少留出两个 round 给摘要，避免把整段历史都塞进 verbatim tail。
    if (split.groups.length > 2) {
      groupsToPreserve = Math.min(groupsToPreserve, split.groups.length - 2);
    }
    groupsToPreserve = Math.min(groupsToPreserve, maxGroupsToPreserve);
  }
  const summaryGroups =
    groupsToPreserve > 0
      ? split.groups.slice(0, split.groups.length - groupsToPreserve)
      : split.groups;
  const preservedGroups = groupsToPreserve > 0 ? split.groups.slice(-groupsToPreserve) : [];

  return {
    entriesForSummary: [...split.prefixEntries, ...summaryGroups.flat()].map(cloneRuntimeEntry),
    groupsPreserved: groupsToPreserve,
    preservedEntries: preservedGroups.flat().map(cloneRuntimeEntry),
    totalGroups: split.groups.length,
  };
}

export function selectCompactEntriesAfterPromptTooLong(input: {
  entries: readonly RuntimeMessageEntry[];
  promptTooLongCause: unknown;
  trigger: CompactTrigger;
  useMidConversationSystem?: boolean;
  currentGroupsPreserved: number;
}): CompactEntrySelection | null {
  const split = splitRuntimeEntriesForCompactSelection(input.entries, input.trigger);
  if (!split.shouldPreserveRecent || split.groups.length < 2) {
    return null;
  }

  const maxGroupsToPreserve = split.groups.length - 1;
  if (input.currentGroupsPreserved >= maxGroupsToPreserve) {
    return null;
  }

  const summarizedGroupCount = split.groups.length - input.currentGroupsPreserved;
  const groupsForSummary = split.groups.slice(0, summarizedGroupCount);
  if (groupsForSummary.length < 2) {
    return null;
  }

  const groupsToMove = countRecentGroupsToPreserveAfterPromptTooLong(
    groupsForSummary,
    input.promptTooLongCause,
    { useMidConversationSystem: input.useMidConversationSystem },
  );
  const nextGroupsPreserved = Math.min(
    maxGroupsToPreserve,
    input.currentGroupsPreserved + groupsToMove,
  );
  if (nextGroupsPreserved <= input.currentGroupsPreserved) {
    return null;
  }

  const nextSelection = selectCompactEntries({
    entries: input.entries,
    minimumGroupsToPreserve: nextGroupsPreserved,
    trigger: input.trigger,
  });
  return hasEnoughRuntimeEntriesToCompact(nextSelection.entriesForSummary) ? nextSelection : null;
}

export function selectCompactEntriesForInitialPromptTooLong(input: {
  entries: readonly RuntimeMessageEntry[];
  promptTooLongCause: unknown;
  trigger: CompactTrigger;
  useMidConversationSystem?: boolean;
}): CompactEntrySelection | null {
  const split = splitRuntimeEntriesForCompactSelection(input.entries, input.trigger);
  if (!split.shouldPreserveRecent || split.groups.length <= 3) {
    return null;
  }

  const tokenGap = getPromptTooLongTokenGap(input.promptTooLongCause);
  if (tokenGap === undefined) {
    return null;
  }

  const groupTokenEstimates = estimateCompactGroupTokens(split.groups, {
    useMidConversationSystem: input.useMidConversationSystem,
  });
  const alreadyPreservedTokens = groupTokenEstimates.at(-1) ?? 0;
  const remainingTokenGap = tokenGap - alreadyPreservedTokens;
  if (remainingTokenGap <= 0) {
    return null;
  }

  const additionalGroupsToPreserve = countRecentGroupsToCoverTokenGap(
    groupTokenEstimates,
    split.groups.length - 1,
    remainingTokenGap,
  );
  const nextSelection = selectCompactEntries({
    entries: input.entries,
    minimumGroupsToPreserve: 1 + additionalGroupsToPreserve,
    trigger: input.trigger,
  });
  return hasEnoughRuntimeEntriesToCompact(nextSelection.entriesForSummary) ? nextSelection : null;
}

export function getRuntimeEntriesToSummarize(
  entries: readonly RuntimeMessageEntry[],
): RuntimeMessageEntry[] {
  return entries.filter((entry) => !isRuntimeContextPrefixEntry(entry)).map(cloneRuntimeEntry);
}

export function hasEnoughRuntimeEntriesToCompact(entries: readonly RuntimeMessageEntry[]): boolean {
  const entriesToSummarize = getRuntimeEntriesToSummarize(entries);
  return (
    groupRuntimeEntriesByCompactRound(entriesToSummarize).length >= 2 &&
    entriesToSummarize.some((entry) => runtimeEntryRole(entry) === "assistant")
  );
}

export function estimateRuntimeEntryTokens(
  entries: readonly RuntimeMessageEntry[],
  options: { useMidConversationSystem?: boolean } = {},
): number {
  const providerMessages = buildProviderRequestMessages({
    entries,
    applyCacheControl: false,
    useMidConversationSystem: options.useMidConversationSystem,
  }).messages;
  return estimateMessageTokens(providerMessages);
}

export function truncateCompactSummaryRequestEntriesAfterPromptTooLong(options: {
  attempt: number;
  cause: unknown;
  entriesForSummary: readonly RuntimeMessageEntry[];
  logger?: CompactRetryLogger;
  traceContext: TraceContext;
  useMidConversationSystem?: boolean;
}): RuntimeMessageEntry[] | null {
  if (options.attempt >= MAX_COMPACT_PROMPT_TOO_LONG_RETRIES) {
    options.logger?.warn("Compact summary prompt was too long; retry limit reached", {
      ...traceContextToLogContext(options.traceContext),
      attempt: options.attempt,
      event: "compact.prompt_too_long.retry_limit",
      maxAttempts: MAX_COMPACT_PROMPT_TOO_LONG_RETRIES,
      module: "core.runtime",
      remainingMessages: options.entriesForSummary.length,
    });
    return null;
  }

  const truncated = truncateRuntimeEntriesForCompactRetry(
    options.entriesForSummary,
    options.cause,
    { useMidConversationSystem: options.useMidConversationSystem },
  );
  if (!truncated) {
    return null;
  }

  options.logger?.warn("Compact summary prompt was too long; retrying with older rounds dropped", {
    ...traceContextToLogContext(options.traceContext),
    attempt: options.attempt + 1,
    droppedMessages: options.entriesForSummary.length - truncated.length,
    event: "compact.prompt_too_long.retry",
    maxAttempts: MAX_COMPACT_PROMPT_TOO_LONG_RETRIES,
    module: "core.runtime",
    remainingMessages: truncated.length,
  });

  return truncated;
}

function splitRuntimeEntriesForCompactSelection(
  inputEntries: readonly RuntimeMessageEntry[],
  trigger: CompactTrigger,
): {
  groups: RuntimeMessageEntry[][];
  prefixEntries: RuntimeMessageEntry[];
  shouldPreserveRecent: boolean;
} {
  const entries = inputEntries.map(cloneRuntimeEntry);
  const prefixCount = countContextPrefixMessages(entries);
  const prefixEntries = entries.slice(0, prefixCount);
  const bodyEntries = entries.slice(prefixCount);

  return {
    groups: groupRuntimeEntriesByCompactRound(bodyEntries),
    prefixEntries,
    shouldPreserveRecent: trigger === CompactTrigger.Auto || trigger === CompactTrigger.Reactive,
  };
}

function countRecentGroupsToPreserveAfterPromptTooLong(
  groupsForSummary: readonly RuntimeMessageEntry[][],
  promptTooLongCause: unknown,
  options: { useMidConversationSystem?: boolean } = {},
): number {
  const tokenGap = getPromptTooLongTokenGap(promptTooLongCause);
  if (tokenGap === undefined) {
    return 1;
  }

  const groupTokenEstimates = estimateCompactGroupTokens(groupsForSummary, {
    useMidConversationSystem: options.useMidConversationSystem,
  });
  return countRecentGroupsToCoverTokenGap(groupTokenEstimates, groupsForSummary.length, tokenGap);
}

function countRecentGroupsToCoverTokenGap(
  groupTokenEstimates: readonly number[],
  groupCount: number,
  tokenGap: number,
): number {
  if (tokenGap <= 0 || groupCount <= 0) {
    return 0;
  }

  let tokensCovered = 0;
  let groupsCovered = 0;
  for (let index = groupCount - 1; index >= 0; index -= 1) {
    tokensCovered += groupTokenEstimates[index] ?? 0;
    groupsCovered += 1;
    if (tokensCovered >= tokenGap) break;
  }

  if (groupsCovered >= groupCount - 1) {
    return Math.max(1, Math.floor(groupCount / 2));
  }
  return Math.max(1, groupsCovered);
}

function estimateCompactGroupTokens(
  groups: readonly RuntimeMessageEntry[][],
  options: { useMidConversationSystem?: boolean } = {},
): number[] {
  return groups.map((group) =>
    estimateRuntimeEntryTokens(group, {
      useMidConversationSystem: options.useMidConversationSystem,
    }),
  );
}

/**
 * 从最新 round 向旧遍历，只有整个 round 放得下才保留。
 *
 * - 最新 round 永远整体保留，即使单轮超过预算；
 * - 更旧的 round 一旦整体超出 tail / 工具输出 / 用户消息预算，就整体丢弃并停止，
 *   不会出现只保留半截 tool result 的情况。
 */
function countWholeGroupsToPreserve(
  groups: readonly RuntimeMessageEntry[][],
  groupTokenEstimates: readonly number[],
  tailBudgetTokens: number,
  options: { useMidConversationSystem?: boolean } = {},
): number {
  let coveredTokens = 0;
  let coveredGroups = 0;
  let retainedToolTokens = 0;
  let retainedUserTokens = 0;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    const groupTokens = groupTokenEstimates[index] ?? 0;
    const { toolTokens, userTokens } = estimateCompactGroupRoleTokens(group, options);
    const isNewest = coveredGroups === 0;
    const exceedsBudget =
      coveredTokens + groupTokens > tailBudgetTokens ||
      retainedToolTokens + toolTokens > COMPACT_RETAINED_TOOL_OUTPUT_MAX_TOKENS ||
      retainedUserTokens + userTokens > COMPACT_RETAINED_USER_MESSAGE_MAX_TOKENS;
    if (!isNewest && exceedsBudget) break;

    coveredTokens += groupTokens;
    retainedToolTokens += toolTokens;
    retainedUserTokens += userTokens;
    coveredGroups += 1;
    if (coveredTokens >= tailBudgetTokens) break;
  }

  return coveredGroups;
}

function estimateCompactGroupRoleTokens(
  group: readonly RuntimeMessageEntry[],
  options: { useMidConversationSystem?: boolean } = {},
): { toolTokens: number; userTokens: number } {
  const toolEntries = group.filter((entry) => runtimeEntryRole(entry) === "tool");
  const userEntries = group.filter((entry) => runtimeEntryRole(entry) === "user");
  return {
    toolTokens:
      toolEntries.length > 0
        ? estimateRuntimeEntryTokens(toolEntries, {
            useMidConversationSystem: options.useMidConversationSystem,
          })
        : 0,
    userTokens:
      userEntries.length > 0
        ? estimateRuntimeEntryTokens(userEntries, {
            useMidConversationSystem: options.useMidConversationSystem,
          })
        : 0,
  };
}

function truncateRuntimeEntriesForCompactRetry(
  entries: readonly RuntimeMessageEntry[],
  promptTooLongCause: unknown,
  options: { useMidConversationSystem?: boolean } = {},
): RuntimeMessageEntry[] | null {
  const prefix: RuntimeMessageEntry[] = [];
  let index = 0;
  while (index < entries.length && isRuntimeContextPrefixEntry(entries[index]!)) {
    prefix.push(cloneRuntimeEntry(entries[index]!));
    index += 1;
  }

  let candidates = entries.slice(index);
  if (candidates[0] && isCompactPromptTooLongRetryMarker(candidates[0])) {
    candidates = candidates.slice(1);
  }

  const groups = groupRuntimeEntriesByCompactRound(candidates);
  if (groups.length < 2) return null;

  const tokenGap = getPromptTooLongTokenGap(promptTooLongCause);
  let dropCount = 0;
  if (tokenGap !== undefined) {
    let droppedTokens = 0;
    for (const group of groups) {
      droppedTokens += estimateRuntimeEntryTokens(group, {
        useMidConversationSystem: options.useMidConversationSystem,
      });
      dropCount += 1;
      if (droppedTokens >= tokenGap) break;
    }
  } else {
    dropCount = Math.max(1, Math.floor(groups.length * 0.2));
  }

  dropCount = Math.min(dropCount, groups.length - 1);
  if (dropCount < 1) return null;

  const sliced = groups.slice(dropCount).flat().map(cloneRuntimeEntry);
  if (sliced.length === 0) return null;

  const needsMarker = sliced[0] && runtimeEntryRole(sliced[0]) === "assistant";
  return [
    ...prefix,
    ...(needsMarker
      ? [
          {
            message: {
              role: "user" as const,
              content: COMPACT_PROMPT_TOO_LONG_RETRY_MARKER,
            },
          },
        ]
      : []),
    ...sliced,
  ];
}

function isRuntimeContextPrefixEntry(entry: RuntimeMessageEntry): boolean {
  if (isRuntimeAttachmentEntry(entry)) {
    return entry.metadata.source === "context_prefix" || entry.metadata.source === "skills_listing";
  }
  if (entry.message.role === "system") return true;
  if (entry.message.role !== "user") return false;
  if (entry.metadata) {
    return entry.metadata.source === "context_prefix" || entry.metadata.source === "skills_listing";
  }
  return modelMessageContentToText(entry.message.content)
    .trimStart()
    .startsWith("<system-reminder>");
}

function isCompactPromptTooLongRetryMarker(entry: RuntimeMessageEntry): boolean {
  if (isRuntimeAttachmentEntry(entry)) return false;
  return (
    entry.message.role === "user" &&
    modelMessageContentToText(entry.message.content) === COMPACT_PROMPT_TOO_LONG_RETRY_MARKER
  );
}

function groupRuntimeEntriesByCompactRound(
  entries: readonly RuntimeMessageEntry[],
): RuntimeMessageEntry[][] {
  return groupByAssistantStartedRounds(entries, runtimeEntryRole);
}

function positiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function getPromptTooLongTokenGap(cause: unknown): number | undefined {
  let current: unknown = cause;
  const seen = new WeakSet<object>();

  for (let depth = 0; depth <= 6; depth += 1) {
    if (typeof current === "string") {
      const gap = parsePromptTooLongTokenGap(current);
      if (gap !== undefined) return gap;
      return undefined;
    }
    if (current === undefined || current === null || typeof current !== "object") {
      return undefined;
    }
    if (seen.has(current)) return undefined;
    seen.add(current);

    const record = current as Record<string, unknown>;
    for (const key of ["message", "errorDetails", "details", "body"]) {
      const value = record[key];
      if (typeof value === "string") {
        const gap = parsePromptTooLongTokenGap(value);
        if (gap !== undefined) return gap;
      }
    }
    current = record.cause ?? record.lastError ?? record.error;
  }

  return undefined;
}

function parsePromptTooLongTokenGap(message: string): number | undefined {
  const match = message.match(/(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i);
  if (!match) return undefined;

  const actual = Number(match[1]?.replace(/,/g, ""));
  const limit = Number(match[2]?.replace(/,/g, ""));
  if (!Number.isFinite(actual) || !Number.isFinite(limit) || actual <= limit) {
    return undefined;
  }
  return Math.ceil(actual - limit);
}

function cloneRuntimeEntry(entry: RuntimeMessageEntry): RuntimeMessageEntry {
  return cloneRuntimeMessageEntry(entry);
}

function runtimeEntryRole(entry: RuntimeMessageEntry): "system" | "user" | "assistant" | "tool" {
  if (isRuntimeAttachmentEntry(entry)) return "user";
  return entry.message.role;
}
