# 动态工作流 UI 余量：留白可视化与可调设置的确认窗

状态：UI 切片，对应上游 ZCode aac47556 的留白时间线/轨道视觉与确认窗可调设置。
范围：`packages/ui` 的时间线、run 卡、run 侧板、侧栏运行行、留白通知行与权限确认块，以及 `packages/shared` 的会话摘要派生字段。
不包含：引擎、运行时、工具契约与协议（`core` / `contracts` / `bootstrap` / `dynamic-workflow` 包一律不改）；`FillWorkflowHole` 工具行渲染器；内置技能与模式设置页。

## 1. 留白：视觉规则

留白（`hole<T>("名字")`）是轨道上一处**还没写下的代码**。它是一站，不是一步；补全后原地长大，因为补全是对本脚本的拼接。

### 1.1 留白站

- 灯：10px（`size-2.5`）、1.5px 虚线边框、无填充。开着时描边 `foreground-subtlest`；等待时描边 `warning` 并带 3px **常亮**光晕——不搏动，因为那里没有东西在跑。
- 名字：`text-ui-caption` medium；未到达前 subtle。**类型（`hole<T>` 的 T）从不上界面**：它是编译契约，不是给用户读的。
- 轨道：触到开着/等着留白的轨道段画虚线——那里还不是代码。带内 SVG 轨道沿用现有画法，不额外加虚线。
- 尾巴留白（`return await hole(...)`）：末站之后多 40px；开着时画一段向右淡出的虚线残段（`.wf-tail-stub`），补全后这 40px 留作头的落脚处。
- 等待：该站就是当前站（`runningIndex` 指向它），进入它的轨道段行进、镜头对准它；站头元数据位写「等待补全」。
- 补全后：有阶段的补全由**头**代表——24px 一行、笔（12px）对准第一枚新灯的 x、留白名跟在后面，tooltip「留白「名字」· 由主代理补全 · 时间」。无阶段的补全不抬头：站名后一枚笔标（`HoleFillMark`），它也是该补全的头。

### 1.2 补全的框

- 只有**头**能点亮框：指针落在 `data-fill-head` 上，或键盘 `focus-visible` 落在头上（站头按钮里的笔标也算）。站、药丸、框自身都不触发——所以横扫卡片不会闪。
- 一次只画一个框；嵌套的补全不叠，悬停外层头时外框包含内框。
- 框是一笔：SVG `pathLength=1` 的路径，`data-fill-on` 时 `stroke-dashoffset` 从 1 走到 0（420ms），离开时整根线 160ms 淡出。
- 补全接进 run 的两秒（`FILL_FRESH_MS`）内，框自己画一遍并染 `warning`，头同色；之后归于静态。

### 1.3 生长

补全接进 run 时，插入列右侧的站与灯按插入宽度滑开（`wf-slide`，320ms，`transform`）；新站用 `wf-land` / `wf-rail-grow` 落地。模型没有历史，所以「插入了什么」由组件比较前后两帧（新补全头 + 站数增量）得出；首帧不滑。`prefers-reduced-motion` 下 `.wf-slide`、`.wf-fill-frame-fresh` 的动画为 `none`，框整根出现/消失。

### 1.4 各面

| 面                        | 表现                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 时间线（确认窗 / run 卡） | 留白站、虚线轨道、尾巴残段、补全头与框                                                                                                                |
| run 卡表头                | 等待中的留白另有「{n} 处留白待补全」笔芯片，与问题芯片可同时在；点它开整个 run                                                                        |
| run 侧板                  | 脊线虚线灯；等待的节自动展开，写「等待主代理补全 · 等了多久」与提示语；有阶段的补全在它写下的第一节之前放 24px 标题行，悬停/聚焦画竖框                |
| 侧栏运行行                | 6px 虚线灯（等待时 warning）；行文字换成「{留白名} · 等待补全」                                                                                       |
| 留白通知行                | 三态：run 在投影且该站 waiting →「工作流留白 · 等待补全」（等待时长每 30 秒刷新）；在投影且 filled →「留白已补全」；run 不在投影 → 中性「工作流留白」 |
| 确认窗                    | 还开着的留白按源码序排一行芯片，后接「运行到留白处会暂停，等主代理补全后继续」；表头阶段数不再把留白算作阶段（「2 个阶段 · 2 处留白」）               |

## 2. 可调设置的确认窗

### 2.1 触发条件

只有工具入参带 `adjustable_settings` 时才画可调控件；块缺席（旧 agent）时退回纯文本条件行，**不画改不动的控件**。块形状：

```ts
adjustable_settings?: {
  subagent_model: boolean;        // 宿主能否解析窗里选的模型
  concurrency_ceiling?: number;   // 默认并发 D（线上键名早于「默认并发」）
}
```

### 2.2 两句话

- 模型：「子代理运行在」+ 模型芯片（会话模型排第一、带「会话模型」徽标；有思考档时旁边是思考档芯片）。会话模型读不出名字时只写「会话模型」。脚本给某些子代理点名了模型时改口「子代理默认运行在」。模型清单不可得时整句退成「子代理沿用会话模型 · 当前 agent 没有模型目录」；调用本身点了模型（继承来的修订）时照实说那个模型。
- 上界：「最多」+ 步进器（减、宽 30px 等宽数字、加；下限 1，无上界）+「个子代理同时运行」+「· 默认 {n}」/「· = 默认」/「· 不设上限」。

### 2.3 改动与确认

- 未改动的值安静地待在句子里；改过的那一行值加粗，句尾跟「· 原为 X ↺」，↺ 把这一行放回起点。
- 起点是这次调用的值：模型缺席即会话模型；上界缺席即默认并发 D。**默认不是上限**：等于 D 发 `null`（不设自己的界），高于 D 发那个数。
- 草稿只活在 `WorkflowAskSettings` 内；改过的字段经 `onContentChange` 交给 `PermissionDialog`，只在**放行**应答（allowOnce / allowAlways）上随 `resolveInteraction` 的 `content` 发出。拒绝与 Refine 不带任何设置——拒绝什么都不启动，Refine 的下一个窗带着模型改过的调用重来。
- 改过设置后，前两个放行选项的描述改口说「按调整后的设置」。所选模型在清单里不可用时，放行被挡下（`aria-disabled`），与「配置」弹层的 Apply 同一条规则。
- `Shift+Tab` 在第一个选项上离开选项列表、落到设置块最后一个控件；设置块里敲数字是输入，不触发选项快捷键。
- 应答在途时所有控件与选项一起禁用。

### 2.4 content 形状

```ts
{
  subagent_model?: string | null;   // null = 回到会话模型
  max_concurrency?: number | null;  // null = 回到默认并发
}
```

只含改过的字段；两项都没改即 `undefined`（Allow 照旧只带 optionId）。

## 3. 状态所有者与事件顺序

| 事实                     | 所有者                                                         | UI 只读点                         |
| ------------------------ | -------------------------------------------------------------- | --------------------------------- |
| 留白开着 / 等着 / 已补全 | `run.holes`（`workflowRuns` 投影）                             | `holeTable`                       |
| 留白的站点/阶段与补全体  | display 载荷 `causalityGraph.holes[]`、阶段与 step 上的 `fill` | `timelineHoleGraph` / `holeTable` |
| 生效脚本的图             | 行窗口里的 `create_workflow` / `FillWorkflowHole` display      | `resolveWorkflowRunGraph`         |
| 悬停/焦点点亮哪个框      | 时间线/侧板组件本地 state（`useFillHeadTarget`）               | 无持久化                          |
| 确认窗设置草稿           | `WorkflowAskSettings` 本地 state                               | 改动经回调上交                    |
| 要随 Allow 发出的设置    | `PermissionDialog`（`usePermissionWorkflowSettings`）          | 只在 allow 选项上读取             |

顺序：

```text
display graph ─┐
run.holes ─────┴─> buildWorkflowTimeline ─> holeTable ─> station.hole / rails.dashed / fills / tailStub / holeParents
                                                        └> timelineFrames ─> <WorkflowTimelineFills>（active / fresh）
pointer|focus on [data-fill-head] ─> useFillHeadTarget ─> active ─> data-fill-on ─> 框画一笔

用户改设置 ─> WorkflowAskSettings.draft ─> onContentChange ─> PermissionDialog 按 requestId 存
点击 Allow  ─> isWorkflowSettingsCarrier(option) ─> content ─> resolveInteraction(answer.content)
点击 Deny/Refine ─> content 丢弃 ─> 下一个窗按新的 requestId 重挂、回到新入参起点
```

## 4. 验收

1. 开着的留白：`station.hole.state === "open"`；两侧轨道 `dashed`；尾巴留白 `tailStub === "open"` 且 DOM 有 `workflow-timeline-tail-stub`；界面不出现类型原文。
2. 等待：`station.hole.state === "waiting"`、该站成为 `runningIndex`；灯 `data-lamp="hole-waiting"` 带 `wf-lamp-hole-waiting`，没有 `wf-lamp-running`；站头写「等待补全」。
3. 补全后：有阶段的补全不出留白站，出现头与框；`data-fill-head` 是唯一的点亮入口；`data-fill` 落在体的站/药丸列上；两秒内框带 `wf-fill-frame-fresh`；无阶段的补全在站名后出笔标。
4. `prefers-reduced-motion: reduce` 下：滑开、框的自画、进场动画全部关闭；框仍可整根出现/消失。
5. 确认窗：带 `adjustable_settings` 时两句话总在；只改上界 → `content.max_concurrency` 是那个数；改回起点 → `undefined`；模型回会话 → `subagent_model: null`；拒绝/Refine 不带 content；模型不可用时 Allow 被挡。
6. 旧 agent（无 `adjustable_settings`）：只画调用设了的纯文本行，不出现步进器/模型菜单。

## 5. 已知边界

- 本切片的 UI 会读取 `adjustable_settings` 并发出 `content`，但本 fork 的 `core` / `contracts` 尚未实现 `applyInputAdjustments`，也没有回填该块；因此当前运行时总是走纯文本分支，**不会静默丢失改动**（因为根本不提供可改控件）。将来运行时补齐后，UI 无需再改。
- 补全后的有效性图依赖行窗口里的 `FillWorkflowHole` display；本切片未实现该工具行渲染器时，run 卡在补全后可能仍画补全前的图。此时以 `run.holes` 的 `filled` 为准：留白站保留名字并画笔标（视作无阶段补全），不继续显示为「开着」。
- 视觉动画、桌面/手机布局与实际焦点行为未在本环境做浏览器级验证；静态结构与纯规则已用临时脚本覆盖。
