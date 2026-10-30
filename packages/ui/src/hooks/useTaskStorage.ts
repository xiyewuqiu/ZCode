import { useCallback, useEffect, useRef, useState } from "react";
import type { IYCodeTaskService } from "@ycode/services";
import type {
  SessionDatabaseOptimizeResult,
  SessionDatabaseStats,
  SessionStoragePreview,
  SessionPurgeResult,
} from "@ycode/shared";
import { removeTaskFromTaskCaches } from "@/lib/taskListMetaSync.js";

export type TaskStorageTarget = Parameters<IYCodeTaskService["previewTaskStorage"]>[0];
export type TaskStorageService = Pick<
  IYCodeTaskService,
  "previewTaskStorage" | "purgeTaskStorage" | "getTaskDatabaseStats" | "optimizeTaskDatabase"
>;

export function useTaskStorage(target: TaskStorageTarget, service: TaskStorageService) {
  const { taskId, workspacePath, workspaceIdentity } = target;
  const [preview, setPreview] = useState<SessionStoragePreview | null>(null);
  const [result, setResult] = useState<SessionPurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "purge" | null>(null);
  const [databaseStats, setDatabaseStats] = useState<SessionDatabaseStats | null>(null);
  const [optimization, setOptimization] = useState<SessionDatabaseOptimizeResult | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [databaseBusy, setDatabaseBusy] = useState<"load" | "optimize" | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const databaseGeneration = useRef(0);
  const databaseInFlight = useRef(false);

  const refreshDatabase = useCallback(async () => {
    if (databaseInFlight.current) return;
    databaseInFlight.current = true;
    const request = ++databaseGeneration.current;
    setDatabaseBusy("load");
    setDatabaseError(null);
    setOptimization(null);
    try {
      const next = await service.getTaskDatabaseStats({
        taskId,
        workspacePath,
        workspaceIdentity,
      });
      if (request === databaseGeneration.current) setDatabaseStats(next);
    } catch (cause) {
      if (request === databaseGeneration.current)
        setDatabaseError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === databaseGeneration.current) {
        databaseInFlight.current = false;
        setDatabaseBusy(null);
      }
    }
  }, [service, taskId, workspacePath, workspaceIdentity]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    setBusy("preview");
    setPreview(null);
    setError(null);
    setResult(null);
    try {
      const next = await service.previewTaskStorage({ taskId, workspacePath, workspaceIdentity });
      if (request === generation.current) setPreview(next);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setBusy(null);
      }
    }
  }, [service, taskId, workspacePath, workspaceIdentity]);

  useEffect(() => {
    inFlight.current = false;
    databaseInFlight.current = false;
    void refresh();
    void refreshDatabase();
    return () => {
      generation.current++;
      databaseGeneration.current++;
    };
  }, [refresh, refreshDatabase]);

  const purge = async () => {
    if (inFlight.current || !preview || preview.blockers.length || result?.state === "purged")
      return;
    inFlight.current = true;
    const request = ++generation.current;
    setBusy("purge");
    setError(null);
    const selected = { taskId, workspacePath, workspaceIdentity };
    try {
      const next = await service.purgeTaskStorage({
        ...selected,
        expectedRevision: preview.revision,
        confirmPermanent: true,
      });
      // 已提交结果始终清理对应身份缓存；迟到响应不写入新目标的弹窗。
      if (next.state === "purged") {
        removeTaskFromTaskCaches(selected);
        // 删除会释放可复用页，但这里只重新读统计，不自动整理数据库。
        void refreshDatabase();
      }
      if (request === generation.current) setResult(next);
    } catch (cause) {
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPreview(null); // 网络错误/版本冲突后重新预检，再决定是删除还是重试收尾。
      }
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setBusy(null);
      }
    }
  };

  const optimizeDatabase = async () => {
    if (databaseInFlight.current || busy === "purge" || !databaseStats) return;
    databaseInFlight.current = true;
    const request = ++databaseGeneration.current;
    setDatabaseBusy("optimize");
    setDatabaseError(null);
    try {
      const next = await service.optimizeTaskDatabase({
        taskId,
        workspacePath,
        workspaceIdentity,
        confirm: true,
      });
      if (request === databaseGeneration.current) {
        setOptimization(next);
        // refused 时 after === before，仍然用权威快照覆盖本地旧统计。
        setDatabaseStats(next.after);
      }
    } catch (cause) {
      if (request === databaseGeneration.current) {
        // 失败后丢弃可能过时的统计，用户需重新读取再确认。
        setDatabaseStats(null);
        setDatabaseError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (request === databaseGeneration.current) {
        databaseInFlight.current = false;
        setDatabaseBusy(null);
      }
    }
  };

  return {
    preview,
    result,
    error,
    busy,
    refresh,
    purge,
    databaseStats,
    optimization,
    databaseError,
    databaseBusy,
    refreshDatabase,
    optimizeDatabase,
  };
}
