import type { YCodeBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeYCodeBackgroundTaskControlItems(
  current: readonly YCodeBackgroundTaskControlItem[],
  updates: readonly YCodeBackgroundTaskControlItem[],
): YCodeBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
