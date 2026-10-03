# 界面切换与聊天滚动性能验证记录

2026-10-03，Windows，本机 dev 构建（Vite + Edge headless）。测量口径沿用
`packages/ui/test/browser/measureScrolling.js`（20Hz 流式更新下采样 180 帧，跳过前 16 帧）。

因为本机采样噪声可达 ±50%（同一份未改动源码两次测量就能差 65%），所有对照都改为
**交替 A/B**：同一浏览器会话内轮流测量「当前源码」与「暂存的基线源码」，三轮取中位数。

## 已落地

- 投影 store 与会话索引 store 的 React 通知按动画帧合并：`getState()` 始终最新，
  同一帧内多次 delta 只通知一次。无 `requestAnimationFrame` 的环境保持同步通知。
- `ConversationTimeline` 的滚动路径不再写 React 状态：视口度量、消息层遮罩与活动 query
  统一走 `timelineViewportProbe`，滚动只登记失效，度量按帧合并，遮罩取值不变不写 DOM。
- 导航 rail 是唯一订阅该探针的组件，并把度量折叠为「活动项是否变化」的稳定快照；
  rail 关闭或容器窄于 864px 时完全不做 DOM 扫描。
- 渲染单元数组、虚拟项数组在内容未变时保持身份，避免目录集合、挂载键与导航 props
  被逐帧重算。
- 主视图（chat / automations / plugin-store）切换不再卸载聊天区：新增 `LayerSurface`
  常驻挂载、失活层 `inert` + `visibility:hidden`（保留布局，动态测高不归零），
  并通过层活动门控让隐藏层不接收投影通知；设置页覆盖工作区同样进入失活态。
- 物化缓存与行高缓存按「会话 + logEpoch」跨挂载复用（有界 LRU，容量 3），
  切回同一会话不再重新物化整轮、不再逐行重新估计高度。

## 实测（交替 A/B，三轮中位数）

| 场景（1258×622 / 390×844，5,797 行，rail 可见） | 基线中位数 | 当前中位数 | 基线 P95 | 当前 P95 |
| ----------------------------------------------- | ---------: | ---------: | -------: | -------: |
| 桌面 · 滚动                                     |    19.2 ms |    11.4 ms |  40.9 ms |  14.8 ms |
| 桌面 · 滚动 + 20Hz 流式                         |          — |          — |  65.5 ms |  50.0 ms |
| 手机 · 滚动                                     |    23.1 ms |    10.3 ms |  50.7 ms |  15.3 ms |
| 手机 · 滚动 + 20Hz 流式                         |          — |          — |  71.1 ms |  64.6 ms |

会话切换（长会话 ↔ 短会话，卸载重建往返）中位数 167 ms → 176 ms，长任务峰值 224 ms → 208 ms：
在噪声范围内，本轮缓存复用只覆盖派生计算，没有改变「整树重建」这一主因。

## 功能验收

`node packages/ui/test/browser/run-regressions.mjs`（两个视口）全部通过：

- `measureScrolling`（rail 关闭）：桌面 8.7 ms / P95 19.6 / 最大 27.5，0 帧超 50 ms；手机 9.1 / 19.7 / 25.0，0 帧超 50 ms。
- `verifyWorkWindow`：5,201 项工作记录只挂载 17 项，选区在滚动中保留、离屏搜索命中并定位。
- `verifySessionSwitch`：10 次会话切换，返回后保留完整历史与后台新增 token。
- `verifyInteractions`：搜索、展开/收起、输入、回到底部、完成态迁移、整轮复制全部通过。

`node packages/ui/test/browser/run-layer-activity.mjs`：两个层各挂载一次；活动层逐次接收通知；
失活层在 30 次更新期间零重渲染且保留 DOM；切回时一次渲染读到最新状态（渲染次数与隐藏期间
的更新数无关）。

Node 单测：`frameNotificationScheduler.test.ts`、`layerActivityProjection.test.ts`、
`timelineViewportProbe.test.ts` 与既有 `visibleProjection.test.ts` 共 12 项通过。

## 检查

- 定向 `tsc -p packages/ui`：通过。
- 根 `pnpm typecheck`：未通过，错误全部在 `packages/desktop/src/main/desktopRemoteSessions.ts`（13 条）
  与 `desktopHostProcess.ts`（10 条），内容为缺失模块 `./providerProvisioningEnvironmentCoordinator.js`
  与 `@zcode/shared` 未导出的 `ProviderProvisioningTrigger`。这两个文件不是本轮改动，
  工作区里也不存在该模块，属于既有基线失败；本轮涉及的 rpc / shared / services / ui 全部编译通过。
- 根 `pnpm lint`：0 错误、58 条警告（低于既有基线 63 条），本轮文件无新增警告。
- `pnpm architecture:check --changed`：violations 0、baseline 0、new 0。

## 仍未覆盖

- 未启动完整桌面应用；主视图切换、设置页覆盖的收益由合成 fixture、单测与源码所有权推导，
  没有真实 Host/Agent 联合压力数据。
- 滚动 + 流式的剩余成本主要来自当前轮 Markdown 重渲染与整轮派生（复制文本拼接、工作项
  渲染项构建）；本轮只让它的触发频率降到每帧一次，没有做增量派生。
- 会话切换仍是整树重建；要做到「切任务零重建」需要会话级 keep-alive（内存与状态所有权
  的更大改动），本轮未做。
- 绝对帧耗时包含 dev 构建的 React 开发开销，不代表生产构建；跨机器不可直接比较。

## 接手轮追加（2026-10-03 第二遍）

上一轮的工作区改动未提交也未收口。本遍先复核再加固，**没有推翻既有方案**。

### 复核结论：JS 侧已无大热点

对 4 秒持续流式（保持贴底、`work=1000` 的整轮）做 CDP 采样剖析（200μs 间隔）：

| 采样项                                  |    占比 |
| --------------------------------------- | ------: |
| idle                                    |   73.1% |
| (program)                               |    9.7% |
| `jsxDEV`（React dev 构建）              |    2.7% |
| `addObjectDiffToProperties`（dev 校验） |    1.7% |
| 其余单项                                | 均 < 1% |

结论：主线程 73% 空闲，最大单项是 dev 构建的 JSX 校验开销（生产构建不存在）。
`buildRenderUnits` / `materializeDraftUnit` / `getMeasurements` 均在 0.2–0.4%。**没有值得继续挖的 JS 热点。**

### 改动 1：整轮复制文本派生移出流式热路径

`ConversationTurnGroup` 过去每帧对流式轮执行 `resolveAssistantCopyText`（拼接整轮全部 text 段，
并对 ExitPlanMode 行做计划正文提取）与随后的 `projectAssistantCodeComments` 全文投影。
这两者的消费者都要 `state === "complete"`（行内动作栏与轮尾工具栏），流式期间产物无人消费。

现按终态门控：流式期间 `assistantRawCopyText` 为 `undefined`，终态一次算出。
被 `verifyInteractions` 的 `fullModelCopy` 断言覆盖（含未挂载早期工作项与最终回复）。

**A/B 实测（保持贴底流式，三轮中位数）**：

| 场景       |   基线 | 改动后 |
| ---------- | -----: | -----: |
| 中位帧间隔 | 8.3 ms | 8.3 ms |
| P95        | 8.7 ms | 9.6 ms |

差异在采样噪声内。该改动是**消除与整轮文本量成正比的冗余派生**（长回复、多段正文时才有量级），
不是本次 fixture 可测的瓶颈——如实记录，不宣称收益。

### 改动 2：滚动所有权状态机补单测

`timelineScrollAnchor.ts` 本轮的滚动所有权三态、新消息计数、prepend 锚定、键盘/滚轮/触摸意图、
loadOlder 触发等纯逻辑此前**零单测覆盖**，且浏览器 fixture 只能覆盖其中一小部分交互路径。
新增 `packages/ui/test/timelineScrollAnchor.test.ts`（18 项），并登记进
`test/tsconfig.long-conversation.json` 的 include。

### 已知落差：spec 规则 6 只覆盖 chat 层

spec 规则 6 要求「chat / automations / plugin-store 首次访问后保持挂载」。实际只对 chat 层生效：

- **plugin-store 不能照搬**：`officialMarketplaceAutoRefresh.ts` 明确依赖
  `key={plugin-store:${pluginStoreOpenVersion}}` 的**每次进入重挂载**来承载目录自动刷新的节流/防抖；
  改为常驻会破坏该语义（需要把节流状态移到模块级才能保持行为，属独立改动）。
- **automations 保持挂载需产品确认**：`AutomationsSection` 的 `initialize()` 只在挂载时拉一次数据、
  无轮询，常驻是净收益；但深链（`openAutomationId` / `openAutomationTab`）的一性次导航消费时机
  会从「挂载时」变为「用户切到该视图时」，属行为变化，需产品确认后再做。

本遍未实施规则 6 的剩余部分，避免在无性能证据时引入深链时序歧义。

### 本遍检查

- 定向 `tsc -p packages/ui`：通过（本轮改动文件）。
- 全量 UI 单测：71 项通过（含新增 18 项）。
- 浏览器回归（`run-regressions.mjs`，两个视口）：`measureScrolling` 桌面 8.2/17.8ms、手机 8.4/19.7ms，
  0 帧超 50 ms；`verifyWorkWindow` 5201→17；`verifySessionSwitch` 保留后台更新；
  `verifyInteractions` 全过且 `fullModelCopy` 为 true。
- `oxlint`：本轮文件 0 错误（3 条既有未使用变量警告）。
- `pnpm architecture:check --changed`：violations 0、baseline 0、new 0。

### 追加发现的既有失败（非本轮引入，未修）

- 根 `pnpm typecheck`：`packages/desktop/src/main/` 的 `desktopRemoteSessions.ts` 与
  `desktopHostProcess.ts` 报缺失模块 `./providerProvisioningEnvironmentCoordinator.js`、
  `@zcode/shared` 未导出 `ProviderProvisioningTrigger`，以及 `off-peak-*` / `network-telemetry-batch`
  类型无交集——属「移除账号体系与厂商特性」提交的残留。
- `packages/ui/test/browser/shellPerformance.tsx` 引用已被「移除会话分享」提交删除的
  `../../src/v4/useConversationShareModel.js`，导致 `tsc -p test/tsconfig.long-conversation.json`
  失败（另 `subagentDirectory.tsx` 一处类型断言）。README 中的 `verifyShell.js` 入口因此不可用。

以上两处均为历史提交的连带破损，不在本轮范围，未修改。

## 清理轮：移除提交的残留引用（2026-10-03 第三遍）

复核时发现「移除账号体系与厂商特性」（6864a11）与「移除桌面端遥测与资源采样」（9468fde）
两次重构**删了功能与 schema、却漏删消费方**，导致根 `pnpm typecheck` 与 desktop 构建失败。
本遍把这些残留一次性收干净，**不恢复任何被删除的功能**。

### 根因（已用 git show 核实）

- 6864a11 删除了 `providerProvisioningEnvironmentCoordinator.ts`、`offPeakDispatchSettlement.ts`、
  `shared/provider-provisioning.ts`、`shared/off-peak-types.ts` 及 `validation.ts` 的 74 行 schema 变体，
  **但没动 `channels.ts`**，也没清理 desktop main 的消费分支。
- 9468fde 只从 `scheduler/index.ts` 删掉了 `schedulerResourceTelemetry` 的 4 行 import，
  **留下了 3 处使用**，把 scheduler 编译弄坏。
- 全仓 grep 确认：`off-peak-run-result`、`off-peak-scheduler-wake-request`、`network-telemetry-batch`、
  `provider-provisioning-source-changed`、`provider-provisioning-execution-result` 已无发送方。

### 改动

- `packages/shared/src/channels.ts`：删 5 个孤立 `HostResponseTypes`，以及失去唯一发送方后变死的
  `HostMessageTypes.OffPeakRun` / `ProviderProvisioningExecute` / `ServiceChannels.ProviderProvisioningTarget`。
  cron 消息原样保留。
- `packages/desktop/src/main/{desktopHostProcess,desktopRemoteSessions,index,desktopCronScheduler}.ts`：
  删死分支与依赖声明、provisioning 协调器与死分支、off-peak 接线（`forwardOffPeakRunResult` /
  `wakeOffPeakScheduler`）、`scheduler-resource-sample` 空处理。
- `packages/desktop/src/scheduler/`：删 off-peak 派发链路（imports / 状态 / tick / handler / dispose 释放 /
  main 中断恢复）、遥测自采链路；`schedulerProtocol.ts` 删 4 个消息变体；**删除死模块
  `schedulerResourceTelemetry.ts`**。scheduler 单目标 `tsc` 由 7 错误转为 0。
- `packages/services/src/node.ts`：删 7 个因功能移除而变死的未使用导入。
- `packages/ui/test/browser/shellPerformance.*` + `verifyShell.js` + README：该 fixture 依赖已被
  「移除会话分享」删除的 `useConversationShareModel`。剥掉分享部分，保留会话投影订阅、
  换 store/卸载清理、窗控避让区、Panel 收放、设置页加载等真实覆盖，并重写断言。
- `packages/ui/test/browser/subagentDirectory.tsx`：synthetic state 断言改走本文件既有的
  `as unknown as` 风格，消除类型错误。

### 本遍验证

- 根 `pnpm typecheck`：**EXIT 0**（清理前为失败）。
- `pnpm exec tsc -p packages/desktop/tsconfig.scheduler.json`：EXIT 0（清理前 7 错误）。
- `pnpm --filter @zcode/desktop exec tsup`（main/preload/host/scheduler 全量打包）：**EXIT 0**
  （清理前因 `./offPeakDispatchSettlement.js` 缺失而构建失败）。
- `tsc -p packages/ui/test/tsconfig.long-conversation.json`：EXIT 0（清理前 3 错误）。
- `pnpm lint`：0 错误、52 警告（清理前 58）。
- `pnpm architecture:check --changed`：violations 0。
- UI 单测 71 项、浏览器回归两视口、`shellPerformance` fixture 两视口：全部通过。

### 第四遍：Off-Peak 残留全量清除（2026-10-03）

承接上节「未处理」的 `offPeakTaskId` 管道：本轮把 Off-Peak（闲时任务）在源码中的残留**整体清除**。
先由只读调研建立完整依赖图并分类（全仓生产者计数为 0，已核实），再按「先清消费方、后删 shared
定义」的自底向上顺序分四片实施：UI、services、CLI、shared，每片独立 `tsc` 验证，最后统一收口。

清除范围：UI 任务标记/分组/i18n；services 的 `taskIndexRepo` 投影列、回填与归组、
`automationToolPolicy` 与 adapter 死分支、`IZCodeTaskService` 的参数；CLI 的 turn 守卫与
`offPeakTurn` / `offPeakQueueHold` / `includeOffPeak` 死信号及协议透传；shared 的 off-peak schema /
类型 / 协议字段 / test-id / channel；以及 `offpeak_queued` 限流原因链。另顺带修复了同批「账号/遥测
移除」在 CLI 侧留下的 `logout` / telemetry 残留（含 `zcode --help` 帮助文案里的 logout 条目）。

**刻意保留三类**（附理由，非遗漏）：

1. **DB 迁移与 schema 定义**：`tasksDatabase/migrations.ts` 的 `columns` / `indexes` / `boundIndex` 与
   `OFF_PEAK_SCHEMA` 参与 `0001_adopt_task_schema` 的 sha256 `checksumInput`；改动会让已存在的用户库
   启动即抛 `checksum_mismatch`。列与表保留（新装库该表为空、该列恒 NULL），仅停止全部读写、回填与
   归组，并去掉删除预检里的 `off_peak_tasks` 关联阻塞。
2. **远端配置驱动的 `NAVIGATE:AUTOMATIONS:OFFPEAK` token**：由远端 scene 配置下发，仓内无法验证其
   是否仍在使用；保留其解析（它指向存活的定时任务页）。
3. **存活的 keep-awake 文案** `offPeak.keepAwakeBanner`：`AutomationKeepAwakeNotice` 仍在引用。

本遍验证：根 `pnpm typecheck` 0；CLI 全部子包 `tsc` 0；`lint` 0 错误 / 52 警告；
`architecture:check --changed` 0 违规；UI 单测 71 项、浏览器回归 8 场景、`shellPerformance` 两视口、
desktop `tsup` 干净重建全部通过。源码中 off-peak 仅剩上述三类保留。
