import type { YCodeTaskMeta } from "@ycode/shared";

type Reply = { meta: YCodeTaskMeta };
export const requests: { resolve: (value: Reply) => void; reject: (reason: Error) => void }[] = [];
export function taskMeta(taskId: string, title: string): YCodeTaskMeta {
  return {
    taskId,
    title,
    traceId: taskId,
    workspacePath: "/synthetic",
    createdAt: 1,
    updatedAt: 1,
    mode: "build",
  };
}
const service = {
  readSession: () => new Promise<Reply>((resolve, reject) => requests.push({ resolve, reject })),
};
export function useYCodeSessionService() {
  return service;
}
// 本场景隔离异步标题 hook；会话协议到 meta 的转换由既有投影测试负责。
export function ycodeSessionSnapshotToTaskMeta(snapshot: Reply) {
  return snapshot.meta;
}
