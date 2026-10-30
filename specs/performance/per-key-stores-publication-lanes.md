# 高频 store 的 per-key 订阅与发布通道

## 背景

`ConversationProjectionStore`（会话投影）和 `SessionsIndexStore`（会话索引）都是
`useSyncExternalStore` 兼容的外部 store。改造前它们各只有一个「整店」监听集合：
任一帧写入都会唤醒全部 React 订阅者。流式 burst 内多个 delta 落在同一动画帧里时，
即使组件只读 `queue` / `status` / `rows.window` 之一，也会被无关 token 反复唤醒，
主线程把时间花在重复 render/commit 上。

本方案在既有 `appFrameNotificationScheduler` 之上增加 **per-key 订阅与发布**，不新增
定时器，也不改变状态同步可读的语义。

## 所有权（Single Owner）

| 关注点                             | 唯一所有者                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 会话投影事实与 optimistic overlay  | `ConversationProjectionStore`（`packages/ui/src/v4/conversationProjectionStore.ts`）                                         |
| 会话索引投影                       | `SessionsIndexStore`（`packages/ui/src/v4/sessionsIndexStore.ts`）                                                           |
| key 变脏登记、发布通道、订阅者派发 | `KeyedPublication`（`packages/ui/src/lib/keyedPublication.ts`）                                                              |
| 帧合并                             | 既有 `FrameNotificationScheduler`（`packages/ui/src/lib/frameNotificationScheduler.ts`）                                     |
| React 可见性门控                   | `subscribeToVisibleProjection` / `subscribeToVisibleProjectionKeys`（`packages/ui/src/v4/visibleProjectionSubscription.ts`） |

`KeyedPublication` 只做发布，不持有业务状态；store 仍是唯一写入方。服务端与协议事实
不因本方案改变，renderer 不新增自己的会话状态。

## Key Map

### ConversationProjectionStore

| key                                                                                                                                                                                                   | 读取值                                             | 典型订阅者                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `snapshot`                                                                                                                                                                                            | `state.snapshot`（整快照身份）                     | 兼容整店订阅、需要整份投影的面板                                                  |
| `sessionId` / `logEpoch` / `seq`                                                                                                                                                                      | `state.snapshot?.sessionId` / `.logEpoch` / `.seq` | SessionPane 外壳身份与帧水位、诊断属性                                            |
| `rows.window`                                                                                                                                                                                         | `state.snapshot?.rows`                             | SessionPane 时间线（`useConversationTimelineProjection`）/ treemapping / 行级派生 |
| `queue`                                                                                                                                                                                               | `state.snapshot?.queue`                            | composer、排队面板                                                                |
| `control` / `meta` / `usage` / `config`                                                                                                                                                               | 对应 snapshot 顶层字段                             | 状态面板、输入区                                                                  |
| `subagents`                                                                                                                                                                                           | `state.snapshot?.subagents`                        | subagent 目录                                                                     |
| `workflowRuns`                                                                                                                                                                                        | `state.snapshot?.workflowRuns`                     | workflow 运行面                                                                   |
| `backgroundWorks` / `pendingInteractions` / `pendingCommands` / `plan` / `goal` / `availability` / `inputRouting` / `sharedContextImport` / `modelTransition` / `workspaceHookAdmission` / `revision` | 对应 snapshot 顶层字段                             | 各自的局部视图                                                                    |
| `status`                                                                                                                                                                                              | `state.status`                                     | 连接态、错误面板                                                                  |
| `lastError`                                                                                                                                                                                           | `state.lastError`                                  | 错误提示                                                                          |
| `subscriptionId`                                                                                                                                                                                      | `state.subscriptionId`                             | 订阅诊断                                                                          |
| `optimistic`                                                                                                                                                                                          | `state.optimisticCommands`                         | pending/stopping overlay                                                          |
| `sessionPlans` / `planDirectoryRevision` / `plansLoading`                                                                                                                                             | 对应 state 字段                                    | 计划目录                                                                          |
| `loadingOlder`                                                                                                                                                                                        | `state.loadingOlder`                               | 时间线预取                                                                        |
| `openTiming` / `rendererTiming`                                                                                                                                                                       | 对应诊断字段                                       | 性能诊断                                                                          |
| `turnNavigatorDirectoryRevision`                                                                                                                                                                      | `state.turnNavigatorDirectoryRevision`             | 问题导航                                                                          |

snapshot 缺失时所有 snapshot 字段 key 读取共享哨兵 `NO_SNAPSHOT`；首帧到达必然让它们
从哨兵变为真实字段，不会出现「snapshot 已到但 key 仍相等」的漏通知。

### SessionsIndexStore

| key           | 读取值                                             |
| ------------- | -------------------------------------------------- |
| `workspaceId` | `state.workspaceId`                                |
| `logEpoch`    | `state.logEpoch`                                   |
| `seq`         | `state.seq`（帧水位）                              |
| `sessions`    | `state.sessions`（sessionId → SessionSummary Map） |
| `status`      | `store.getStatus()`                                |

## 发布通道（PublicationLane）

通道是**写入方**的意图，不是订阅者的属性：

| lane                      | 语义                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `none`                    | 只写状态，不安排通知；脏 key 累积，等下一次非 `none` 发布合并送出 |
| `animation-frame`（默认） | 脏 key 合并到同一动画帧，复用 `appFrameNotificationScheduler`     |
| `immediate`               | 用户阻塞级写入：取消挂起的帧回调并同步派发                        |

规则：

1. 状态写入始终同步完成，`getState()` / `getSessions()` / 命令 ACK 判定读到的是最新事实。
2. `immediate` 只用于终结态/必须同 tick 可见的跃迁；当前仅会话投影 `close()` 的
   `status = "closed"` 使用。其余既有写入保持 `animation-frame`，语义与改造前一致。
3. `none` 不创建第二套缓存，也不延迟状态本身；它只是把通知推迟到下一次发布。
4. 不新增 `setTimeout` / `setInterval` / 私有 rAF 循环；`animation-frame` 完全由既有
   调度器驱动，文档隐藏时仍沿用调度器的「保留挂起、恢复可见补发」行为。

## 脏 key 计算

`conversationDirtyKeys(previous, next, patch, snapshotMode)`：

- **snapshot 整体替换**（snapshot 帧，显式 `snapshot: "replace"`）：标记 `snapshot`、
  `rows.window`、`sessionId` / `logEpoch` / `seq` 与全部 snapshot 字段 key。规则与协议一致：
  整体替换，不 merge。
- **delta 帧**（默认 `diff`）：对 snapshot 每个顶层字段做引用比较，只标记引用变化的字段；
  `snapshot.rows` 变化时标记 `rows.window`；每帧推进 `seq`。`applyConversationDeltas`
  的累加器只复制被触碰的字段，因此 stream text 不会标记 `queue`，`state.updated` 不会
  标记 `rows.window`；`sessionId` / `logEpoch` 在 delta 内保持不变。
- **state patch**：对 patch 在场的非 snapshot 字段做引用比较，只标记真正变化的状态 key
  （如 `status`、`optimistic`、`loadingOlder`）。
- 最后 `KeyedPublication.flush()` 再用每个 key 的 `readKey` 与上次发布值做一次
  `Object.is` 比较：同一帧内改回原值的 key 不会通知。

`applySessionsIndexFrame`：

- snapshot 帧 → `workspaceId`、`logEpoch`、`seq`、`sessions` 全部变脏；
- 衔接的 delta 帧 → 始终推进 `seq`；`sessions` 仅在 upsert 命中不同 summary 或 remove
  命中已存在的 sessionId 时变脏（写时复制，未命中不生成新 Map）；
- 迟到帧 / 断档 → 无脏 key，不发布。

## 兼容与迁移边界

- `store.subscribe(listener)` 保留：等价于登记全部 key，现有非迁移组件不需要改写。
- 新增 `store.subscribeKeys(keys, listener)`；hook 层新增
  `useConversationProjectionSelector(lease, selector, keys?)`、
  `useConversationTimelineProjection(lease)` 与 `useSessionPaneProjection(lease)`。
  `keys` 必须是稳定的模块级常量数组，否则每次渲染会退订/重订阅。
- 已迁移的高频消费者：
  - `useTreemappingConversationMessage` 只订阅 `rows.window`，不再被
    `state.updated`（queue/status/usage 等）唤醒。
  - `SessionPane` 的时间线读面（`rows` / `totalCount` / `canLoadOlder` /
    `loadingOlder` / `turnNavigatorDirectoryRevision`）由
    `useConversationTimelineProjection` 提供，只登记 `rows.window`、`loadingOlder`、
    `turnNavigatorDirectoryRevision`。queue、control、usage、status、optimistic 写入
    不会唤醒这个订阅。
  - `SessionPane` 外壳不再调用整店 `useConversationProjection`，改由
    `useSessionPaneProjection` 按独立 key 登记：`sessionId` / `logEpoch` / `seq`、
    `status`、`config`、`queue`、`control`、`usage`、`subagents`、`workflowRuns`、
    `sessionPlans`、`rows.window`、`optimistic`、`loadingOlder`、
    `turnNavigatorDirectoryRevision`、`lastError`，以及外壳同样读取的
    `subscriptionId` / `planDirectoryRevision` / `revision` / `inputRouting` /
    `goal` / `plan` / `availability` / `pendingInteractions` / `pendingCommands` /
    `backgroundWorks` / `meta` / `sharedContextImport` / `modelTransition` /
    `workspaceHookAdmission`。`SESSION_PANE_PROJECTION_KEYS` 明确不包含 `snapshot`
    整身份 key，也不登记 `plansLoading` / `openTiming` / `rendererTiming` 等外壳
    不读的诊断 key。
  - 外壳渲染用的 `snapshot` 由上述 keyed slice 在 render 时重建，仍是
    `ConversationProjectionStore` 的派生物，没有第二份会话事实。
  - 命令回调继续通过稳定 `snapshotRef` 读取；该 ref 是 getter，每次读取都走
    `lease.store.getState().snapshot`，因此 store 已写入而 React 尚未提交时也不会
    用旧 revision/logEpoch/queue/inputRouting 发 CAS。
- `ConversationTimeline` 自身不订阅 store，数据全部来自 props；本次只改
  `SessionPane` 的数据来源，未改动组件内部滚动/虚拟化实现与 prop 类型。
- `visibleProjectionSubscription` 的隐藏层/失活门控对 per-key 订阅同样生效，仍只保留
  一次补发。

## 验收

1. `pnpm exec tsc --noEmit -p packages/ui/tsconfig.json` 中本次变更文件无错误。
2. `pnpm architecture:check --changed` 无新增违规。
3. 定向测试覆盖：
   - snapshot 替换标记全部 key；delta 只标记被触碰 key；
   - `sessionId` / `logEpoch` 只在值变化时通知，`seq` 随 delta 水位推进；
   - `state.updated` 传入相同引用除 `seq` 外不通知对应 key；
   - optimistic 只通知 `optimistic`；
   - `animation-frame` 同帧多次写入合并为一次通知；
   - `immediate` 同步送达，`none` 只写不通知；
   - 改回原值不通知；
   - 整店兼容订阅仍收到通知；
   - sessions-index 未命中的 delta 不通知 `sessions`，迟到帧完全静默。
4. `packages/ui/test/conversationProjectionKeys.test.ts` 用真实 store 验证通知计数：
   snapshot 唤醒时间线；queue/status/optimistic 只唤醒各自 key；row.delta 与
   real-user query 增删唤醒时间线；同引用 `state.updated` 不唤醒配置/行/queue 等
   keyed 订阅（`seq` 水位按定义推进）；SessionPane key 集合不包含 `snapshot` 整身份
   与未读诊断 key。
5. 浏览器渲染计数（`run-keyed-publication.mjs`）逐类断言：rows 写入重新渲染时间线
   只读面，queue/status/optimistic 不重新渲染；外壳内嵌的无 prop memo timeline-only
   读面同样只在 rows 时渲染。
6. 长会话 spacer/follow、`appFrameNotificationScheduler` 的隐藏页语义保持不变（未改
   `ConversationTimeline` 与调度器实现）。

## 基准与未验证

- 逻辑层验证已通过（脏 key 精度、通道合并、兼容订阅、时间线 keyed 通知计数、
  SessionPane key 集合边界）。
- 已在浏览器内用合成 store + 真实 hook 跑通通知/渲染计数基准
  （`packages/ui/test/browser/keyedPublicationBench.tsx` +
  `run-keyed-publication.mjs`）：12 轮 rows/queue/status/optimistic 混合写入共 48 次写入，
  整店订阅通知 48 次、渲染 48 次；SessionPane keyed 外壳按自身读面通知 48 次、渲染
  48 次（它确实读 queue/status/optimistic/seq/rows，不声称对自身读面抑制）；时间线
  keyed 订阅通知 12 次、渲染 12 次（仅 rows 写入），抑制率 75%；嵌在外壳内的无 prop
  memo timeline-only 读面同样只渲染 12 次，queue/status/optimistic 不通过外壳重渲染
  连带它。该结果依赖合成 store 与逐帧写入，不代表真实 Electron/移动端长会话的帧耗时。
- 真实长会话浏览器性能未实测：仍需在流式 assistant + queue 更新 + workflow run 更新
  并发下用 Performance 面板对比改造前后每帧 render/commit 次数、scripting 时间与掉帧率。
- `SessionPane` 外壳已不再整店订阅，但它自己的读面（queue/status/composer/状态面板）
  仍会在对应 key 变化时重渲染。若要进一步压缩外壳 render，需要把 composer、状态面板、
  bottom dock 拆成各自 keyed 订阅的 memo 子树；本次未改这些组件的 prop 类型与滚动所有权。
