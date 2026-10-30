# 压缩 P0：版本化替换、投机压缩与保留边界

## 背景

现有 `compaction-quality.md` 已经保证压缩“先 masking、后摘要、再校验 shrink”。但当一次压缩
请求跨多个 await 执行时，历史仍可能被 steering、微压缩或另一个压缩流程改写；把旧快照的
结果整体回写会覆盖新消息。自然追问的第二个问题是：上下文在达到硬阈值前已经可以预测，
却只能在阈值点同步等待摘要生成。

本规范只覆盖 Codex P0 的三项能力，不改变既有摘要内容、阈值数值和 UI 投影：

1. 版本化、原子化的历史替换；
2. 阈值前的按会话投机摘要；
3. 保留最近输出时“整个保留或整个丢弃”。

## 产品规则

### 1. 历史代数（generation）

- 每个 runtime 持有一个单调递增的 `historyGeneration`，由
  `CompactionController` 唯一拥有。
- 只有一次**成功提交**的压缩替换会推进代数；普通追加、steering、工具结果不推进。
- 新的 compact boundary 持久化 `historyGeneration = 提交前代数 + 1`。
- resume / rewind 冷恢复后，从当前激活链上最后一个 compact boundary 恢复代数；旧数据没有
  该字段时按 0 处理。
- 提交前必须同时满足：
  - `controller.generation === baseGeneration`；
  - 投机候选的基准 entries 仍是当前 entries 的前缀（引用相等）。
- 任一条件不满足即视为 stale：不写 boundary、不替换历史、不推进代数，抛可重试的
  `InvalidStateTransition`；原始历史保持完整。

### 2. 前缀替换而不是整段覆盖

- 压缩开始时对 `activeEntries` 做浅快照，记录基准。
- 提交时如果当前 entries 只是“基准 + 新追加”，保留新追加的完整 suffix，接在压缩结果之后；
  不把并发产生的用户输入、assistant 输出或工具结果丢掉。
- 如果基准不再是当前 entries 的前缀（微压缩、rewind、另一个替换改写了前缀），判定 stale，
  整个结果丢弃，绝不部分应用。
- `messageHistory.replaceMessages` 是唯一的替换写入点；替换是同步的一次数组赋值，之后才
  推进代数。

### 3. 按会话的投机压缩

- 阈值：有效上下文窗口（扣除输出预留）的 65%，由
  `DEFAULT_SPECULATIVE_COMPACT_THRESHOLD_PERCENT` 定义，且低于现有 auto compact 硬阈值。
- 触发点：`autoCompactIfNeeded` 每次决策后，若当前 token 已达到投机阈值但未到硬阈值、
  消息数量足够、且没有连续失败，则启动一次投机摘要。
- 投机摘要只生成 summary 文本，不写 timeline、不写 boundary、不替换历史；它在后台随当前
  turn 继续执行，不阻塞模型请求。
- 每个会话同一 generation/model 只尝试一次投机摘要，同一时间只允许一个任务：
  - 已完成且当前 entries 与投机基准完全一致（没有追加、没有改写）：直接采纳，走正常提交路径；
  - 仍在执行或 turn 已经增长/改写基准：取消投机任务，按硬阈值重新同步压缩。
- 任何同步压缩（manual / auto / reactive）启动前取消投机任务，避免两个摘要请求并发。
- 进程关闭时取消投机任务；投机请求不写 session/timeline 事件，未采纳的摘要不会进入历史。

### 4. 只保留完整工具输出

- 活跃边缘仍按完整 round 选择，不切断 tool call / result。
- 在现有 10% / 50k / 4k tail 预算内，按“整个 round 放得下才保留”推进：
  - 最新 round 无论多大都整体保留；
  - 更旧的 round 如果整体超过剩余预算，整个丢弃并停止向更旧推进，不做截断；
  - 含工具输出的 round 额外受 `COMPACT_RETAINED_TOOL_OUTPUT_MAX_TOKENS = 64k` 约束；
  - 用户消息总量额外受 `COMPACT_RETAINED_USER_MESSAGE_MAX_TOKENS = 20k` 约束。
    这两个上限是 Codex 对齐值；在 YCode 常见 200k 窗口下 tail 本身只有 20k，因此不会改变
    现有选择结果，只在更大窗口或自定义预算时兜底。

### 5. 稳定摘要前缀与有界重试

- 摘要 prompt 在进入重试循环前只构建一次；所有重试复用同一字符串和同一工具面。
- prompt-too-long 只能通过“减少更旧 round”或既有的截断 fallback 重试，最多
  `MAX_COMPACT_PROMPT_TOO_LONG_RETRIES` 次；外层 auto 最多 `AUTO_COMPACT_MAX_ATTEMPTS` 次。
- 不按重试次数重建 summary prefix，保证 provider prefix cache 可命中。

## 状态所有者与事件顺序

```
TurnLoop / Manual / Reactive
        │
        ▼
autoCompactIfNeeded ──(65% 阈值, 未到硬阈值)──► CompactionController.startSpeculative
        │                                             │ (后台, 不写事件)
        │                                             ▼
        │                                    runCompactSummaryModelRequest
        │                                             │ summary candidate
        │                                             ▼
        └──(硬阈值)──► takeSettledSpeculative ──命中/前缀仍匹配──► compactActiveConversation
                                   │ 未完成/前缀失效
                                   ▼
                          cancelSpeculative + 同步压缩
                                   │
                                   ▼
                     CompactionController.runExclusive
                                   │
        baseGeneration + activeEntries 基准快照
                                   │
        selectCompactEntries ──► summary ──► shrink 校验
                                   │
        assert base（generation + 前缀）
                                   │
        persist summary / boundary(historyGeneration=base+1)
                                   │
        assert base（再次）
                                   │
        messageHistory.replaceMessages(final = post + suffix)  ← 同步原子提交
                                   │
                          generation = base + 1
```

所有权：

- `CompactionController`：generation、互斥锁、唯一投机任务。
- `compactActiveConversation`：选择、摘要、shrink、boundary 持久化、原子替换。
- `messageHistory`：当前 provider-visible entries；只有替换时整体赋值。
- `SessionStore`：boundary / summary / timeline 的持久化权威；resume 从中恢复 generation。

## 失败语义

| 场景              | 行为                                                  |
| ----------------- | ----------------------------------------------------- |
| generation 不匹配 | 丢弃结果，抛 stale 错误，不写 boundary，不替换        |
| 基准不再是前缀    | 同上，原始历史完整                                    |
| 投机结果基准失效  | 取消/丢弃，回退同步压缩                               |
| shrink 校验失败   | 抛 `InvalidStateTransition`，不写 boundary，不替换    |
| 摘要请求失败      | 既有 retry / failure timeline 语义不变                |
| 持久化失败        | 既有 `persistCompactSummary` 回滚已写消息，不替换历史 |

## 验收

1. stale base：压缩期间 generation 前进或历史前缀被替换，提交被拒绝，entries 与之前完全一致。
2. 投机丢弃：候选生成后历史继续增长且 prefix 改变，硬阈值不使用该候选，重新同步压缩。
3. 整个保留：tail 预算不足时，旧工具输出 round 整体丢弃，不出现半截 tool result。
4. shrink 失败非破坏：压缩结果不小于当前上下文时不提交，原历史和 generation 不变。
5. resume 后再次压缩推进 generation，boundary 中能读回上一代。
6. 两个压缩并发请求只有一个提交，另一个得到 stale 结果。
