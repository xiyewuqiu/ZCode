# 上下文压缩质量

## 背景

长会话压缩不能只是“生成一段摘要”。2026 的前沿方案收敛到同一组约束：先做零成本
observation masking，再保留一段 verbatim 活跃边缘，最后才做结构化摘要；摘要必须真正
更小，否则下一次请求仍会触发压缩，形成静默抖动。

## 产品规则

1. **先 masking 后摘要**：继续先清理旧工具结果（microcompact），不足时才进入 LLM
   摘要；清理保持 tool call/result 成对，不拆散。
2. **活跃边缘 verbatim tail**：
   - 目标预算为上下文窗口的 10%，上限 50k token，下限 4k token；
   - 至少保留最近的 1 个 assistant round；
   - 同时至少留出 2 个 round 给摘要，不能把整段历史都塞进 tail；
   - tail 按完整 round 选择，不切断 tool call/result。
3. **摘要必须更小**：压缩后的真实估算 token 数（摘要 + 保留 tail + 提醒）必须严格小于
   压缩前；否则判定压缩失败，不提交 boundary，不伪装成功。
4. **摘要 prompt 明确边界**：
   - 只记录待办和下一步，不在摘要过程中执行；
   - 被中断且未执行的 tool call 必须明确标注“未执行”，不能暗示成功；
   - 保留用户显式约束、安全规则、拒绝方案和已知 bug。
5. **阈值**：沿用现有 effective context window（扣除输出预留）和 buffer；不在本规范内
   调整阈值数值。
6. **可回查原文**：压缩提交前，把被摘要的 transcript 以 session artifact 落盘（上限
   64MiB）；摘要消息里附带可 Read 的路径。artifact 写入失败或超限不阻断压缩，只省略路径并
   记录 warn，不能伪造“可回查”。
7. **可见性**：压缩开始/完成/失败继续通过现有 CompactTimeline 事件投影；失败必须可见，
   不能静默吞掉。

## 状态所有者

- `selectCompactEntries` 负责 round 选择与 tail 预算。
- `compactActiveConversation` 负责生成摘要、校验 shrink、提交 boundary 与替换历史。
- `microcompact` 仍是进入摘要前的零成本阶段。
- session boundary/preserved segment 仍是持久化权威；UI 只消费投影。

## 验收

1. 上下文压力触发时，先尝试 microcompact；仍不足才摘要。
2. 10% / 50k 预算内选择最近完整 round；摘要至少保留 2 个 round。
3. 压缩后 token 估算严格小于压缩前；否则不提交。
4. tool call/result 不被拆散；被中断的调用在摘要中明确未执行。
5. 摘要保留用户约束、安全规则、拒绝方案、已知 bug 与下一步。
6. 失败在 timeline 可见；成功 boundary 与 preserved segment 一致。
7. 压缩成功后 transcript artifact 可读；写入失败/超限时摘要仍可提交且不声称有回查路径。
