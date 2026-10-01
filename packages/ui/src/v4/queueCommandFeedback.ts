import type { CommandAck } from "@zcode/shared/zcode-protocol-v4";

export type QueueCommandFailure =
  | { kind: "rejected"; ack: CommandAck }
  | { kind: "unconfirmed"; error: unknown };

const failureMessages = {
  deleteQueueItem: "chat.queue.removeFailed",
  sendQueuedNow: "chat.queue.sendFailed",
  reorderQueueItem: "chat.queue.reorderFailed",
  setAutoDrain: "chat.queue.resumeFailed",
} as const;
export type QueueFeedbackCommand = keyof typeof failureMessages;

export function queueCommandFailureMessage(
  type: QueueFeedbackCommand,
  failure: QueueCommandFailure,
) {
  return failure.kind === "unconfirmed" || failure.ack.status === "duplicate"
    ? "chat.queue.resultUnconfirmed"
    : failureMessages[type];
}

/** 只处理已有队列命令的反馈，不重发命令，也不修改权威队列。 */
export async function runQueueCommandWithFeedback({
  send,
  isCurrent,
  report,
}: {
  send: () => Promise<CommandAck>;
  isCurrent: () => boolean;
  report: (failure: QueueCommandFailure, visible: boolean) => void;
}): Promise<CommandAck | null> {
  let ack: CommandAck;
  try {
    ack = await send();
  } catch (error) {
    // 传输失败不能证明 CLI 未接受命令；保留原恢复账本并提示结果待确认。
    report({ kind: "unconfirmed", error }, isCurrent());
    return null;
  }
  if (ack.status === "accepted" || ack.status === "noop") return ack;
  report({ kind: "rejected", ack }, isCurrent());
  return null;
}
