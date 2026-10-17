import type { WorkspacePurpose, YCodeTaskMeta } from "@ycode/shared";

export type YCodeTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type YCodeTaskListSortBy = "created" | "updated";

export interface YCodeTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface YCodeTaskListQuery {
  kind: YCodeTaskListKind;
  workspaceScopes: YCodeTaskListWorkspaceScope[];
  sortBy: YCodeTaskListSortBy;
  search?: string;
  limit?: number;
}

export type YCodeTaskListItem = YCodeTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface YCodeTaskListResult {
  items: YCodeTaskListItem[];
  total: number;
  hasMore: boolean;
}

export type YCodeTaskGroupColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple";

export interface YCodeTaskGroup {
  id: string;
  title: string;
  color: YCodeTaskGroupColor;
  createdAt: number;
  updatedAt: number;
}

export interface YCodeGroupedTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export type YCodeGroupedTaskViewTopLevelNodeRef =
  | { type: "group"; groupId: string }
  | { type: "task"; task: YCodeGroupedTaskRef };

export type YCodeGroupedTaskViewNode =
  | {
      type: "group";
      group: YCodeTaskGroup;
      tasks: YCodeTaskListItem[];
      sortOrder?: number;
    }
  | {
      type: "task";
      task: YCodeTaskListItem;
      sortOrder?: number;
    };

export interface YCodeGroupedTaskView {
  nodes: YCodeGroupedTaskViewNode[];
}

export interface YCodeGroupedTaskViewQuery {
  workspaceScopes: YCodeTaskListWorkspaceScope[];
  includeAllWorkspaces?: boolean;
}

// ── grouped 原始结构（不 join tasks 表）──
// grouped 视图的任务数据源迁到 sessions-index 后，服务端只提供分组结构
// （task_groups / task_group_members / task_group_view_node_orders），
// 由客户端与 sessions-index 会话做 join。

/** 组成员引用（不含任务 meta；task 内容由 sessions-index 提供）。 */
export interface YCodeGroupedTaskViewStructureMember {
  groupId: string;
  /** 服务端口径 workspaceKey（resolveWorkspaceKey：identity ?? path），join 匹配键。 */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  /** null = 尚未落 sort_order（新加入组）；客户端按 addedAt 降序补内存序。 */
  sortOrder: number | null;
  addedAt: number;
}

/** 顶层节点排序（task_group_view_node_orders，node_key 已解析为结构化引用）。 */
export type YCodeGroupedTaskViewStructureTopOrder =
  | { type: "group"; groupId: string; sortOrder: number }
  | { type: "task"; workspaceKey: string; taskId: string; sortOrder: number };

export interface YCodeGroupedTaskViewStructure {
  /** 已按 workspaceScopes 可见性过滤的 group（bootstrap workspace group 只在其 workspace 可见）。 */
  groups: YCodeTaskGroup[];
  /** 全量组成员（含不可见 group 的成员——顶层排除规则需要全量判断）。 */
  members: YCodeGroupedTaskViewStructureMember[];
  topLevelOrders: YCodeGroupedTaskViewStructureTopOrder[];
}

export interface YCodeGroupedTaskViewOrderInput {
  workspaceScopes: YCodeTaskListWorkspaceScope[];
  topLevelNodes: YCodeGroupedTaskViewTopLevelNodeRef[];
  groups: Array<{
    groupId: string;
    taskRefs: YCodeGroupedTaskRef[];
  }>;
}

export interface YCodeWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
