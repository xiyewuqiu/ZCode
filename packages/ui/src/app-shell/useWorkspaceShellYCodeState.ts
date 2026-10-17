import { useShallow } from "zustand/react/shallow";
import {
  getWorkspaceDisplayedTaskState,
  selectWorkspaceYCodeState,
  useYCodeSessionStore,
  type WorkspaceYCodeUIState,
} from "@/store/ycodeSessionStore.js";
import { resolveWorkspaceModelConfigSyncScope } from "@/lib/modelConfigSync.js";
import { hasBusyTaskInWorkspaceProvider } from "@/lib/workspaceBusyTaskLock.js";

type WorkspaceShellYCodeState = Pick<
  WorkspaceYCodeUIState,
  | "activeTaskId"
  | "draftFocusVersion"
  | "modelSwitchPending"
  | "modelSwitchStage"
  | "selectedProvider"
  | "selectedSupplierKey"
  | "configOptions"
  | "optimisticTaskListByTaskId"
  | "workspaceInit"
> &
  ReturnType<typeof getWorkspaceDisplayedTaskState>;

export function useWorkspaceShellYCodeState(workspaceAbsPath: string, workspaceIdentity?: string) {
  // App 之前直接订阅整个 workspaceYCodeState，streaming 每个 chunk 都会改 taskMessagesByTaskId。
  // 这会把侧边栏、Header、Git 派生逻辑一起拖进同步重渲染，性能 trace 里那串 long task 就是这样被放大的。
  // 这里把外壳真正依赖的字段收敛成浅比较选择器，避免消息流惊动无关 UI。
  const workspaceShellYCodeState = useYCodeSessionStore(
    useShallow((state): WorkspaceShellYCodeState => {
      const workspaceState = selectWorkspaceYCodeState(state, workspaceAbsPath, workspaceIdentity);
      const displayedTaskState = getWorkspaceDisplayedTaskState(workspaceState);
      return {
        activeTaskId: workspaceState.activeTaskId,
        draftFocusVersion: workspaceState.draftFocusVersion,
        modelSwitchPending: workspaceState.modelSwitchPending,
        modelSwitchStage: workspaceState.modelSwitchStage,
        selectedProvider: workspaceState.selectedProvider,
        selectedSupplierKey: workspaceState.selectedSupplierKey,
        configOptions: workspaceState.configOptions,
        optimisticTaskListByTaskId: workspaceState.optimisticTaskListByTaskId,
        workspaceInit: workspaceState.workspaceInit,
        taskStatus: displayedTaskState.taskStatus,
        taskError: displayedTaskState.taskError,
      };
    }),
  );

  const reloadSessionDisabled = useYCodeSessionStore((state) => {
    const workspaceState = selectWorkspaceYCodeState(state, workspaceAbsPath, workspaceIdentity);
    const actionScope = resolveWorkspaceModelConfigSyncScope(workspaceState);
    return hasBusyTaskInWorkspaceProvider(
      actionScope.provider,
      workspaceState.taskRuntimeByTaskId,
      workspaceState.optimisticTaskListByTaskId,
      workspaceState.taskListCache,
      workspaceState.activeTaskId,
    );
  });

  return { workspaceShellYCodeState, reloadSessionDisabled };
}
