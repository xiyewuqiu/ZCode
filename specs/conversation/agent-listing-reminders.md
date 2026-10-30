# Agent 目录提醒（agent_listing_delta）

## 背景

Agent 工具此前把完整 subagent 目录内联进工具描述。目录随 profile/插件增减时，工具描述会变长，
且无法在会话中途向模型说明"新增/移除了哪些 agent 类型"。本规格将该目录改为系统提醒：

- 工具描述只保留稳定的使用说明与一句"agent 类型见系统提醒"。
- 运行时在安全的模型请求前置边界收集目录差异，以 `agent_listing_delta` 系统提醒注入。
- 增量写入持久历史；冷恢复、压缩后仍能判断哪些类型已经通知过。

实现对齐上游 listing metadata + runtime helper + system reminder source 的设计，不依赖
ToolSearch / `shouldDefer`。

## 单一事实来源

| 事实 | 所有者 | 说明 |
| --- | --- | --- |
| 当前可用 agent 类型 | `AgentDefinitionsSnapshot.activeAgents` | 由 `runtime.getAgentDefinitions()` 提供 |
| 默认 provider 实现 | `createAgentDefinitionsReader(config.subagents.profiles)` | 与 Agent 工具派发共用 `subagents.profiles`，经 `normalizeAgentProfiles` 补齐内置 general-purpose/Explore |
| 宿主覆盖 | `AgentRuntimeDeps.getAgentDefinitions` | 仅用于会话内动态增删 profile 的宿主；不得另存目录副本 |
| 已通知类型 | 历史中的 `agent_listing_delta` attachment 的 `agentListingDelta` | 只信结构化 metadata，不从提醒正文反推 |

约束：

- 不持久化完整目录快照，只持久化每次的增量（added/removed 名称、渲染行、是否首次）。
- Agent 工具实际派发仍读取同一份 profile 来源；目录提醒不得成为第三份事实。
- 插件/profile 增删只要反映到 runtime 的定义来源，下一次收集就会产出对应的 added/removed。

## 目录内容

每个新增类型渲染为一行 `- <name>: <description> (Tools: <tools>)`，复用
`formatAgentProfileForPrompt`（内置 Explore 使用 explore 工具说明，其余按 profile 的
`tools`/`disallowedTools` 过滤子工具名）。

提醒正文分段拼接：

1. 首次（历史中没有任何 `agent_listing_delta`）：
   `Available agent types for the Agent tool:` + 新增行。
2. 非首次新增：
   `New agent types are now available for the Agent tool:` + 新增行。
3. 移除：
   `The following agent types are no longer available:` + `- <name>` 列表，
   并追加环境说明 `This is ambient context — do not narrate it ...`。
4. 仅首次且存在新增时追加并发提示：
   `When you launch multiple agents for independent work, send them in a single message ...`。
   该提示已从 Agent 工具描述移出，避免重复。

顺序：新增类型按 `name` 升序；移除类型按字典序。正文由 provider 投影统一包进
`<system-reminder>`，不新增 provider 可见的工具名或角色。

## 交付边界（offer boundaries）

目录只在"工具面已确定、模型请求尚未发出"的前置步骤计算：

- 仅当本轮工具集合包含 `Agent` 时考虑；`Agent` 被 turn 级 disallowlist 隐藏、或
  `automationCreateLimitReached` 使工具集合为空时，不公告。
- automation 执行轮对 mutation 工具的过滤经 `getTurnTools` 统一处理；目录服务不得绕过。
- `output_token_continuation` 恢复轮不追加公告，避免续写请求插入新的上下文。
- MCP 初始化完成、`getTurnTools` 成功后执行；随后才处理 plan_mode_exit、runtime_mode、
  todo、output_style 等既有提醒，因此目录提醒位于这些提醒之前。
- 消息顺序：`persistSyntheticUserNoticeForSession` 成功后才提交到 turn/权威历史；
  持久化失败时本轮不提交，下一请求会重试，不会误判为已通知。

## 去重与增量

收集器从历史 attachment 重放 `addedTypes`/`removedTypes` 得到 `announced` 集合，再与当前
active 集合作差：

- 无新增且无移除：不产出 attachment。
- 同一类型先添加后移除再添加：按最后一次移除后的状态重新视为新增。
- 已通知集合中的类型在配置中消失：产出移除提醒，并从集合删除。
- `isInitial` 仅在历史中没有有效 delta 时为真；损坏或旧格式 delta 视为未通知。

## 持久化与恢复

- 提醒以 `source = "agent_listing_delta"`、`visibility = model-only` 的 synthetic user
  notice 落库，`metadata.runtimeMessage.agentListingDelta` 保存结构化增量。
- 冷恢复 `hydrateMessageHistoryFromSession` 校验并回填 delta；非法 delta 丢弃但保留原提醒文本。
- 相同提醒在 provider wire 上只渲染正文；metadata 不得进入模型请求（与既有 synthetic notice 一致）。
- 压缩：`compactActiveConversation` 用保留尾部重新收集目录，并把结果放在 post-compact
  reminder 首位。压缩丢弃历史提醒后，未通知类型会以首次/新增形式重新公告。

## 失败与幂等

- 解析 `agentListingDelta` 是纯函数：字段类型、长度对应、重复名称、added/removed 交集任一不满足即拒绝。
- 历史克隆深拷贝 delta，调用方修改副本不会污染权威历史。
- 同一 `TurnRequestState` 内重复收集会看到刚提交的 attachment，因此不会重复产出。

## 验收场景

1. 首轮存在 Agent 工具：模型请求前恰好一条初始目录提醒，包含全部 active 类型、并发提示；
   Agent 工具描述不含类型列表。
2. 连续两轮 profile 不变：第二轮不新增目录提醒。
3. 会话中途新增 profile：下一轮只提醒新增类型，标题为 `New agent types are now available ...`。
4. 移除 profile：下一轮只提醒移除类型并附 ambient context 说明。
5. 同时新增与移除：先新增段、后移除段；名称分别排序。
6. 冷恢复：重新加载后不重复公告已通知类型；损坏的 delta 不会导致误判为未通知。
7. 压缩：压缩后的首个请求重新包含当前目录，且仅包含压缩后仍需要补公告的类型。
8. Agent 工具被 turn 级隐藏：不产生目录提醒。
9. output token 续写：不插入目录提醒。
10. provider wire：提醒正文位于 `<system-reminder>` 内，无新工具名/新角色，metadata 不可见。

## 非目标

- 不引入 ToolSearch / `shouldDefer` 或任何按需工具发现机制。
- 不修改 ApplyPatch、Bash 执行、workflow 或 UI。
- 不改变 Agent 工具的参数、权限、后台执行与 SendMessage 语义。
