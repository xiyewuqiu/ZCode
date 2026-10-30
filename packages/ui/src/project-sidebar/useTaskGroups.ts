import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  YCodeGroupedTaskRef,
  YCodeGroupedTaskViewTopLevelNodeRef,
  YCodeTaskGroup,
  YCodeTaskListWorkspaceScope,
} from "@ycode/services";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import type {
  GroupNode,
  GroupTaskRef,
  MoveGroupNode,
  ProjectTree,
  TaskGroup,
  TaskGroupColor,
  TaskGroupStructure,
} from "@/project-sidebar/contract.js";
import { buildRemoteHostWorkspaceIdentity } from "@/project-sidebar/contract.js";
import { logger } from "@/logger.js";

const EMPTY: TaskGroupStructure = { groups: [], members: [], order: [] };

function groupTaskKey(task: Pick<GroupTaskRef, "workspacePath" | "workspaceIdentity" | "taskId">) {
  return JSON.stringify([task.workspaceIdentity?.trim() || task.workspacePath, task.taskId]);
}

function nodeKey(node: GroupNode) {
  return node.type === "group" ? node.groupId : groupTaskKey(node.task);
}

function toTaskRef(ref: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}): YCodeGroupedTaskRef {
  return {
    workspacePath: ref.workspacePath,
    ...(ref.workspaceIdentity ? { workspaceIdentity: ref.workspaceIdentity } : {}),
    taskId: ref.taskId,
  };
}

function toTopLevelNode(node: GroupNode): YCodeGroupedTaskViewTopLevelNodeRef {
  return node.type === "group"
    ? { type: "group", groupId: node.groupId }
    : { type: "task", task: toTaskRef(node.task) };
}

/**
 * 当前 Host 只提供 IYCodeTaskService 的 grouped 结构/排序端口；这里适配成侧栏需要的
 * read/save/move/ungroup 视图。所有写入仍由 tasks-index 事务唯一落库，UI 不保留第二份结构。
 */
export function useTaskGroups(tree: ProjectTree) {
  const services = useBaseWorkspaceServices();
  const service = services.ycodeTaskService;
  const [structure, setStructure] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const serial = useRef(0);
  // scope 决定 grouped 结构可见性；项目 roots 与任务地址共同构成服务端可接受的 scope。
  const scopes = useMemo<YCodeTaskListWorkspaceScope[]>(() => {
    const byKey = new Map<string, YCodeTaskListWorkspaceScope>();
    for (const task of tree.tasks) {
      byKey.set(task.workspaceIdentity?.trim() || task.workspacePath, {
        workspacePath: task.workspacePath,
        ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
      });
    }
    for (const project of tree.projects) {
      for (const root of project.roots) {
        const identity =
          project.hostId !== "local"
            ? buildRemoteHostWorkspaceIdentity(project.hostId, root.rootPath)
            : undefined;
        byKey.set(identity || root.rootPath, {
          workspacePath: root.rootPath,
          ...(identity ? { workspaceIdentity: identity } : {}),
        });
      }
    }
    return [...byKey.values()];
  }, [tree.tasks, tree.projects]);
  const scopeKey = JSON.stringify(scopes);
  const taskByKey = useMemo(
    () =>
      new Map(
        tree.tasks.map((task) => [
          groupTaskKey(task),
          {
            hostId: task.hostId,
            workspacePath: task.workspacePath,
            ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
            taskId: task.taskId,
          } satisfies GroupTaskRef,
        ]),
      ),
    [tree.tasks],
  );
  const refresh = useCallback(async () => {
    const request = ++serial.current;
    const workspaceScopes = JSON.parse(scopeKey) as YCodeTaskListWorkspaceScope[];
    // 空目录没有可查询的 scope；不要用空请求换取服务端错误。
    if (!workspaceScopes.length) {
      setStructure(EMPTY);
      setError(null);
      return;
    }
    try {
      const next = await service.listGroupedTaskViewStructure({ workspaceScopes });
      if (request !== serial.current) return;
      setStructure({
        groups: next.groups.map((group) => ({
          id: group.id,
          title: group.title,
          color: group.color as TaskGroupColor,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        })),
        members: next.members.map((member) => ({
          groupId: member.groupId,
          workspaceKey: member.workspaceKey,
          taskId: member.taskId,
          sortOrder: member.sortOrder ?? -member.addedAt,
        })),
        order: next.topLevelOrders.map((node) =>
          node.type === "group"
            ? { type: "group", key: node.groupId, sortOrder: node.sortOrder }
            : {
                type: "task",
                key: JSON.stringify([node.workspaceKey, node.taskId]),
                sortOrder: node.sortOrder,
              },
        ),
      });
      setError(null);
    } catch (cause) {
      if (request === serial.current) {
        setError(String(cause));
        logger.error("[task-groups] 读取分组失败", cause);
      }
    }
  }, [service, scopeKey]);
  useEffect(() => {
    void refresh();
    const subscription = services.broadcastService.onMessage((event) => {
      if (event.channel === "state:task-groups") void refresh();
    });
    return () => {
      serial.current++;
      subscription.dispose();
    };
  }, [services.broadcastService, refresh]);
  const save = useCallback(
    async (input: {
      id?: string;
      title?: string;
      color?: TaskGroup["color"];
    }): Promise<TaskGroup> => {
      let group: YCodeTaskGroup;
      if (input.id) {
        group =
          input.title !== undefined
            ? await service.renameTaskGroup({ groupId: input.id, title: input.title })
            : await service.updateTaskGroupColor({
                groupId: input.id,
                color: input.color ?? "gray",
              });
        if (input.title !== undefined && input.color !== undefined) {
          group = await service.updateTaskGroupColor({ groupId: input.id, color: input.color });
        }
      } else {
        group = await service.createTaskGroup({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        });
      }
      await refresh();
      return group as TaskGroup;
    },
    [refresh, service],
  );
  const applyOrder = useCallback(
    async (root: GroupNode[], groups: Map<string, GroupTaskRef[]>) => {
      // 当前 API 一次提交最终顶层排序 + 所有组的内存序；服务端事务落库并由广播触发重读。
      await service.applyGroupedTaskViewOrder({
        workspaceScopes: JSON.parse(scopeKey) as YCodeTaskListWorkspaceScope[],
        topLevelNodes: root.map(toTopLevelNode),
        groups: [...groups.entries()].map(([groupId, tasks]) => ({
          groupId,
          taskRefs: tasks.map(toTaskRef),
        })),
      });
      await refresh();
    },
    [refresh, scopeKey, service],
  );
  const currentOrder = useCallback(() => {
    const groups = new Map<string, GroupTaskRef[]>();
    for (const group of structure.groups) {
      groups.set(
        group.id,
        structure.members
          .filter((member) => member.groupId === group.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .flatMap((member) => {
            const ref = taskByKey.get(JSON.stringify([member.workspaceKey, member.taskId]));
            return ref ? [ref] : [];
          }),
      );
    }
    const memberKeys = new Set(
      structure.members.map((member) => JSON.stringify([member.workspaceKey, member.taskId])),
    );
    const groupIds = new Set(structure.groups.map((group) => group.id));
    const root: GroupNode[] = [...structure.order]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((node): GroupNode[] => {
        if (node.type === "group")
          return groupIds.has(node.key) ? [{ type: "group", groupId: node.key }] : [];
        if (memberKeys.has(node.key)) return [];
        const ref = taskByKey.get(node.key);
        return ref ? [{ type: "task", task: ref }] : [];
      });
    const orderedGroups = new Set(
      root.flatMap((node) => (node.type === "group" ? [node.groupId] : [])),
    );
    for (const group of structure.groups) {
      if (!orderedGroups.has(group.id)) root.push({ type: "group", groupId: group.id });
    }
    return { root, groups };
  }, [structure, taskByKey]);
  const move = useCallback(
    async (input: MoveGroupNode) => {
      const { root, groups } = currentOrder();
      const key = nodeKey(input.node);
      if (input.groupId == null) {
        const destination = root.filter((node) => nodeKey(node) !== key);
        const anchor = input.anchor ? nodeKey(input.anchor.node) : null;
        const index = anchor ? destination.findIndex((node) => nodeKey(node) === anchor) : 0;
        if (index < 0) throw new Error("task-group.stale-anchor");
        destination.splice(index + (input.anchor?.side === "after" ? 1 : 0), 0, input.node);
        root.splice(0, root.length, ...destination);
        if (input.sourceGroupId) {
          groups.set(
            input.sourceGroupId,
            (groups.get(input.sourceGroupId) ?? []).filter((task) => groupTaskKey(task) !== key),
          );
        }
      } else {
        const destination = (groups.get(input.groupId) ?? []).filter(
          (task) => groupTaskKey(task) !== key,
        );
        const anchor = input.anchor
          ? input.anchor.node.type === "task"
            ? groupTaskKey(input.anchor.node.task)
            : null
          : null;
        const index = anchor ? destination.findIndex((task) => groupTaskKey(task) === anchor) : 0;
        if (index < 0) throw new Error("task-group.stale-anchor");
        if (input.node.type !== "task") throw new Error("task-group.invalid-group");
        destination.splice(index + (input.anchor?.side === "after" ? 1 : 0), 0, input.node.task);
        groups.set(input.groupId, destination);
        if (input.sourceGroupId && input.sourceGroupId !== input.groupId) {
          groups.set(
            input.sourceGroupId,
            (groups.get(input.sourceGroupId) ?? []).filter((task) => groupTaskKey(task) !== key),
          );
        }
      }
      await applyOrder(root, groups);
    },
    [applyOrder, currentOrder],
  );
  const ungroup = useCallback(
    async (id: string) => {
      const { root, groups } = currentOrder();
      const children = groups.get(id) ?? [];
      const nextRoot: GroupNode[] = root.flatMap((node) =>
        node.type === "group" && node.groupId === id
          ? children.map((task): GroupNode => ({ type: "task", task }))
          : [node],
      );
      groups.delete(id);
      await applyOrder(nextRoot, groups);
      await service.deleteTaskGroup({ groupId: id });
      await refresh();
    },
    [applyOrder, currentOrder, refresh, service],
  );
  const parents = useMemo(
    () =>
      new Map(
        structure.members.map((member) => [
          JSON.stringify([member.workspaceKey, member.taskId]),
          member.groupId,
        ]),
      ),
    [structure],
  );
  return useMemo(
    () => ({
      structure,
      parents,
      error,
      refresh,
      save,
      move,
      ungroup,
      available: Boolean(service),
    }),
    [structure, parents, error, refresh, save, move, ungroup, service],
  );
}
