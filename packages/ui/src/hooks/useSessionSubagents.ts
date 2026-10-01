import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useServices } from "@/hooks/useServices.js";
import { SessionSubagentsQuery } from "@/hooks/sessionSubagentsQuery.js";
import { logger } from "@/logger.js";

export function useSessionSubagents(options: {
  enabled?: boolean;
  refreshKey?: string | number | null;
  remoteSessionId?: string;
  sessionId?: string | null;
  workspaceIdentity?: string;
  workspacePath: string;
}) {
  const { zcodeAgentService } = useServices();
  const { workspacePath, remoteSessionId, sessionId } = options;
  const workspaceIdentity = options.workspaceIdentity?.trim() || undefined;
  const enabled = options.enabled !== false && Boolean(sessionId);
  // 一个 scope 一个查询所有者，切换的首帧就读新空视图；旧 promise 不共享锁或 state。
  const query = useMemo(
    () =>
      new SessionSubagentsQuery(
        async (endedLimit, endedCursor) => {
          if (!sessionId) throw new Error("session_id_missing");
          if (typeof zcodeAgentService?.listSessionSubagents !== "function") {
            throw new Error("subagent_directory_unavailable");
          }
          return zcodeAgentService.listSessionSubagents({
            workspacePath,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
            ...(remoteSessionId ? { remoteSessionId } : {}),
            sessionId,
            endedLimit,
            ...(endedCursor ? { endedCursor } : {}),
          });
        },
        (error) =>
          logger.warn("[subagent-directory] 读取子智能体目录失败", {
            error,
            sessionId,
            workspaceKey: workspaceIdentity || workspacePath,
          }),
      ),
    [remoteSessionId, sessionId, workspaceIdentity, workspacePath, zcodeAgentService],
  );
  const state = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot);
  useEffect(() => {
    if (enabled) query.activate();
    return () => query.deactivate();
  }, [enabled, query]);
  useEffect(() => {
    if (enabled) void query.refresh();
  }, [enabled, options.refreshKey, query]);
  return { ...state, loadMore: query.loadMore, refresh: query.refresh };
}
