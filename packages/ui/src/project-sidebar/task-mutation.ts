import { parseRemoteWorkspaceIdentity } from "@ycode/shared";
import type {
  ProjectTaskRef,
  IYCodeTaskService,
  IWindowControllerService,
  WindowHostControllerMutation,
  WindowHostTaskAddress,
} from "@/project-sidebar/contract.js";
export type ProjectTaskMutation =
  | Exclude<WindowHostControllerMutation, { kind: "open" | "resume" }>
  | { kind: "rename"; title: string };
interface ProjectTaskPorts {
  service: IYCodeTaskService;
  controller?: IWindowControllerService;
}
function taskAddress(task: ProjectTaskRef, remoteSessionId?: string | null): WindowHostTaskAddress {
  const identity = parseRemoteWorkspaceIdentity(task.workspaceIdentity ?? "");
  return {
    workspacePath: task.workspacePath,
    workspaceIdentity: task.workspaceIdentity,
    taskId: task.taskId,
    ...(remoteSessionId ? { remoteSessionId } : {}),
    ...(identity?.kind === "server" ? { sourceServerId: identity.sourceServerId } : {}),
  };
}
/** 已查看事件读取唯一 owner 的 marker；不借用 UI 行缓存，也不跨 Source 使用本机服务。 */
export function readProjectTaskMeta(
  ports: ProjectTaskPorts,
  task: ProjectTaskRef,
  remoteSessionId?: string,
) {
  // 当前 Controller 只暴露列表/整理命令，任务 meta 仍由任务服务唯一提供。
  void remoteSessionId;
  return ports.service.getTaskMeta({
    taskId: task.taskId,
    workspacePath: task.workspacePath,
    ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
  });
}
/** 两个列表入口共用完整地址与命令路由；组织态和 CLI 事实仍各自只由原 owner 写入。 */
export async function mutateProjectTask(
  ports: ProjectTaskPorts,
  task: ProjectTaskRef,
  mutation: ProjectTaskMutation,
  remoteSessionId?: string | null,
) {
  const target = {
    workspacePath: task.workspacePath,
    workspaceIdentity: task.workspaceIdentity,
    taskId: task.taskId,
  };
  // 重命名不在 Controller mutation 合同内；始终走任务服务的 owner 路径。
  if (mutation.kind === "rename")
    return ports.service.renameTask({ ...target, title: mutation.title });
  if (ports.controller)
    return ports.controller.mutateTask({
      address: taskAddress(task, remoteSessionId),
      mutation: mutation as Exclude<ProjectTaskMutation, { kind: "rename" }>,
    });
  switch (mutation.kind) {
    case "archive":
      return mutation.archived
        ? ports.service.archiveTask(target)
        : ports.service.unarchiveTask(target);
    case "delete":
      await ports.service.deleteTask(target);
      return null;
    case "pin":
      return ports.service.setTaskPinned({ ...target, pinned: mutation.pinned });
    case "mark-read":
      return ports.service.setTaskUnread({
        ...target,
        unread: false,
        expectedUnreadAt: mutation.expectedUnreadAt,
      });
    case "mark-unread":
      return ports.service.setTaskUnread({ ...target, unread: true });
  }
}
