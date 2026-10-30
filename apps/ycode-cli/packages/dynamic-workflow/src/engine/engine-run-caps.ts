/**
 * 就地改本 run 并发上界的实现体（从 engine.ts 拆出，理由同其余兄弟模块：engine.ts 已抵
 * oxlint max-lines 400 行门）。命令的存活判定、no-op 语义与落库写成自由函数，经
 * {@link EngineState} 的窄接缝读写引擎私有状态；公开面仍是 `WorkflowEngine.setMaxConcurrency`。
 */

import type { EngineState } from "./engine-state.js";

/**
 * 一次只带 `max_concurrency` 的修订作用在活着的 run 上：同一个 runId、不铸后继、不 supersede、
 * 在飞 ask 一个不丢。返回**这次是否真的改了**；两条 no-op（已结算、值没变）什么都不写、不发事件。
 *
 * 改成时三件事在同一个同步步骤里发生：换 caps（调度器现读）、写 `dwf_run.caps_max_concurrency`
 * （resume 沿用行里的值）、记一条 `run-caps-changed`。抬高时多一次 `pumpAll()`——上界是派发前
 * 现读的，没有别的事件会触发重扫。
 */
export function setRunConcurrency(state: EngineState, maxConcurrency: number): boolean {
  if (state.isRunSettled() || !Number.isFinite(maxConcurrency)) return false;
  const previous = state.caps();
  const next = Math.max(1, Math.floor(maxConcurrency));
  if (next === previous.maxConcurrency) return false;
  const caps = { maxConcurrency: next };
  state.setCaps(caps);
  state.journal.updateRunCaps(state.runId, caps);
  state.record({ type: "run-caps-changed", runId: state.runId, caps, previous });
  if (next > previous.maxConcurrency) state.pumpAll();
  return true;
}
