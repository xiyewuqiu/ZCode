# Dynamic Workflow 并发默认值与就地重调（Retune）

状态：首切片，对应上游 ZCode v3.14.3 / v3.15.1 的并发与 retune 变更。
范围：默认并发、用户并发上界、进程级治理器的增长上界、在飞 run 的就地并发重调、座位闸门（seat gate）的基本语义。
不包含：留白（holes）、协议 delta / 表 / 淘汰、内置 dynamic-workflows 技能、`/workflow` 命令、厂商与账号逻辑。

## 1. 两个界：默认并发 D 与 run 上界

### 1.1 默认并发 D

`D = max(4, min(16, availableParallelism() - 2))`，每进程计算一次，供 run service、launch、snippet、legacy Workflow 与治理器共用。

- `D` 是**起点**，不是上限。没有设置 `max_concurrency` 的 run 跑在 `D` 上。
- 地板为 4：子代理的瓶颈通常在远端 provider，而不是本地核；小机器 / 小远端不应只放行一两个子代理。
- 硬顶 16 只约束默认值的推导，不约束用户显式给出的上界。

### 1.2 用户 run 上界

请求值到生效值只有一条归一规则：

```text
normalize(requested, D):
  requested == undefined 或非有限数 -> D
  否则 -> max(1, floor(requested))      // 没有上限
```

- 高于 `D` 与低于 `D` 同样生效；用户要 40 就得到 40。
- `null`（Amendment 的三态解除）在端口侧等价于缺席，落回 `D`。
- 提交、修订、retune、GUI 设置读取同一规则，避免同一个数经两条路得到两个值。

### 1.3 生效位置

一个 run 的并发由三处共同执行，但只有一个所有者：

| 组件 | 拥有的状态 | 职责 |
| --- | --- | --- |
| `WorkflowEngine.caps` | 本 run 的 caps 快照 | 调度器每次派发前现读；`setMaxConcurrency` 整份替换 |
| `WorkflowRunSeatGate` | `working` / `parked` 集合 | 已派发 ask 的**下一次 turn step** 准入 |
| `WorkflowConcurrencyGovernor` | provider key 桶的 AIMD cap + run 登记上界 | 进程级共享 provider 配额 |

run service 的注册表条目持有**唯一**的内存 run 上界副本（`RunRegistryEntry.maxConcurrency`），快照、详情、`AmendWorkflow` 的沿用判定都读它；journal 的 `dwf_run.caps_max_concurrency` 是持久副本。launch 前由条目兜底，launch 后以条目为准并同步写 journal。

治理器桶的自动增长上限为：

```text
growthLimit = max(2 * D, max(所有用过该 key 且登记过上界的在飞 run 的上界))
```

用户在某个 run 上把上界调到 32 时，该 run 用过的 provider key 的增长上限随之抬到至少 32，并尝试一次 `seed` 起跳；否则调度器放出 32 个子代理，治理器只给 `2D` 张票，大半会停在「等待槽位」。run 结算时 `clearRunBound`，桶按剩余 run 重算上限。

## 2. 就地 retune（AmendWorkflow 的并发专用路径）

### 2.1 路由条件

只有同时满足以下条件才走 retune：

1. 入参形状**只**包含 `run_id` 与 `max_concurrency`；出现 `script`、`path`、`subagent_model`、`name` 任一即走完整修订。
2. `resolveInput` 已读到前驱快照，且状态为 `pending` 或 `running`。
3. 宿主端口实现了 `retuneConcurrency`。

`resolveInput` 命中后返回**不含脚本**的归一化入参，并回填 `predecessor`。确认窗对无脚本的调用放行（`prepareApproval: proceed`）。完整修订路径保持不变：停前驱、铸新 run、导入缓存。

### 2.2 端口语义

```text
retuneConcurrency({ runId, maxConcurrency: number | null })
  -> { ok: true, maxConcurrency, previous, defaultConcurrency }
   | { ok: false, reason: "not_live" | "unchanged", current? }
```

成功时：

- runId 不变；
- 不铸后继、不 supersede、不导入缓存；
- 在飞 ask 不取消、不重跑，转录与升级问答保持原位；
- 不产生后台任务登记。

失败使用结构化 `reason`，不抛出业务错误：

- `unchanged`：新值与此刻生效值相同。什么都不写、不发事件；`current` 是生效值。
- `not_live`：本 service 的注册表没有这个活条目（非本进程 run、已结算、无控制面的旧条目），或 run 在校验与调用之间结算。调用方回落到完整修订，是否允许由所有权规则决定（见 2.5）。

### 2.3 同步片与事件顺序

一次成功的 retune 在一个同步片里完成，任一步失败则前面不产生可观察的部分状态：

```text
端口归一 next = normalize(requested, D)
  -> 读 entry，判活（terminal / control 缺席 => not_live）
  -> 读 current = entry.maxConcurrency ?? journal.caps ?? D
  -> current == next => unchanged（无写入）
  -> control.setMaxConcurrency(next):
       1. 引擎：runSettled ? false : 换 caps 快照
       2. journal.updateRunCaps(runId, caps)     // resume 沿用新值
       3. record({ type: "run-caps-changed", caps, previous })
       4. next > previous => scheduler.pumpAll() // 抬高时重新派发排队 ask
       5. 成功 => seatGate.setLimit(next)
       6. 成功 => governor.setRunBound(runId, next)
  -> entry.maxConcurrency = next
```

顺序是载荷性的：引擎先裁决（`false` 表示什么也没发生），座位闸门与治理器只在引擎确认后跟随，三处不会各执一词。引擎替换 `caps` 对象而非原地修改，已写入 `run-started` / `run-caps-changed` 的历史值保持不变。

### 2.4 幂等与竞态

- 同一值重复 retune：第二次返回 `unchanged`，journal、事件流、座位闸门、治理器均无变化。
- 并发 retune：Node 单线程同步片天然串行；后到者读到的 `previous` 是前者写入的值。
- run 结算竞态：引擎 `setMaxConcurrency` 返回 `false` 时不改内存副本、不换闸门/治理器上界，端口返回 `not_live`。
- 结算与 retune 竞争不会留下「条目上界与 journal 行不一致」：先写 journal 与事件，成功后才挪内存副本。
- resume 使用 `record.caps.maxConcurrency`（可能已被 retune 改写），并把该值抄进新条目。

### 2.5 回落与拒绝

端口答 `not_live` 后，handler 重新读一次快照：

- 快照不存在：`run_not_found`。
- 前驱属于本会话且不是用户亲手停下：按完整修订继续；脚本与编译推迟到这一刻才发生。
- 前驱属于别的会话，或用户停过它，仍处于 `pending` / `running`：`not_retunable`。
- 前驱已结算且不满足回落条件：`run_settled`。

这三个拒绝与 `retune_unchanged` 都是结构化失败，文案明确「什么都没停、什么都没建」；不能把一次「什么都没批准」的调用升级成另起一次 run。

### 2.6 模型面回话

成功回话必须自足，因为 retune 不产生 display 载荷、也不跨 v4：

- 点名 runId；
- 点名生效上界；等于 `D` 时注明「（默认）」；
- 明确「run 仍在运行，什么都没停，也没有启动新 run」。

## 3. 座位闸门（seat gate）

调度器只在派发时看上界；一个已派发的 ask 可能还要跑数分钟。压低上界时，超出上界的子代理在**下一个 turn step** 前停住，而不是被取消。

- 纯函数：不读时钟、不做 I/O、不订阅；只接收 driver 已观察到的「谁有在飞 ask」「谁有工具在跑」。
- 与调度器零共享状态。`activeAsks = working + parked`，停驻者的 ask 仍然占调度器的名额，因此调度器不会插到停驻者前面。
- 工具侧请求永不停驻：`toolsInFlight() > 0` 的请求直接放行，避免工具请求排在自己后面。
- 抬高上界按 FIFO 立即放行到新上界；压低不召回任何在飞请求。
- abort 时停驻者回到 `working`；`node-settled` 是 ask 的唯一终点。上界 ≥ 1 保证不死锁。
- 从未被 retune 压低过的 run 走快路径，行为与没有闸门时逐字相同。

## 4. 日志与持久化

- `run-caps-changed` 是 journal 事件，载荷带 `runId`、`caps`、`previous`；它是 retune 的唯一审计事实。
- 协议层的 delta / 表 / 淘汰不在本切片；UI 暂不消费该事件。
- 不在日志中写凭据、真实用户数据或内部服务地址。

## 5. 验收场景

1. **默认值**：`availableParallelism()` 返回 2/4/6/32 时，`D` 分别为 4/4/4/16。
2. **用户上界高于 16**：`normalize(40, D)` 为 40；`CreateWorkflow` 与 `AmendWorkflow` 均不再把 40 压成 16。
3. **提交**：未给 `max_concurrency` 的 run，`dwf_run.caps_max_concurrency == D`；给 40 时为 40。
4. **就地 retune 成功**：对在飞 run 只传 `run_id` 与 `max_concurrency`，runId 不变，无新 run 行，无 `superseded`，在飞 ask 转录不丢；`run-caps-changed` 恰好一条；journal 的 caps 列更新；引擎调度器看到新值。
5. **幂等**：紧接着用同一个值再调用，返回 `unchanged`，journal 与事件流无新增，闸门与治理器上界不变。
6. **空值解除**：`max_concurrency = null` 落回 `D`；若当前已是 `D`，返回 `unchanged`。
7. **结算竞态**：run 已结算时 retune 返回 `not_live`；本会话的 run 回落完整修订并产生新 run；他人 / 用户停过的 run 返回 `not_retunable` / `run_settled`，什么都不建。
8. **座位闸门**：若 8 个 ask 在飞、上界从 8 降到 2，6 个子代理在各自下一个 turn step 前停驻；工具调用仍在飞时不误停；上界抬回 8 后按 FIFO 全部放行。
9. **治理器增长**：把 run 上界调到 32 后，其 provider key 的 `growthLimit >= 32`，并在未近期被限流时 `seed` 到 32；run 结算后上限回到 `max(2D, 剩余 run 的上界)`。

## 6. 明确不做

- 不移植 bundled dynamic-workflows 技能与 `/workflow` 命令。
- 不移植留白补全、协议 delta / 表 / 淘汰。
- 不改动 vendor/account 代码。
- 不改动 core 的 agent-listing、ApplyPatch、Bash exec 或 UI 组件。
