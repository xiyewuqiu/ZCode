import type { WorkflowRunState } from "@ycode/shared/ycode-protocol-v4";
import { phaseNameMatches } from "@/components/workflow-graph/phase-name.js";
import type {
  StepRunStatus,
  WorkflowCausalityGraphData,
} from "@/components/workflow-graph/types.js";

/**
 * 一站的观察结果（从 timeline-model.ts 拆出，max-lines 门）：成员节点的到访、轮次、结算数与进入记录。
 * 纯函数，无 React、无 DOM。
 */
export interface ObservedPhase {
  visited: boolean;
  rounds: number;
  settled: number;
  observed: number;
  /** 控制流进入过这一站（`run.phases` 里有它的进入记录）。 */
  entered: boolean;
}

type WorkflowRunPhaseEntry = NonNullable<WorkflowRunState["phases"]>[number];

/**
 * 一站的进入记录：按名字关联（`phaseNameMatches`，规则抽到 phase-name.ts，与实例绑定共用一条）。同一个 128 字
 * 前缀下可能有两条记录，精确的那条优先。
 */
export function phaseEntryFor(
  run: WorkflowRunState | undefined,
  name: string | undefined,
): WorkflowRunPhaseEntry | undefined {
  const entries = run?.phases;
  if (entries === undefined || name === undefined) return undefined;
  return (
    entries.find((entry) => entry.name === name) ??
    entries.find((entry) => phaseNameMatches(name, entry.name))
  );
}

/** `currentPhase` 与一站的关联，与 {@link phaseEntryFor} 同一条名字规则。 */
export function isCurrentPhase(
  run: WorkflowRunState | undefined,
  name: string | undefined,
): boolean {
  return phaseNameMatches(name, run?.currentPhase);
}

/**
 * 站的灯。成员节点先说话——running / failed 是硬事实；
 * 之后才轮到控制流：这一站是当前阶段且 run 还在跑，就是 running（第一个 ask 派发之前、最后
 * 一个 ask 结算之后下一个标记到来之前，控制流都在这一站）；一个节点都没观察到的站（零成员，
 * 或整站被跳过）只能靠进入记录点灯。`nodeStatus` 是折叠的结果，缺席（undefined）就是「没有
 * 节点」——折叠不会为控制流没走的站点造一个 pending。
 */
export function stationStatus(
  run: WorkflowRunState | undefined,
  nodeStatus: StepRunStatus | undefined,
  current: boolean,
  entered: boolean,
): StepRunStatus | undefined {
  if (run === undefined) return undefined;
  if (nodeStatus === "running" || nodeStatus === "failed") return nodeStatus;
  const live = run.status === "running" || run.status === "pending";
  if (current && live) return "running";
  // 当前阶段随 run 的终态收场：失败发生在这一站（不管它有没有节点）；cancelled 与节点的画法
  // 一致，同样是 failed。
  if (current) return run.status === "completed" ? "done" : "failed";
  if (nodeStatus !== undefined) return nodeStatus;
  return entered ? "done" : "pending";
}

/**
 * 一站观察到的节点：站点相同还不够——同一个站点被 k 个阶段再入时 k 张卡共享站点 id，节点还要
 * 按实例的出生戳落到这一站，否则 visited / rounds /
 * fraction 一起虚高 k 倍。
 */
export function observePhase(
  run: WorkflowRunState | undefined,
  siteIds: ReadonlySet<string>,
  entry: WorkflowRunPhaseEntry | undefined,
  belongs: (node: WorkflowRunState["nodes"][number]) => boolean,
): ObservedPhase {
  const result: ObservedPhase = {
    entered: false,
    observed: 0,
    rounds: 0,
    settled: 0,
    visited: false,
  };
  if (run === undefined) return result;
  for (const node of run.nodes) {
    if (!siteIds.has(node.siteId) || !belongs(node)) continue;
    result.visited = true;
    result.observed += 1;
    if (node.ordinal > result.rounds) result.rounds = node.ordinal;
    if (node.phase === "settled") result.settled += 1;
  }
  // 进入记录：到过 = 有节点落在这站 ∨ 控制流进入过；轮次取两者之大（单阶段循环体的第二轮
  // 由节点数出来，零成员站的第二轮只有进入记录知道）。
  if (entry !== undefined) {
    result.entered = true;
    result.visited = true;
    if (entry.rounds > result.rounds) result.rounds = entry.rounds;
  }
  return result;
}

/**
 * 站点集合：成员 step 的 `source ?? id`——may-set 拷贝报的是站点 id，与 run-status.ts 的
 * 关联键同源；漏掉 `source` 会让拷贝站永远「未到」。
 */
export function siteIdsOf(
  steps: readonly WorkflowCausalityGraphData["steps"][number][],
): Set<string> {
  return new Set(steps.map((step) => step.source ?? step.id));
}
