# side-pane-full-view

Side Pane 完整视图：面板占满左侧任务列表以外的内容区，对话成为面板 tab 栏的第一个 tab；选择面板 tab 时，对话收成右下角浮动输入窗口。行为合同见 `specs/conversation/side-pane-full-view.md`。

不变量：

- 唯一状态 owner 是 `useSidePaneFullView`，记录按 workspace + 对话 owner 存在 `taskSidePaneMemory`；侧栏、WorkspaceHeader、浮窗显隐都只读派生，不回写原有状态。
- 对话区只有一个 `SessionPane` 实例；宿主只改变定位方式，不移动 DOM、不重新挂载，草稿与附件因此只有一份。
- 不覆盖 react-resizable-panels 管理的 panel flex：库以各 panel 的 `offsetWidth` 之和作为 group 尺寸，压成 0 会让 resize 得到 NaN。完整视图通过面板外框 `absolute inset-0` 铺满 Group。
- controller 对象引用只在状态变化时更新，它会进入 memo 的 WorkspaceShellLayout。
- 宿主在形态切换前后记录/恢复时间线 `scrollTop`，但不改写 `ConversationTimeline` 的虚拟列表与 follow 锚定逻辑。
- 焦点陷阱与 Escape 由 `useSidePaneFullViewFocusTrap` 提供；退出时焦点回到进入前元素，不可用时回到切换按钮。

交集：

- `SessionPane` 通过 `useConversationPanePresentation` 读取展示形态；浮窗形态把 `floatingComposerDock` 传给 `ConversationTimeline`，不在浮窗下时读到默认 docked，行为不变。
- `V4WorkspaceChatArea` 在浮窗形态只显示焦点 pane，其余 pane 保持挂载但不可见。
- 快捷键 `toggleSidePaneFullView` 在 `packages/shared/src/shortcutCommands.ts` 命令表登记，处理器在 `App.tsx` 注册。
