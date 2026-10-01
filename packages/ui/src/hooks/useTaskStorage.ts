import { useCallback, useEffect, useRef, useState } from "react";
import type { IZCodeTaskService } from "@zcode/services";
import type { SessionStoragePreview, SessionPurgeResult } from "@zcode/shared";
import { removeTaskFromTaskCaches } from "@/lib/taskListMetaSync.js";

export type TaskStorageTarget = Parameters<IZCodeTaskService["previewTaskStorage"]>[0];
export type TaskStorageService = Pick<IZCodeTaskService, "previewTaskStorage" | "purgeTaskStorage">;

export function useTaskStorage(target: TaskStorageTarget, service: TaskStorageService) {
  const { taskId, workspacePath, workspaceIdentity } = target;
  const [preview, setPreview] = useState<SessionStoragePreview | null>(null);
  const [result, setResult] = useState<SessionPurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "purge" | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

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
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);

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
      if (next.state === "purged") removeTaskFromTaskCaches(selected);
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
  return { preview, result, error, busy, refresh, purge };
}
