# 子代理功能迭代设计

> 2026-10-03。基于五路深度联网调研（Claude Code / OpenAI 生态 / 编排框架与理论 / 竞品实现 / 可观测性与交互）与 ZCode 当前源码的对照。
>
> 本文是**设计契约**，不是实现。落地前按阶段各自补行为 spec，明确产品规则、状态所有者、接口与验收场景后再动代码（AGENTS.md）。
>
> 证据等级：**[确认]** 一手文档/原文；**[报道]** 可信二手；**[推断]** 多源综合外推；**[未验证]** 单一弱来源。

## 0. 结论速览

1. **ZCode 的子代理底座已经很强，方向正确**：内置 `Explore`/`general-purpose`、用户与插件定义 agent、子代理目录 + transcript 侧栏、后台子代理、消息 steering、coordinator 响应、持久记忆、child 工具策略、CUA 策略、`inactivityTimeoutMs`/`autoBackgroundMs`/`maxTurns`/`outputRootDir` 配置——研究里"建议做"的很多项已经落地。
2. **业界已收敛到一个共识**：编码场景的可靠形态是 **agent-as-tool（主代理保留控制权）+ 只读子代理并行 + 写操作单线程**。Cognition 从"别做多代理"修正为"写保持单线程、其他 agent 只贡献智能"；Anthropic、Claude Code、Cline、Amp、Copilot Local、OpenCode 全部落在这一形态。ZCode 正好在这条线上，**不要往 swarm / group chat 走**。
3. **ZCode 最该补的不是"更多代理类型"，而是四件事**：
   - **硬上限三件套**（嵌套深度 / 并发数 / 每轮总量，以及可选花费预算）——所有调研里唯一的"必做且立刻做"项，直接对应 Claude 的头号痛点（单子代理 234 次工具调用、1.5 小时、>124K token，主代理运行时不可见）。
   - **显式上下文契约**（`contextMode: isolated | fork`）——当前只有 isolated；LangChain/Claude 都已明确 fork 的适用面。
   - **结果契约**（结构化摘要 + artifact 引用，而非全文回灌）+ **回灌前的注入扫描**。
   - **可观测性**：状态三通道（颜色+图标+文案）、层级/分组、逐子代理 token/成本归属。
4. **成本必须被正视**：Anthropic 实测多代理 ≈ **15×** chat token（单 agent 已 ≈ 4×），token 用量单独解释 80% 的性能方差。多代理是"花 token 换结果"，低价值任务不值得。
5. **不要做**：无界嵌套、非结构化 swarm、全量 worktree 隔离、无外部信号的自我评审。

## 1. 研究结论（分维度，带硬事实）

### 1.1 定义与配置模型

- Claude Code：`.claude/agents/*.md`，YAML frontmatter，`name`/`description` 必填，body 即 system prompt。字段含 `tools`/`disallowedTools`/`model`/`permissionMode`/`maxTurns`/`skills`/`mcpServers`/`hooks`/`memory`/`background`/`omitClaudeMd`/`effort`/`isolation(worktree)`/`color`/`initialPrompt`。[确认]
- 优先级：Managed > CLI/session > project > user > plugin；SDK 程序化 `agents` 覆盖同名文件。[确认]
- **description 占用主上下文**：所有自定义 description 合计 >15,000 token 启动告警。[确认]
- 解析健壮性：缺 `name`/`description`、首行非 `---`、`name` 含 `:`、YAML 失败 → **静默跳过 + debug log**。[确认]
- OpenAI Codex：`.codex/agents/*.toml` 独立文件；内置 `default`/`worker`/`explorer`；`[agents]` 含 `max_concurrent_threads_per_session`、`default_subagent_model`、`default_subagent_reasoning_effort`。[确认]
- 模型解析优先级（Codex）：显式 spawn 值 → `[agents]` 默认 → 父代理值。[确认]

### 1.2 上下文与结果传递

- **父→子只传派发 prompt**：非 fork 子代理不继承父对话历史与父 system prompt，只继承项目说明（CLAUDE.md/AGENTS.md）与工具池子集。[确认]
- **父只收最终消息**，中间工具调用留在子上下文；父可能再摘要，要逐字保留需显式要求。[确认]
- **回灌前扫描**（Claude v2.1.210+）：中和控制标签仿冒、标记权限配置提及、转义 turn marker，**从不删除或改写子代理文本**。[确认]
- **API 错误绝不作结果回传**。[确认]
- LangChain 两种上下文模式：**isolated**（全新上下文，只拿任务描述）vs **fork**（继承主管完整对话，切除尾随 tool call）。选择准则：worker/fixer 用 fork（复用 prompt cache、避免重复取证）；verifier/researcher 用 isolated（保持判断独立、并行不重复历史）。[确认]
- Anthropic：结构化产物写文件系统 + 传轻量引用，减少"传话游戏"的信息损失与 token 开销。[确认]

### 1.3 硬上限与可靠性

| 控制 | Claude Code | OpenAI | 其他 |
| --- | --- | --- | --- |
| 深度 | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 默认 **3** | API 不限深度 | Copilot 默认关闭、开启后 **≤5**；Cline/OpenCode `general` 不能再派 |
| 并发 | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` 默认 **20** | `max_concurrent_subagents` 默认 **3** | Codex `max_concurrent_threads_per_session` |
| 预算 | per-run `maxBudgetUsd` | — | — |
| 轮数 | `maxTurns` → 超限标记 **partial** 且可 resume | — | LangGraph `recursion_limit` 25；CrewAI `max_iterations`；ADK `LoopAgent max_iterations` |

[确认]

- Anthropic 早期失败模式：为简单查询派生 **50 个子代理**。[确认]
- 子代理成本溢价实测：2 个 ≈ 2.6×，5 个 ≈ 3.2×，fan-out 峰值 5.9×。[报道]
- MAST：1600+ traces，多代理失败率 41%–86.7%，协调故障占 36.9%。[报道]

### 1.4 编排范式（选择准则）

| 模式 | 机制 | 适用 | 风险 |
| --- | --- | --- | --- |
| agent-as-tool（ZCode 现状） | 子代理是函数，结果回中心，上下文隔离 | 多域并行分析、只读探索、可验证任务 | 主代理需判断何时委派；子代理缺上下文易误解 |
| handoff | 控制权转移，同一时刻单活跃代理 | 多阶段对话、路由 | 串行、难汇总、路由僵硬 |
| group chat / swarm | 共享线程、互相通信 | 头脑风暴/辩论 | 循环、上下文膨胀、>3 难控 |
| blackboard | 共享白板，按订阅触发 | 结构化中间产物、长任务 | 写并发冲突 |
| orchestrator-worker | 中心拆解+并行+聚合 | 广度优先研究 | telephone 转述损耗、同步阻塞于最慢子代理 |

[确认]

- **Anthropic 实测**：orchestrator-worker 在广度优先检索比单代理高 **90.2%**，但多代理 ≈ **15×** token。[确认]
- **Cognition**：2025「Don't Build Multi-Agents」（共享完整 trace；action 携带隐式决策）→ 2026「写操作单线程，其他 agent 只贡献智能」，否定非结构化 swarm。[确认]
- **handoff vs agent-as-tool 准则**（OpenAI）：需要专家**接管对话**用 handoff；需要专家帮**有界子任务、控制权留主管**用 agents-as-tool。[确认]
- **外部信号是关键**：《LLMs Cannot Self-Correct Reasoning Yet》证明无外部反馈的自我纠正无效甚至更差 → critic 必须接测试/工具/异构模型/独立上下文。[确认]

### 1.5 竞品实现要点

- **Cursor**：用户级并行 agent + `/best-of-n` 竞速；**git worktree 隔离**（`.cursor/worktrees.json` 定义 setup 命令、`worktreeMaxCount` 默认 25）；Plan Mode 的 Markdown plan 含文件路径与待办。[确认/报道]
- **Cline**：只读 Sub-Agents（独立 context、无编辑/MCP/嵌套、返回"最相关文件路径"）+ Teams（跨 session 任务板/mailbox/mission-log）；**每个 subagent 的 token/成本单独追踪并滚入任务总成本**。[确认]
- **Roo Code**：Boomerang Tasks（Orchestrator 派发子任务、父暂停、只回 `result` 摘要；Orchestrator 刻意限制为无读写以防上下文污染）。[确认]
- **Kilo**：agent 自动 `task` 委派 + Swarm 共享 board；**共享父目录、不隔离文件写**。[确认]
- **OpenCode**：`primary`/`subagent`/`all`；权限可精确到 `subagent:<id>` allow/deny；内置 `general` **不能再派发**（防递归）。[确认]
- **Copilot/VS Code**：subagent 是 parent chat 内的**只读 chat**（锁图标），带 model/耗时/当前工具指示器，可并排；`agents:[...]` 白名单；**超主模型 cost tier 直接拒绝运行**。[确认]
- **Zed**：Threads Sidebar + 按 thread 可选 worktree；**当前直接把 subagent 跳过渲染**（社区批评：看不到 40–60% 活动）。[确认]
- **Amp**：固定专家 subagent（Search/Oracle/Librarian/Read Thread），独立 context、**彼此不能通信、无法中途引导、只回最终摘要**。[确认]
- **Devin**：Manager Devin + child Devins（内部 MCP 协调，map-reduce-and-manage）；**generator-verifier 刻意不共享 context**，干净 context 的 reviewer 平均每 PR 抓 ~2 bug、58% 严重。[确认]
- **Worktree 之争**：隔离派（Cursor/Zed/Windsurf）解决文件级冲突但 setup 成本高、**语义冲突无解**；共享派（Kilo/Cline/Copilot Local）叠加只读约束才安全。[确认/报道]

### 1.6 可观测性与交互

- Claude agent view 状态语义最完整：Working/Needs input/Idle/Completed/Failed/Stopped + 图标区分进程存活；行摘要用廉价模型生成（15s 节流）；空闲行 30s 隐藏、>3 折叠；按状态分组（needs-input 置顶）。[确认]
- VS Code：subagent 默认折叠的 tool call，默认开在独立 editor 而非父 chat 内联。[确认]
- **成本可视化**：Cline 逐子代理归属；Weave 的 agent card（Cost/Latency/Error rate/Spans/activity histogram）；LangSmith token 分 Input/Output/Other + cache_read/reasoning。[确认]
- **OTel GenAI 语义**：agent run = trace；`invoke_agent` 父 span + `chat`/`execute_tool` 子 span；`gen_ai.usage.*` 指标；Arize 用 `graph.node.parent_id` 声明层级。[确认]
- 可访问性：状态更新用 `role="status"`（aria-live polite）；**状态不能只靠颜色**（Claude 颜色+形状双通道）；reduced-motion；数字/时间走 Intl/ICU。[确认]

## 2. ZCode 现状（代码级）

**已有**（源码核查）：

- 定义：`AgentProfile`（`apps/zcode-cli/packages/core/src/subagent/profile.ts`）字段 `background`/`color`/`description`/`disallowedTools`/`injectAgentsMd`/`maxTurns`/`mcpServers`/`memory`/`modelSelection`/`name`/`permissionMode`/`skills`/`tools`；frontmatter 解析 `profile-frontmatter.ts`。
- 内置：`Explore`（只读工具白名单 `explore-tools.ts`）、`general-purpose`。
- 运行时配置：`subagents.{enabled, inactivityTimeoutMs, autoBackgroundMs, backgroundBashMaxMs, maxTurns, outputRootDir, profiles, builtInModelSelectionOverrides}`（`runtime/types.ts:137-147`）。
- 端口：`SubagentPort`（launch/run/start/backgroundTask/sendMessage/stop...），任务快照状态机 `running/completed/failed/cancelled/killed/stopped/lost`，`outputFile`、`notified`（`contracts/src/interfaces/subagent.port.ts`）。
- 子代理模块：`runner.ts`（child runtime）、`context-builder.ts`（独立 child 上下文，**不含父历史**）、`system-prompt.ts`、`message-steering.ts`、`coordinator-response.ts`（`RESPOND_TO_COORDINATOR`）、`tool-event-mirror.ts`、`completion-notification.ts`、`persistent-memory*.ts`、`borrowed-mcp-port.ts`、`mcp-config.ts`、`computer-use-policy.ts`、`tool-policy.ts`（child 强制剔除 plan tools）。
- Registry：`InMemoryRuntimeTaskRegistry`（`runtime-task/registry.ts`）——**并发/总量上限的天然落点**。
- 派发：`tool/handlers/agent.ts` → `subagentPort.launch`（支持同一消息多个 Agent 工具并行、`run_in_background`）。
- UI：`SubagentDirectorySidePane`（虚拟列表、running + ended 分页、键盘、scope 隔离）、`SubagentSessionSidePane`（transcript）、`ConversationAgentToolCallRow`、`useSessionSubagents`。
- 另有 dynamic-workflow（多阶段 + run 卡）与 subagent 并列。

**缺失**（对照研究）：

1. 无**并发**上限、无**每轮总量**上限、无**花费预算**。（**嵌套深度无需处理**：子运行时以 `subagents.enabled: false` 创建，结构上不能再派生子代理——`runtime/methods/subagent.ts:285-287`。这比"深度上限"更彻底。）
2. 无显式 `contextMode`（当前恒 isolated，无 fork）。
3. 无 `isolation: worktree`。
4. 未见结果回灌前的注入扫描与"API 错误不作结果"的显式约定。
5. 未见子代理运行时的 token/成本归属与可见性（有 `outputFile` 但无汇总口径）。
6. UI 未见"层级/按需输入置顶/状态三通道/逐子代理成本"。

## 3. 差距表（价值 / 风险 / 工作量）

| # | 差距 | 价值 | 风险 | 工作量 | 依据 |
| --- | --- | --- | --- | --- | --- |
| D1 | 硬上限（并发 / 每轮总量 / 预算）+ partial 语义 | 高 | 中 | 中 | Claude 头号痛点、Anthropic 50-subagent bug、所有厂商都有；**深度已由"子运行时禁用 subagents"覆盖** |
| D2 | 显式 `contextMode: isolated\|fork` | 高 | 中高 | 中高 | LangChain/Claude fork；worker 复用缓存 |
| D3 | 结果契约（摘要+artifact 引用）+ 注入扫描 | 中高 | 中 | 中 | Claude 输出扫描；Anthropic artifact |
| D4 | 逐子代理 token/成本归属与 UI 展示 | 中高 | 低 | 中 | Cline/Weave/Copilot |
| D5 | UI 状态三通道 + 分组（needs-input 置顶）+ 层级 | 中 | 低 | 中 | Claude agent view、Zed 批评、WCAG |
| D6 | `isolation: worktree` 可选 | 中 | 高 | 高 | Cursor/Zed；但语义冲突无解 |
| D7 | critic 外部验证回路（并联 typecheck/lint/test） | 中高 | 中 | 中高 | 2310.01798 + Devin reviewer |

## 4. 迭代设计

### 4.1 P0 — 硬上限与部分结果（最高优先，防御性）

**产品规则**

1. 子代理有**两个运行时上限 + 一个可选预算**，**默认值**：`maxConcurrentSubagents = 4`、`maxSubagentsPerRun = 12`、`maxBudgetUsd?`（可选，缺省不限制）；均可按项目配置覆盖，`0` 表示禁用该维度校验。
2. **嵌套结构上已禁用**：子运行时以 `subagents.enabled: false` 创建，不能再生子代理，因此**无需深度上限**。若未来决定开放嵌套，必须在同一次改动里补 `maxSubagentDepth`（默认 3）——否则会重现 Anthropic 的树爆炸。[确认现状]
3. 到达并发/总量上限时：派发工具返回**明确的可读结果**（如 `Concurrent subagent limit reached (4/4)`），让主代理能感知并降级（等待/串行/放弃）。依据 Claude `Concurrent subagent limit reached`。[确认]
4. `maxTurns` 到限的子代理结果标记为 **partial**，不做静默截断；主代理可见 partial 并可（后续）resume。依据 Claude v2.1.246+。[确认]
5. 上限只约束**派发侧**；已运行子代理不被上限中断。
6. 计数口径：`RuntimeTaskRegistry` 中 `type === "local_agent"` 且非终态的任务；并发按"当前活跃"、总量按"本轮累计派发"分别统计。

**状态所有者**：`RuntimeTaskRegistry`（唯一持有活跃任务数与深度口径）。父会话所有者不变。

**接口**：`subagents.{maxSubagentDepth, maxConcurrentSubagents, maxSubagentsPerRun, maxBudgetUsd?}` 配置键；`subagentPort.launch` 返回结构在超限时携带 `limitKind`。

**验收**：单测覆盖 depth 到限移除工具、并发到限拒绝并回传可读原因、总量到限、partial 标记；不回归现有并行派发与后台派发。

### 4.2 P1 — 上下文契约与结果契约

**产品规则**

1. 新增 `contextMode: "isolated" | "fork"`（默认 `isolated`，保持现状行为）。
   - `fork`：子代理继承父会话**已提交**的对话历史（不含草稿/未提交输入），派发 prompt 作为新的 user 消息追加；完成时其最终消息作为原 tool call 的响应回传。用于"已诊断、只需实现修复"的 worker。
   - `isolated`：现状（`SubagentContextBuilder` 只组装 agentPrompt + env + skills）。用于 Explore/verifier/researcher。
   - 选择准则写入内置 agent 的默认值与文档。
2. **结果契约**：子代理回灌主会话的内容 = 结构化摘要 + **artifact 引用**（文件路径/`outputFile`），大产物写文件不灌回。父代理汇总时优先引用而非重写（避免 telephone）。
3. **回灌前扫描**：对子代理最终消息做控制标签中和、权限配置提及标记、turn marker 转义；**不删改原文**。API 错误提前结束的子代理，其结果**不作为结果投递**。
4. `fork` 模式必须尊重 prompt cache 语义（child system prompt 稳定前缀保留 cache breakpoint，ZCode 已有此机制）。

**状态所有者**：子代理上下文由 child runtime 持有；父会话历史仍是父 runtime 的唯一事实。fork 不复制可变状态，只读父的已提交消息快照。

**验收**：fork 子代理可见父历史且不含草稿；isolated 不泄漏父历史；扫描规则单测（仿冒标签/权限提及/turn marker）；API 错误不回传；大产物落 artifact 且父只拿引用。

### 4.3 P2 — 可观测性与成本

**产品规则**

1. **状态三通道**：颜色 + 图标/形状 + 文案，映射协议现有 7 状态；`running` 动画、`failed` 红、`stopped/lost` 灰、`completed` 绿；`lost` 单独语义（进程退出可重启）。
2. **分组与排序**：目录按状态分组，needs-input / 待处理置顶，working/completed 在后；保持现有虚拟列表与键盘导航。
3. **逐子代理 token/成本归属**，汇入 run 卡与目录行；模型分层可见（显示实际解析模型）。
4. **父时间线指示器**：agent 工具调用行显示"N 个子代理运行中 / 结果待输入"，尊重 reduced-motion。
5. 可访问性：状态变化用 `role="status"`（aria-live polite）；数字/时间走 Intl；状态不单靠颜色。

**状态所有者**：成本/进度由 CLI/runtime 产生，经现有 lease/投影只读下发；UI 的选中/滚动是局部状态。桌面 `desktop-continuous` 用"最新活动覆盖"，手机 `web-remote-replayable` 用"事件 list + snapshot 合并"，**不混用单一内存态**。

**验收**：目录分组的键盘可达；状态三通道在亮暗/窄屏/reduced-motion 下正确；成本归属数字与 runtime 口径一致（合成数据 fixture）；aria-live 播报。

### 4.4 P3 — 进阶（需单独评估）

- `isolation: worktree`：仅在确认需要"并行真写"时做；配套 setup 命令、detached HEAD、清理上限；**承认语义冲突无解**，需共享 decision/plan 文件。
- 共享 plan/todo：跨子代理的只读计划视图（对齐 Cognition "共享决策"与 Cline task-board）。
- critic 外部验证回路：只读 reviewer 子代理**必须接 typecheck/lint/test 的真实结果**（无外部信号的自我评审无效）。
- 路由短路：简单只读请求直接派 `Explore`，不进入完整编排（对齐 Bedrock routing、省成本）。

## 5. 明确不做（反模式）

1. **swarm / group chat / agent 间自由通信**——Cognition 明确否定；ZCode 走 agent-as-tool。
2. **全量 worktree 隔离**——setup 成本 + 语义冲突；只在写型并行按需。
3. **无界嵌套**——必须有深度上限。
4. **无外部信号的自评 critic**——必须接测试/工具。
5. **把原始中间输出灌回主线程**——会造成 context rot（Chroma 研究）。
6. **默认主动委派**——保持显式触发（用户要求或 AGENTS.md/skill 指令），避免成本失控。

## 6. 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 主代理委派不足/过度 | 委派判断由主模型做 | 内置委派启发式（按复杂度缩放投入）+ 明确 description |
| fork 复制上下文导致成本/污染 | fork 继承全历史 | 只 fork"已诊断的 worker"；fork 读父已提交快照，不复制可变状态 |
| 上限过严伤能力 | 复杂任务被截断 | 默认值可配置；超限回传可读原因让主代理降级 |
| 运行时改动不可 E2E 验证 | 无真实模型跑 | 单测覆盖 limit/partial/fork 分支；浏览器 fixture 覆盖 UI |
| 成本放大 15× | 多代理本质贵 | token/成本可见 + 预算上限 + 模型分层 + 路由短路 |

## 7. 建议实施顺序

1. **P0 硬上限三件套 + partial**（防御性，落 `RuntimeTaskRegistry`，单测可覆盖）。
2. **P2 可观测性**（UI 单侧，fixture 可验，先让成本/状态可见，再谈委派）。
3. **P1 结果契约 + 注入扫描**（安全）。
4. **P1contextMode fork**（成本/语义较重，需专门 spec）。
5. **P3 进阶**（按需）。

每个阶段落地前各自补行为 spec（产品规则/状态所有者/接口/验收），不在本文直接约束代码。

## 8. 关键来源

- Claude Code：https://code.claude.com/docs/en/sub-agents ; /agent-sdk/subagents ; /agent-teams ; /agent-view ; /hooks
- OpenAI：https://learn.chatgpt.com/codex/agent-configuration/subagents.md ; https://openai.github.io/openai-agents-python/multi_agent/ ; /handoffs/ ; /guardrails/ ; /sessions/ ; /tracing/ ; https://github.com/openai/swarm ; https://developers.openai.com/api/docs/guides/responses-multi-agent
- Anthropic：https://www.anthropic.com/engineering/multi-agent-research-system ; https://www.anthropic.com/engineering/building-effective-agents
- Cognition：https://cognition.com/blog/dont-build-multi-agents ; https://cognition.com/blog/multi-agents-working ; https://cognition.com/blog/devin-can-now-manage-devin
- LangChain：https://www.langchain.com/blog/organizing-context-in-a-multi-agent-harness ; https://www.langchain.com/blog/benchmarking-multi-agent-architectures ; https://docs.langchain.com/langsmith/cost-tracking
- 竞品：https://cursor.com/docs/configuration/worktrees ; https://docs.cline.bot/features/subagents ; https://docs.cline.bot/sdk/guides/multi-agent-teams ; https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks/ ; https://opencode.ai/docs/agents/ ; https://code.visualstudio.com/docs/agents/run/subagents ; https://zed.dev/docs/ai/parallel-agents ; https://ampcode.com/docs/models-and-subagents
- 框架/理论：https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns ; https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/ ; https://arxiv.org/abs/2303.11366 (Reflexion) ; https://arxiv.org/abs/2310.01798 (Self-Correct) ; https://arxiv.org/abs/2312.04511 (LLMCompiler) ; https://arxiv.org/abs/2503.13657 (MAST) ; https://arxiv.org/abs/2308.00352 (MetaGPT)
- 可观测性：https://opentelemetry.io/blog/2026/genai-observability/ ; https://arize.com/docs/ax/observe/tracing/agents ; https://langfuse.com/docs/observability/features/agent-graphs ; https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
