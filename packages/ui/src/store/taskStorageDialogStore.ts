import { create } from "zustand";

/**
 * 「存储与永久删除」弹窗的目标会话。
 *
 * title 只用于弹窗标题展示；workspaceIdentity / remoteSessionId 决定 Host 路由，
 * 与任务行的既有归属字段保持一致。
 */
export interface TaskStorageDialogRequest {
  taskId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  title: string;
}

interface TaskStorageDialogStoreState {
  request: TaskStorageDialogRequest | null;
  /** 打开或替换当前目标；同一时刻只允许一份预检弹窗。 */
  open: (request: TaskStorageDialogRequest) => void;
  close: () => void;
}

/**
 * 入口桥：任务右键菜单挂在任务列表、置顶区、时间线等多个列表树里，
 * 而永久删除必须复用归档列表那套预检弹窗（占用统计、阻塞原因、CAS 确认）。
 * 逐处挂载会得到多份弹窗实例，因此这里只传递目标，由 app 级 host 挂载唯一实例。
 */
export const useTaskStorageDialogStore = create<TaskStorageDialogStoreState>((set) => ({
  request: null,
  open: (request) => {
    set({ request });
  },
  close: () => {
    set({ request: null });
  },
}));
