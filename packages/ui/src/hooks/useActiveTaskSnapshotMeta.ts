import { useEffect, useMemo, useState } from "react";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { useZCodeSessionService } from "@/hooks/useZCodeSessionService.js";
import { zcodeSessionSnapshotToTaskMeta } from "@/lib/zcodeSessionProjection.js";
import { logger } from "@/logger.js";

/**
 * 为当前激活 task 提供一层 snapshot meta 兜底。
 *
 * archived task 不在普通 taskListCache / pinnedTasks 数据源里，
 * 直接打开时 App 只靠列表元数据会拿不到标题、provider、traceId 等字段。
 * 这里在列表里找不到当前任务时，额外读取一次 snapshot.meta 作为展示兜底，
 * 只服务当前激活任务，不把 archived task 混回普通列表。
 */
export function useActiveTaskSnapshotMeta(
  workspacePath: string,
  taskId: string | null,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string,
  taskMetaFromLists?: ZCodeTaskMeta | null,
) {
  const zcodeSessionService = useZCodeSessionService(
    workspacePath,
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const needsSnapshot = Boolean(taskId && !taskMetaFromLists);
  const request = useMemo(
    () => ({
      workspaceKey,
      workspacePath,
      taskId,
      preferredRemoteSessionId,
      zcodeSessionService,
      needsSnapshot,
    }),
    [
      workspaceKey,
      workspacePath,
      taskId,
      preferredRemoteSessionId,
      zcodeSessionService,
      needsSnapshot,
    ],
  );
  const [result, setResult] = useState<{
    request: typeof request;
    meta: ZCodeTaskMeta | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!request.needsSnapshot || !request.taskId) return;

    void request.zcodeSessionService
      // active header 只需要 session meta/标题兜底，走 ZCode Protocol 的轻量读取，
      // 避免继续经 legacy snapshot 把大任务消息整包拉回 UI。
      .readSession({
        workspacePath: request.workspacePath,
        workspaceIdentity,
        sessionId: request.taskId,
        messageLimit: 1,
      })
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setResult({ request, meta: zcodeSessionSnapshotToTaskMeta(snapshot) });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        logger.warn("[active-task-meta] 读取任务标题失败", error);
        setResult({ request, meta: null });
      });

    return () => {
      cancelled = true;
    };
  }, [request, workspaceIdentity]);

  // effect 清理发生在 commit 后，无法阻止首帧闪现上一任务的标题。
  // 渲染时校验请求身份，同时隔离同 taskId 的不同 workspace / 连接。
  return request.needsSnapshot && result?.request === request ? result.meta : null;
}
