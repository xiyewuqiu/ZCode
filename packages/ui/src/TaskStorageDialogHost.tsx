import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { TaskStorageDialog } from "@/TaskStorageDialog.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useTaskStorageDialogStore } from "@/store/taskStorageDialogStore.js";

/**
 * 「存储与永久删除」弹窗的唯一挂载点（app 级）。
 *
 * 任务右键菜单只写入目标会话，这里按目标 workspace 解析 Host services 后渲染弹窗：
 * 本地目标走 base host，远端目标走对应 remote session，未就绪时沿用统一的断连语义。
 * 每次切换目标都用 key 重挂载，避免上一份预检结果残留到新会话。
 */
export function TaskStorageDialogHost() {
  const request = useTaskStorageDialogStore((state) => state.request);
  const close = useTaskStorageDialogStore((state) => state.close);
  // 无请求时按 null 目标解析，保持 hooks 顺序稳定；此时不会发起任何预检请求。
  const services = useWorkspaceServices(
    request?.workspacePath ?? null,
    request?.remoteSessionId ?? null,
    request?.workspaceIdentity ?? null,
  );

  if (!request) {
    return null;
  }

  return (
    <TaskStorageDialog
      key={`${buildTaskWorkspaceKey(request.workspacePath, request.workspaceIdentity)}:${request.taskId}`}
      target={{
        taskId: request.taskId,
        workspacePath: request.workspacePath,
        ...(request.workspaceIdentity ? { workspaceIdentity: request.workspaceIdentity } : {}),
      }}
      title={request.title}
      service={services.zcodeTaskService}
      onClose={close}
    />
  );
}
