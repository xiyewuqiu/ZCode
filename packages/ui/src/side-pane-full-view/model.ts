// Side Pane 完整视图的纯模型：状态常量与浮窗几何。
// spec：specs/conversation/side-pane-full-view.md。只做纯计算，不读写 DOM / 存储。
import type { SidePaneFullViewState } from "@/side-pane-full-view/contract.js";

export const SIDE_PANE_FULL_VIEW_ENTER_STATE: SidePaneFullViewState = {
  surface: "side-pane",
  floating: "collapsed",
};

export const FLOATING_MARGIN_PX = 16;
export const FLOATING_WIDTH_PX = 560;
export const FLOATING_EXPANDED_MAX_HEIGHT_PX = 640;
export const FLOATING_HEADER_HEIGHT_PX = 40;
/** 输入区高度尚未测出时的兜底高度，避免首帧把浮窗画成 0 高。 */
export const FLOATING_FALLBACK_DOCK_HEIGHT_PX = 96;

export interface FloatingRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function resolveFloatingWidth(slotWidth: number): number {
  return Math.max(0, Math.min(FLOATING_WIDTH_PX, slotWidth - FLOATING_MARGIN_PX * 2));
}

export function resolveFloatingExpandedHeight(slotHeight: number): number {
  return Math.max(
    0,
    Math.min(FLOATING_EXPANDED_MAX_HEIGHT_PX, slotHeight - FLOATING_MARGIN_PX * 2),
  );
}

/**
 * 浮窗高度与内部裁剪高度。
 * - 收起态：外层就是输入框，高度等于实测输入区高度；操作栏可见时额外加 header。
 * - 展开态：外层占满允许高度，内部消息流让出 header。
 */
export function resolveFloatingFrame({
  slot,
  expanded,
  headerVisible,
  dockHeightPx,
}: {
  slot: FloatingRect;
  expanded: boolean;
  headerVisible: boolean;
  dockHeightPx: number;
}): {
  height: number;
  clipHeight: number;
  contentHeight: number;
  left: number;
  top: number;
  width: number;
} {
  const width = resolveFloatingWidth(slot.width);
  const maxHeight = resolveFloatingExpandedHeight(slot.height);
  const headerHeight = headerVisible ? FLOATING_HEADER_HEIGHT_PX : 0;
  const expandedContentHeight = Math.max(0, maxHeight - headerHeight);
  const contentHeight = expanded
    ? expandedContentHeight
    : Math.max(Math.min(dockHeightPx, maxHeight), 0);
  const height = Math.max(0, Math.min(contentHeight + headerHeight, maxHeight));
  const left = slot.left + slot.width - FLOATING_MARGIN_PX - width;
  const top = slot.top + slot.height - FLOATING_MARGIN_PX - height;
  return {
    height,
    clipHeight: Math.max(0, height - headerHeight),
    // 收起态内部仍按展开高度排版并贴底，只露出底部输入区；展开态就是可见消息流高度。
    contentHeight: expanded
      ? expandedContentHeight
      : Math.max(0, resolveFloatingExpandedHeight(slot.height) - FLOATING_HEADER_HEIGHT_PX),
    left: Math.max(slot.left, left),
    top: Math.max(slot.top, top),
    width,
  };
}
