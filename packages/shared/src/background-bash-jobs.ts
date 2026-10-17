import {
  collectVisibleYCodeBackgroundTaskControlItems,
  getYCodeBackgroundTaskControlItemElapsedMs,
  isActiveYCodeBackgroundTaskControlItem,
  parseYCodeBackgroundTaskControlItems,
  type YCodeBackgroundTaskControlItem,
  type YCodeBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type YCodeBackgroundBashJobStatus = YCodeBackgroundTaskControlStatus;
export type YCodeBackgroundBashJob = YCodeBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseYCodeBackgroundBashJobs(value: unknown): YCodeBackgroundBashJob[] {
  return parseYCodeBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveYCodeBackgroundBashJob(job: YCodeBackgroundBashJob): boolean {
  return isActiveYCodeBackgroundTaskControlItem(job);
}

export function getYCodeBackgroundBashJobElapsedMs(
  job: YCodeBackgroundBashJob,
  now = Date.now(),
): number {
  return getYCodeBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleYCodeBackgroundBashJobs(
  jobs: readonly YCodeBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<YCodeBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleYCodeBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    YCodeBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: YCodeBackgroundTaskControlItem): job is YCodeBackgroundBashJob {
  return job.taskKind === "bash";
}
