// side-pane-full-view 模块契约（spec：specs/conversation/side-pane-full-view.md）。
// 只放类型；运行时实现经 index.ts 暴露。

export type SidePaneFullViewSurface = "conversation" | "side-pane";
export type SidePaneFullViewFloating = "collapsed" | "expanded";

/** 按 workspace + 对话 owner 记忆的完整视图状态。 */
export interface SidePaneFullViewState {
  readonly surface: SidePaneFullViewSurface;
  readonly floating: SidePaneFullViewFloating;
}

export interface SidePaneFullViewController {
  /** 生效中的完整视图；面板关闭或当前 owner 没有记录时为 null。 */
  readonly fullView: SidePaneFullViewState | null;
  enter(): void;
  exit(): void;
  toggle(): void;
  setSurface(surface: SidePaneFullViewSurface): void;
  setFloating(floating: SidePaneFullViewFloating): void;
}

/** 对话宿主定位方式：normal 普通三栏；conversation 铺满面板内容区；floating 浮窗。 */
export type SidePaneFullViewHostMode = "normal" | "conversation" | "floating";

export type ConversationPanePresentation = "docked" | "floating";

export interface ConversationPanePresentationValue {
  readonly presentation: ConversationPanePresentation;
  /** 焦点 pane 上报底部输入区实测高度，浮窗收起态按它裁剪。 */
  readonly reportComposerDockHeight: (heightPx: number) => void;
}
