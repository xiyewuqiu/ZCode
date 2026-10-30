# sessions-index 高频 fan-out 节流

## 背景

工作流运行期间，`DynamicWorkflowRunProgress` 会以极高频率回到父会话（实测 8 秒 4000 条）。
每条事件都会改变会话摘要，旧实现逐条刷新 sessions-index，导致宿主重算 task 行、Renderer
按事件频率重拉任务列表，侧栏在长任务期间抖动。

本规范把高频进度事件的列表发布收敛为按会话的 leading + trailing 窗口节流；终态和普通事件
仍在窗口内送达，不丢事件、不伪造完成。

## 产品规则

1. `ModelStreaming` 继续完全排除，不触发列表重算。
2. `DynamicWorkflowRunProgress` 按 session 独立开窗，窗口默认 250ms：
   - 静默后的第一条立即发布（leading）；
   - 窗内后续请求只置 pending；
   - 窗末若有 pending，合并发布一次并续窗；
   - 窗末无 pending 则关窗，下一条重新 leading。
3. 任何普通事件或 hydration 发布都会调用 `notePublished`，把窗口内待发布进度视为已包含，
   不再补一帧空增量。
4. 会话运行态清理必须清掉该会话的窗口定时器；网关 dispose 清掉全部定时器。
5. 定时器 `unref`，不能阻止 CLI 进程退出。
6. 节流只影响 sessions-index 发布节奏，不改变 conversation topic、事件顺序、projection、
   task 事实或持久化。

## 状态所有者

- `SessionsIndexFanoutThrottle` 拥有窗口状态与定时器。
- `ConversationV4Gateway` 只在 `fanOutToIndex` / `publishCurrentSummaryToIndex` /
  清理与 dispose 处调用；publisher 仍是 sessions-index 的唯一发布者。

## 验收

1. 8 秒 4000 条进度事件时，单会话 sessions-index 发布不超过约 4Hz。
2. 普通事件在窗口内仍立即发布，并抑制随后重复的 trailing 帧。
3. 工作流终态在一个窗口内送达，不会永久滞后。
4. 会话清理后不再有该会话的定时器；dispose 后没有残留定时器。
5. `ModelStreaming` 仍不触发列表发布，普通事件行为不变。
