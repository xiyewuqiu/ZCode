import type { Modifier } from "@dnd-kit/core";

/* 垂直列表拖拽约束：锁死横向位移，并把拖拽行钳制在其容器（activeNode.parentElement）
   矩形内。独立 lib 而非内联在 SortableWorkspaceSidebar 中：侧栏组内拖拽需要复用同一
   约束，而 SortableWorkspaceSidebar 带着整条 WorkspaceSidebarItem 依赖链，不适合被展示
   组件直接 import，故上提为独立 lib。 */
export const restrictVerticalDragWithinContainer: Modifier = ({
  transform,
  draggingNodeRect,
  activeNodeRect,
  containerNodeRect,
  windowRect,
}) => {
  const nodeRect = draggingNodeRect ?? activeNodeRect;
  const boundaryRect = containerNodeRect ?? windowRect;
  if (!nodeRect || !boundaryRect) {
    return {
      ...transform,
      x: 0,
    };
  }

  const minY = boundaryRect.top - nodeRect.top;
  const maxY = boundaryRect.bottom - nodeRect.bottom;
  const clampedY = Math.min(Math.max(transform.y, minY), maxY);

  return {
    ...transform,
    x: 0,
    y: clampedY,
  };
};
