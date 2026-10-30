// ============================================================
// AmendWorkflow：只改并发即就地生效
// ============================================================
// 一次「只带 `run_id` 与 `max_concurrency`、前驱还活着」的调用**不是修订**：它就地挪一个数，
// run 保住自己的 id、子代理、转录与在飞的 ask，什么都不停、什么都不替代、一个窗都不弹。
// 从 amend-workflow.ts 拆出来的理由与 amend-workflow-source.ts 同一条（400 行纪律 + 各管一段）：
// 那边是修订的 handler，这里是这条路由的全部——判定、端口调用、模型面文案，以及结算竞态里
// 落回一次真正修订时要重新读的那些事实。

import {
  AmendWorkflowInputSchema,
  type AmendWorkflowInput,
  type AmendWorkflowPredecessor,
  type CreateWorkflowOutput,
  type DynamicWorkflowRunPort,
  type DynamicWorkflowRunRetuneResult,
  isAmendWorkflowOwnedPredecessor,
} from "@ycode/contracts";
import type { ToolExecutionContext, ToolHandlerFailure } from "../types.js";
import {
  AMEND_WORKFLOW_ERROR_CODE,
  describePredecessor,
  resolveAmendMaxConcurrency,
  resolveAmendScript,
} from "./amend-workflow-source.js";
import { normalizeWorkflowMaxConcurrency } from "./create-workflow-source.js";
import { workflowRunNotFoundFailure } from "./workflow-run-introspection.js";

/**
 * 「除并发之外什么都没变」：判的是**入参的形状**，不是新字段。`script`、`path`、
 * `subagent_model` 与 `name` 无论带的是什么，都把这次调用送去修订那条路——它们各自都可能改变
 * 将要跑的东西，而这条路的前提是「跑的还是同一段脚本、同一批子代理」。
 *
 * 归一化之后的入参同样适用：修订那条路恒会落定一份脚本，所以「没有脚本、却有并发」只可能是
 * 就地调并发。
 */
export function isConcurrencyOnlyAmend(model: AmendWorkflowInput): boolean {
  return (
    model.max_concurrency !== undefined &&
    model.script === undefined &&
    model.path === undefined &&
    model.subagent_model === undefined &&
    model.name === undefined
  );
}

/**
 * resolveInput 里的路由判定：命中即返回**不带脚本**的归一化入参——此后 prepareApproval 放行、
 * handler 调 `retuneConcurrency`；不命中回 `undefined`，调用方照常走修订。
 *
 * 三个前提缺一不可：入参形状只改并发、前驱还活着（`pending` 与 `running` 都试，活不活由端口
 * 说了算）、端口接得住这条控制面。端口不带 `retuneConcurrency`（老宿主）时整条路不存在，调用
 * 原样落成今天的修订。
 */
export function resolveConcurrencyRetuneRoute(options: {
  model: AmendWorkflowInput;
  port: DynamicWorkflowRunPort;
  predecessor: AmendWorkflowPredecessor;
  /** 前驱快照上的上界；缺席即它跑在默认并发上。 */
  inherited: number | undefined;
}): { result: true; input: AmendWorkflowInput } | ToolHandlerFailure | undefined {
  const { model, port, predecessor } = options;
  if (!isConcurrencyOnlyAmend(model)) return undefined;
  if (predecessor.status !== "pending" && predecessor.status !== "running") return undefined;
  if (typeof port.retuneConcurrency !== "function") return undefined;

  // 三态在这里**不**归一：`null` 要原样递到端口（清空 = 回到默认并发）。
  const requested = model.max_concurrency ?? null;
  const defaultConcurrency = port.defaultConcurrency?.();
  const unchanged = refuseUnchangedBound(
    model.run_id,
    requested,
    options.inherited,
    defaultConcurrency,
  );
  if (unchanged !== undefined) return unchanged;
  return {
    result: true,
    input: { run_id: model.run_id, max_concurrency: requested, predecessor },
  };
}

/**
 * 同值就在这里收口——早于 hook、早于确认窗，端口一次都不碰。默认并发读不到（老宿主不带
 * `defaultConcurrency`）时 `null` 无从折算成数，这道网就让开，由端口自己去答 `unchanged`。
 */
function refuseUnchangedBound(
  runId: string,
  requested: number | null,
  inherited: number | undefined,
  defaultConcurrency: number | undefined,
): ToolHandlerFailure | undefined {
  const current = inherited ?? defaultConcurrency;
  const next = requested === null ? defaultConcurrency : normalizeWorkflowMaxConcurrency(requested);
  if (current === undefined || next === undefined || current !== next) return undefined;
  return retuneUnchangedFailure(runId, current, defaultConcurrency);
}

/**
 * handler 侧的本体：调端口、把三种答复翻成模型面的结果。
 *
 * 回 `undefined` 只有一个含义——端口答了 `not_live`（或宿主根本没有这条控制面），这次调用
 * 此刻描述的是一次修订，做不做由 {@link resolveRetuneFallbackAmend} 定夺。
 */
export async function runConcurrencyRetune(
  parsed: AmendWorkflowInput,
  context: ToolExecutionContext,
): Promise<CreateWorkflowOutput | ToolHandlerFailure | undefined> {
  const port = context.dynamicWorkflowRunPort;
  if (port === undefined || typeof port.retuneConcurrency !== "function") return undefined;
  const answer = await port.retuneConcurrency({
    runId: parsed.run_id,
    // 路由判定已保证这里是「一个数或 null」；`?? null` 只是把绕过归一化的缺席读作「回默认」。
    maxConcurrency: parsed.max_concurrency ?? null,
  });
  if (answer.ok) {
    return {
      diagnostics: [],
      ok: true,
      // 不进后台追踪器：run 本来就在里面，而且它自始至终是同一个 run，没有 `backgrounded`
      // 契约可言，也没有编译产物可画。`retuned` 是**显式**的判别块：消费方不该按「ok 且没有
      // status」去猜，那个形状还有别的来路。
      response: retuneResponse(parsed.run_id, answer),
      retuned: {
        runId: parsed.run_id,
        maxConcurrency: answer.maxConcurrency,
        previous: answer.previous,
        defaultConcurrency: answer.defaultConcurrency,
      },
    } satisfies CreateWorkflowOutput;
  }
  if (answer.reason === "unchanged") {
    return retuneUnchangedFailure(parsed.run_id, answer.current, port.defaultConcurrency?.());
  }
  return undefined;
}

/**
 * 结算竞态：同一份入参此刻描述的是一次修订。能不能做只看一件事——**那次修订本来要不要开窗**。
 *
 * 本会话自己的、不是用户亲手停下的 run：owner 规则本来也不开窗，于是照常修订，脚本与编译推迟
 * 到此刻才发生（缺脚本、编不过都按修订自己的拒绝回报）。别人的 run，或用户停过的 run：拒掉。
 * 这条路一个窗都没弹过，不能把「什么都没批」撑成「另起一次 run」。
 */
export async function resolveRetuneFallbackAmend(
  parsed: AmendWorkflowInput,
  context: ToolExecutionContext,
): Promise<{ result: true; input: AmendWorkflowInput } | ToolHandlerFailure> {
  const port = context.dynamicWorkflowRunPort;
  // 事实要重读一遍：run 刚刚在存活判定与端口调用之间结算，入参里的那一份说的还是「在跑」。
  const snapshot = port === undefined ? undefined : await port.getTask(parsed.run_id);
  if (snapshot === undefined) return predecessorNotFoundFailure(parsed.run_id);
  const predecessor = describePredecessor(snapshot, context.sessionId);
  if (!isAmendWorkflowOwnedPredecessor(predecessor)) {
    // 还没结算（pending、引擎没建起来）与已结算是两句不同的话，但下一步相同：再调一次。
    return predecessor.status === "pending" || predecessor.status === "running"
      ? notRetunableFailure(parsed.run_id)
      : runSettledFailure(parsed.run_id);
  }
  const script = await resolveAmendScript({
    model: parsed,
    cwd: context.workingDirectory,
    port,
    predecessorScriptPath: snapshot.scriptPath,
  });
  if (!script.result) return script;
  return {
    result: true,
    input: AmendWorkflowInputSchema.parse({
      run_id: parsed.run_id,
      ...script.fields,
      // 落回修订就回到「一个数或没有」：这次调用显式给了值，没有可沿用的。
      ...resolveAmendMaxConcurrency(parsed.max_concurrency, undefined),
      predecessor: {
        ...predecessor,
        ...(script.inherited ? { script_inherited: true as const } : {}),
      },
    }) as AmendWorkflowInput,
  };
}


/** 前驱不存在：与 resolveInput 那一条同源同文案（一个 run id 打错了只该有一种说法）。 */
function predecessorNotFoundFailure(runId: string): ToolHandlerFailure {
  const base = workflowRunNotFoundFailure(runId);
  return {
    ...base,
    message: `${base.message} Nothing was stopped or created: \`run_id\` pointed at a run that does not exist — pass an existing run's ID (see ListWorkflowRuns), or start a fresh run with CreateWorkflow.`,
  };
}

/** 现在生效的上界读成一句话；等于默认并发即「没有自己的界」。 */
function describeBoundInForce(
  bound: number | undefined,
  defaultConcurrency: number | undefined,
): string {
  if (bound === undefined || bound === defaultConcurrency) {
    return defaultConcurrency === undefined
      ? "already runs at the default parallelism"
      : `already runs at the default parallelism (at most ${defaultConcurrency} subagents at once)`;
  }
  return bound === 1
    ? "already runs at most 1 subagent at once"
    : `already runs at most ${bound} subagents at once`;
}

/** 同值：什么都没写、什么都没停，拒绝里点名此刻生效的那个界。 */
export function retuneUnchangedFailure(
  runId: string,
  current: number | undefined,
  defaultConcurrency: number | undefined,
): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.RETUNE_UNCHANGED,
    message: `workflow_retune_unchanged: run ${runId} ${describeBoundInForce(current, defaultConcurrency)}, so there is nothing to change. Nothing was stopped, created or changed — pass a different \`max_concurrency\`, or a revised script if you meant to amend the run.`,
  };
}

/** 本会话的 run 已经结算：再调一次，那一次从头走修订，连同它要的那个确认窗。 */
export function runSettledFailure(runId: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.RUN_SETTLED,
    message: `workflow_run_settled: run ${runId} settled before the new parallelism limit could take hold, so there is nothing running to retune. Nothing was stopped, created or changed — call AmendWorkflow again if you want a new run of it under that limit.`,
  };
}

/** 别人的 run，本 agent 从没握住过（`pending`，引擎还没建）：同样的下一步。 */
export function notRetunableFailure(runId: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.NOT_RETUNABLE,
    message: `workflow_run_not_retunable: run ${runId} is not being executed by this agent, so its parallelism cannot be changed in place. Nothing was stopped, created or changed — call AmendWorkflow again if you want a new run of it under that limit.`,
  };
}

/**
 * 模型面的回话：**点名一个 run、没有后继**——模型正是据此分辨自己这次调用走的是哪条路，不必被
 * 告知路由本身。上界等于默认并发时注明「（默认）」，与 `CreateWorkflow` 划的是同一条界。
 */
function retuneResponse(
  runId: string,
  answer: Extract<DynamicWorkflowRunRetuneResult, { ok: true }>,
): string {
  const count =
    answer.maxConcurrency === 1
      ? "at most 1 subagent runs at once"
      : `at most ${answer.maxConcurrency} subagents run at once`;
  const bound =
    answer.maxConcurrency === answer.defaultConcurrency ? `${count} (the default)` : count;
  return `Applied to the running run ${runId}; ${bound}. Run ${runId} keeps running under it: nothing was stopped and no new run was started.`;
}
