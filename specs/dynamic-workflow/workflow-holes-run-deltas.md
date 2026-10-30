# Dynamic Workflow 留白（Holes）与 run 状态增量

状态：第二切片，对应上游 ZCode v3.15.1（aac47556）/ 0a1fc56d 的留白与 run 进度增量部分。
范围：`hole<T>()` 的编译期规则、引擎停驻/补全、`FillWorkflowHole` 工具与端口、留白通知、空闲提醒，以及 `workflowRuns` 状态键的键级增量、有界表与淘汰。
不包含：内置技能、`/workflow`、技能门、默认并发与 retune、seat gate（已在 `workflow-skill-command.md` / `concurrency-retune.md` 中实现）；模型绑定（`model()` / `ModelRef`）、streams（channel / future）、persona、ToolSearch、MCP Apps、侧栏、增量 Markdown 与 compaction。

## 1. 留白：产品规则

### 1.1 语法与站点

```ts
hole<T>(name, prompt?)                 // 开放
hole<T>(name, body)                    // 已补全
hole<T>(name, prompt, body)            // 两者都有
```

- 站点 id 是**名字键** `hole#<8 位十六进制>`（FNV-1a 32 位，按 Unicode 码点，名字先 trim）。与嵌套深度无关；补全在脚本中间插入代码时，任何已有站点 id 都不变。
- 留白占全局站点 `order`；已补全留白的函数体在**一套全新的、带 `<holeId>/` 前缀的 per-kind 计数器**下走查：`hole#a91f3c07/ask#1`。前缀只有一层，嵌套关系记在 `HoleSite.fill` 上，不进 id。
- 开放留白是一个站点（图里的 `hole` 节点、车道 `main`）与一个**无成员阶段**（id = 站点 id，名字 = 字面量）。已补全留白不是一步，只是一个阶段；其函数体原地执行。
- `return await hole<T>(...)` 是尾留白（`tail`）：脚本的结尾是开放的。

### 1.2 编译期规则 9012

以下任一成立即脚本不可提交（`collectHoleDiagnostics`）：

1. 显式类型实参必须写出（`unknown` 不是契约）。
2. 名字是非空字面量，≤128 字符，且在脚本的留白与 `phase()` 标记中**唯一**。
3. 调用必须被 `await`。
4. 不能落在 fan-out 回调里（数组方法回调）；`for...of` / `for` / `while` 体允许。
5. 函数体必须是内联函数字面量（lowering 要把它打印成补全文本）。
6. 函数体不得引用留白之后才声明的、未被提升的绑定（TDZ）。

两个不同名字哈希撞车时（概率约 1e-7）报错，绝不猜。

### 1.3 时序走查

- 开放留白：先 `issue`（落在所站阶段），再 `mark` 到它自己的阶段，形成「所站阶段 → 留白 → 下一阶段」。
- 已补全留白：只 `mark` 到它自己的阶段，然后把函数体当作进入过的、once 的、不延迟的回调原地内联（async → strand）。体内标记的阶段带 `fill` 指回该留白；留白自己的阶段 `fill` 指向**包着它的**留白。
- 阶段编号 `phase#N` 只数标记：留白阶段用站点 id，不让编号跳号。

## 2. 引擎：停驻与补全

### 2.1 状态所有者

| 组件 | 拥有的状态 | 职责 |
| --- | --- | --- |
| `HoleRegistry`（引擎实例内） | 站点 → 停驻分支列表；站点 → 本世补全记忆 | 停驻 promise、放行、拒绝、`open()` / `filledList()` |
| `WorkflowEngine.askSpecs` / `sitePhases` | 每 ask 规格表、站点出生阶段表 | 一次补全整份替换为有效脚本的表 |
| `RunRegistryEntry.scriptText` / `holes` / `phaseNames` | 宿主侧内存副本 | 补全串行链读取「当前有效脚本」；快照投影读类型/行/前后阶段 |
| `JournalStorePort.updateRunScript` | `dwf_run.script_text` / `script_hash` | 有效脚本的唯一持久家 |

### 2.2 事件序列

```text
脚本 await hole(...)
  └─ engine.hole(siteId, name, prompt)
       ├─ state.nextOrdinal(siteId)         （出生阶段：sitePhases 优先，currentPhase 兜底）
       ├─ holes.remembered(siteId)?         （本世已补过：立即以记住的代码作答，不停驻、不记事件）
       ├─ holes.park(instance, name)        （先停驻）
       └─ record("hole-reached")            （再记事件 + driver.emit；通知消费方据它入队）

FillWorkflowHole(run_id, hole_id, script|path)
  └─ port.fillHole（bootstrap 的 fillDynamicWorkflowHole，同 run 串行）
       ├─ 读 run 当前脚本 → collectSites → 找到开放留白
       ├─ spliceHoleBody（拼成最后一个实参）
       ├─ analyzeWorkflowScript（9012 + 全部 authoring 规则）
       ├─ checkSiteStability（老 id 一个不少，新 id 全在本次补全内）
       ├─ compileProgram（站点表 / schema / lowering）
       ├─ entry.control.fillHole({ code, script, askSpecs, sitePhases, phaseNames, holes? })
       │    └─ 同步步骤：换表 → journal.updateRunScript → record("hole-filled") → 记住代码 → 放行
       └─ 成功后：entry.scriptText/holes/phaseNames 换新；草稿就地改写（原本无草稿时先铸一份）
```

- **拒绝即零副作用**：`run_not_found` / `hole_not_waiting` / `compile_failed`（带诊断）/ `fill_ids_unstable`（宿主故障）都不拼接、不落库、不记事件，留白照旧等待。
- 没有草稿的 run 在引擎之前先铸草稿（`hole-filled.scriptPath` 随事件落 journal）；引擎随后拒绝时删掉这份本次独占创建的文件。
- **留白没有 journal 行**：`hole-reached` / `hole-filled` 只是事件。resume 重放有效脚本，已补全的函数体内联执行、shim 不过线，`hole-reached` 不再出现；仍在等的留白会重新到达并再记一条。

### 2.3 沙箱

- lowering：`hole<T>(n, p?, body?)` → `__host.hole(siteId, n, p ?? void 0, (__src) => eval(__src), body?)`。
- 已补全的函数体直接调用，不过线；开放留白在 cell 内发 `request { type: "hole" }`，父进程停驻，补全后以 `{code}` 应答；同站点再次到达（循环）直接求值记住的文本，不再过线。
- `holeBodies[siteId]` 是 lowering 打印、擦除后的 `(async () => { … })` 文本，与主体同一趟 transform；现补与日后重放执行逐字节相同的文本。

## 3. 读面与通知

- `DynamicWorkflowRunSnapshot.holes` / `RunDetail.holes` / `GetWorkflowRun.holes`：≤32，零条整字段缺席。`waiting` **只从引擎停驻表投影**（进程亡故后没有 promise 在等）；`filled` 来自事件。`type` / `line` 来自当前有效脚本的编译产物，`before` / `after` 来自当前阶段表的邻居。
- 截图事件映射：`hole-reached` → 一条 `<workflow-hole>` 通知（`workflowNotification.kind = "hole"`，prompt ≤4000、类型/草稿/行/前后阶段来自快照）；`hole-filled` **不发通知**（回执就是工具结果）。
- 空闲提醒：`WorkflowBlockedReminderClock` 只看状态——父会话空闲且某个在飞 run 仍有 `pendingQuestions` 或 `waiting` 的 holes，就到点再提醒一次（15 分钟、30 分钟，每个 run 至多两次，入队即计数）。开集变化事件（`escalation-raised/resolved`、`hole-reached/filled`）重新计数；命令开始即停钟，用户发言（无合成来源）重置。载荷 `workflowBlocked` 是 `originMeta` 上的独立键，不是 `workflowNotification` union 的成员（闭集多一个 kind 会让旧客户端整帧解析失败）。

## 4. `workflowRuns` 键级增量

### 4.1 为什么

`workflowRuns` 是高频状态键；整键替换让每条引擎事件重发整张表（O(N) 字节/事件、一条 run 全程 O(N²)），也是节点/子代理上界压到 256 的根因。键级增量让线上字节数与**改动量**成正比。

### 4.2 协议形状（`ycode-protocol-v4`）

- `workflowRun.updated`：`{ runId, revision, run?, cleared?, removedActors?, removedNodes?, actors?, nodes? }`。
  - `run` 是 **header**（`workflowRunSchema` 去掉 `actors` / `nodes`）的部分更新：在场键整键替换，不深合并。
  - `cleared` 说哪些 header 键变成缺席（零条 ⇒ 键缺席的协议约定）。
  - `removedActors` / `removedNodes` 按 `(siteId, ordinal)` 删条目；`actors` / `nodes` 按同一键整条 upsert。
  - **施加序：header → 删除 → upsert**（同一键删了又加必须落到表尾）。
- `workflowRun.removed`：`{ runId, revision }`。只有生产者淘汰；客户端永不自行施加上界。
- `applyConversationDelta` / `applyConversationDeltas`（及 mutable 孪生）都转调 `workflow-runs-delta.ts` 的 `applyWorkflowRunUpdated` / `applyWorkflowRunRemoved`，两条路径语义一致。

### 4.3 连续性契约

对任意一对 reducer 产出的 `(prior, next)`：

```text
JSON.stringify(applyAll(带 prior 的快照, diff(prior, next)).workflowRuns) === JSON.stringify(next)
```

逐字节，不只是深相等。键序由 `canonicalWorkflowRun`（schema 声明序）在归约与增量两侧同时保证。

### 4.4 有界表与淘汰

- 单条 run：`maxActors = maxNodes = 1024`；整个状态键 `maxTotalEntries = 6144`（所有 run 的 `nodes + actors` 之和）；最近 `maxRuns = 8` 条。
- 触界语义是**拒新、仍更新已有**：把一个正在跑的实例的相位冻结在 `queued` 比少列一个实例更误导。被拒实例仍可数：`usage.nodesUnlisted` / `nodesUnlistedSettled` 与 `unlistedByPhase` 的出生阶段分格。
- 腾位：终态条目让位；**在跑的条目绝不让位**；actor 与它名下全部节点整组走（否则会派生成永远 pending 的徽章）；带不进自己节点的已完成 actor 不上表（孤儿规则）。`node-dispatched` 也是一次入座机会（「重要」发生在派活那一刻，不是入队那一刻）。
- 跨 run 预算只淘汰**终态** run，绝不动在跑的 run，也绝不动事件所属的那条。

### 4.5 双链语义

- `desktop-continuous`：认得 `workflowRun.*` 增量，直接收 compact op；快照发全量（`maxActors/maxNodes = 1024`）。
- `web-remote-replayable`：默认按**旧消费者**编码——一批里所有 `workflowRun.*` 丢掉，在最后一条的位置补 `state.updated { workflowRuns: clampWorkflowRunsForLegacy(...) }`（压回 256），快照同样裁到旧界。快照与增量必须同一档，否则 `.max(256)` 会让整帧解析失败。
- 能力位由可信 host 从连接身份注入；缺省 false。sessions-index 的既有 throttle 不变。

## 5. 重放

- 引擎 resume 从 journal 重放：`hole-reached` 无行、有效脚本内联已补全体；仍在等的留白重新到达、再记事件。
- 快照投影的 `waiting` 来自本进程引擎停驻表；冷行（无条目）从事件与行里的脚本重建编译事实表，`waiting` 一律不成立，`filled` 来自事件。
- `workflowRuns` 的 live 与冷回放共用同一份 reducer；增量只改传输编码，不改归约结果。恢复回放时旧消费者折叠取**当前投影终态**，中间态被跳过、终态一致。

## 6. 验收

1. `hole<T>("choose", "…")` 被分析器识别为开放留白；缺少类型实参 / 未 await / 落在 `.map` 回调 / 非内联体 / 重名 / 引用后声明绑定均报 9012。
2. 补全后：原站点 id 逐字不变；新站点带 `hole#<hash>/` 前缀；开放留白表为空；有效脚本可编译。
3. 引擎在 `hole()` 处停驻：`hole-reached` 恰好一条、`FillWorkflowHole` 放行后 `hole-filled` 一条且同一同步步骤写回脚本；重复补全 / 已结算 / 未知 id 都是结构化拒绝且零副作用。
4. `GetWorkflowRun.holes` 在等待时给出 `waiting` 与 `type`/`line`/`before`/`after`，补全后给出 `filled` 与 `filledAt`/`filledBy`；零条时字段缺席。
5. 留白通知行出现并点名 `FillWorkflowHole` 与 `hole_id`；`hole-filled` 不再发通知；空闲提醒每个 run 至多两条。
6. 对同一 run 连续多条事件，`diff → apply` 与 reducer 直接产出的 `workflowRuns` 逐字节相同；`desktop-continuous` 收 `workflowRun.updated`，`web-remote-replayable` 收折算后的整键 `state.updated` 且快照被裁到 256。
7. 宽 fan-out 撞界后：在跑实例仍在表上、终态实例让位、被拒实例在两个计数器与出生阶段分格上可数；跨 run 预算只淘汰终态 run。
