# 侧面板完整视图（Side Pane Full View）

状态：已实现。模块：`packages/ui/src/side-pane-full-view/`（managed，见模块内 `CONTRACT.md`）。

## 目标

右侧面板（子代理 transcript、workflow run、产物、任务详情等）可以临时占满左侧任务列表以外的全部内容区。对话不再占用中间列的布局空间，而是变成面板 tab 栏里的第一个 tab；选择任意面板 tab 时，对话收成一个浮在面板内容区右下角的输入窗口。

左侧任务列表和左上角按钮组保持原样，进入/退出完整视图不修改侧栏显隐、侧栏宽度、面板宽度、终端开合等原有状态。

## 状态归属

唯一状态 owner 是 `useSidePaneFullView`，状态只存在 renderer 内存中：

```
taskSidePaneMemory（按 workspace 的 LRU）
└─ sidePaneFullViewByOwner[ownerTaskId ?? "__draft__"]
   └─ { surface: "conversation" | "side-pane", floating: "collapsed" | "expanded" } | 缺省
```

- `ownerTaskId` 与 `sidePaneCollapsedByOwner` 使用同一份 owner 语义：正式任务用 taskId，草稿用 `__draft__`。
- 宿主组件内另有临时 UI 状态：浮窗几何、底部输入区实测高度、焦点陷阱的恢复目标；这些不进入服务端事实，也不写持久化。
- 完整视图生效 = 面板打开 && 当前 owner 有记录 && 主视图为 chat。侧栏、WorkspaceHeader、浮窗显隐都只从记录只读派生，不回写原有状态。
- 同一 owner 下面板由开变关（◫、关闭最后一个 tab）时清除该 owner 的记录；切换 owner 时面板开合变化不清除记录。刷新或重启应用后不保留。
- 浮窗形态（`collapsed` / `expanded`）属于当前 owner 的记忆；切走再切回同一 session 时保留。

## 入口与退出

| 动作                                                                   | 结果                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| 面板右上角「进入完整视图」按钮（位于面板开关左侧）、`Cmd/Ctrl+Shift+F` | 进入完整视图，当前 tab 保持为面板 tab，浮窗为收起态      |
| 同一按钮（此时为「退出完整视图」）、同一快捷键、`Escape`               | 退出完整视图，回到原三栏布局                             |
| 面板开关 ◫                                                             | 关闭面板，同时退出完整视图；再次打开面板不会回到完整视图 |
| 关闭最后一个面板 tab                                                   | 面板按既有规则收起，同时退出完整视图                     |
| 面板关闭时按快捷键                                                     | 打开面板并进入完整视图                                   |

- 快捷键命令 id 为 `toggleSidePaneFullView`，在 `packages/shared/src/shortcutCommands.ts` 登记；桌面与 Web 共用同一个 window 通道处理器。
- 退出时焦点返回进入前的焦点元素；若该元素已不可用，则返回「进入/退出完整视图」按钮。

## 布局

```
普通视图                                    完整视图
┌────────┬────────────────┬────────────┐    ┌────────┬───────────────────────────────┐
│ 任务列表 │ WorkspaceHeader │ [tabs][⤢][◫] │    │ 任务列表 │ [💬 对话][tab…][+]   [⤡][◫] │
│        │ 对话            │ 面板内容      │    │        │ 面板内容（或对话全宽）           │
│        │ 终端            │             │    │        │              ┌─────────────┐ │
└────────┴────────────────┴────────────┘    │        │              │ 浮动输入框    │ │
                                            └────────┴──────────────┴─────────────┴─┘
```

- `WorkspaceHeader` 在完整视图中隐藏，面板 tab 栏成为内容区顶栏；Windows/Linux 窗口按钮仍在面板右上角。
- 面板外框在完整视图中改为 `absolute inset-0`，以 `ResizablePanelGroup`（完整视图中为 `relative`）为定位容器铺满整行。面板由 `react-resizable-panels` 管理的 flex / 已保存占比不变：库按各 panel 的 `offsetWidth` 之和计算 group 尺寸，把对话列压成 0 会让 resize 得到 NaN。
- 对话 tab 固定在第一位：聊天图标 + 当前任务标题（草稿显示「新任务」），不能关闭、不能拖动排序、没有「⋯」菜单。tab 栏是窗口拖拽区，对话 tab 必须显式 `app-region: no-drag`。
- 点对话 tab：对话在面板内容区全宽显示（含底部终端）。点任意面板 tab：显示该 tab，并出现浮动输入窗口。
- 面板内容区（tab 栏下方）是浮窗定位的 slot；宿主通过 `ResizeObserver` 读取 slot 的窗口坐标，只写入 DOM style，不进入 React state。

## 单实例与滚动不变量

对话区只保留一个 `SessionPane` 实例。完整视图只改变它所在容器的定位方式，不移动 DOM、不重新挂载：

```
WorkspaceShellLayout（三种形态下 React 树结构相同）
└─ ResizablePanelGroup（relative）
   ├─ conversation-column
   │  └─ SidePaneFullViewConversationHost（固定存在的包装层）
   │     ├─ 普通视图：relative h-full w-full
   │     ├─ 完整视图 + 对话 tab：fixed，铺满面板内容 slot
   │     └─ 完整视图 + 面板 tab：fixed，浮在 slot 内（右下角）
   ├─ ResizableHandle：完整视图中隐藏
   └─ 面板 panel：完整视图中内容层 absolute inset-0
```

- 同一 DOM 保证草稿、附件上传、滚动位置、选区与撤销历史只有一份；不额外创建 composer。
- `ConversationTimeline` 的虚拟列表、长会话 spacer、follow/锚定逻辑保持不变，本功能只通过宿主定位改变可视尺寸。
- 宿主在形态切换前后记录/恢复 `[data-v4-timeline-scroll]` 的 `scrollTop`：布局变化导致浏览器钳制滚动位置时，下一帧显式恢复原阅读位置。该逻辑不修改 `ConversationTimeline` 的锚定算法。
- 浮窗形态下输入区不再是 sticky 层，而是相对时间线根节点贴底；滚动容器底边让出输入区高度 + 12px，滚动条止于输入框上方。该样式由 `ConversationTimeline` 的 `floatingComposerDock` 属性提供，不改变滚动锚定。

## 浮窗

- 收起态只露出 `SessionPane` 底部输入区（`data-v4-composer-dock`）；输入框外壳就是浮窗最外层，内部会话保持展开态高度并贴底，上方内容被裁掉但仍挂载。
- 操作栏在浮窗获得焦点或处于展开态时显示：左侧「展开消息流 / 收起消息流」按钮、右侧「退出完整视图」按钮。
- 展开态在浮窗内显示窄消息流；宽度 `min(560px, slot 宽度 - 32px)`，高度 `min(640px, slot 高度 - 32px)`。收起态同宽、高度为输入区实测高度。
- 浮窗固定在 slot 右下角，与 slot 边缘保持 16px。窄屏（手机 Web）下宽度自然收缩到 slot 宽度 - 32px，底部吸附，不遮挡左侧任务列表。
- 浮窗内的输入框与对话 tab 使用同一棵 `SessionPane` DOM 树，只切换 CSS 定位与裁剪。
- 浮窗没有拖拽、最小化或回答气泡；退出完整视图或点对话 tab 即可回到完整对话。
- 宿主几何变化与浮窗展开/收起使用 `motion-safe` 过渡；`prefers-reduced-motion` 下禁用过渡，直接到位。

## 焦点与可访问性

- 进入完整视图后，`Tab` 焦点限制在完整视图内容区（对话 + 面板）内循环；`Shift+Tab` 反向循环。左侧任务列表仍可用鼠标点击。
- `Escape` 退出完整视图并恢复进入前的焦点。
- 「进入/退出完整视图」「对话 tab」「展开/收起消息流」「关闭完整视图」均有可访问名称与 `aria-pressed` / `aria-expanded` / `data-testid`。
- 对话 tab 使用 `TabsTrigger`，面板 tab 的 `onActivateTab` 统一经过激活包装：先切回 `side-pane` surface，再激活 tab。
- 浮窗关闭按钮位于操作栏；在对话 tab 与浮窗之间切换不移动焦点元素本身，避免输入框失焦。

## 桌面与手机 Web

- 桌面：完整视图覆盖右侧内容区，左侧任务列表与窗口按钮保留；面板宽度、侧栏宽度等原状态不变。
- 手机 Web / 窄屏：同一套 DOM 与状态；面板外框铺满内容区，浮窗宽度收缩到底部吸附，`Escape` 在无物理键盘时由「退出完整视图」按钮替代。
- 面板关闭、主视图切到 automations / plugin-store 时完整视图立即失效，记录保留，回到 chat 后按记录恢复。

## 验收

1. 打开面板任一 tab，点「进入完整视图」或按 `Cmd/Ctrl+Shift+F`：面板占满内容区，Header 消失，对话 tab 位于 tab 栏首位。
2. 点面板 tab：对话变成右下角浮窗；点对话 tab：对话全宽显示，滚动位置不跳动。
3. 在浮窗输入框输入草稿，切到对话 tab 再切回：草稿、光标、附件仍在（同一 DOM 实例）。
4. 按 `Escape` 或再次点按钮：回到三栏布局，侧栏/面板宽度/终端开合与进入前一致，焦点回到进入前元素或切换按钮。
5. 关闭面板或关闭最后一个 tab：完整视图退出，记录被清除；重新打开面板不会自动进入完整视图。
6. 切换到其他 session 再切回：完整视图、surface 与浮窗形态按该 owner 恢复。
7. `Tab` / `Shift+Tab` 在完整视图内容区内循环；浮窗按钮有可访问名称。
8. `prefers-reduced-motion` 下无几何过渡。
9. 窄屏 Web 下不出现横向溢出，浮窗底部吸附、宽度不超出内容区。
10. 长会话中进入/退出完整视图或切换 surface：时间线阅读位置保持，`ConversationTimeline` 的 spacer / follow 逻辑无回归。
