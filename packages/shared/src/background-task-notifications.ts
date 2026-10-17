import type { YCodeMessageWithParts } from "./ycode-protocol-legacy-types.js";
import { textFromYCodeMessageParts } from "./ycode-protocol-legacy-types.js";
import type { YCodeStreamEvent } from "./ycode-task-types-core.js";

export interface YCodeBackgroundTaskNotificationInfo {
  error?: string;
  outputFile?: string;
  result?: string;
  status?: string;
  summary?: string;
  taskId?: string;
}

export function parseYCodeBackgroundTaskNotificationText(
  text: string | undefined,
): { notification: YCodeBackgroundTaskNotificationInfo; toolUseId: string } | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("<task-notification>")) {
    return null;
  }
  const toolUseId = readTaskNotificationTag(trimmed, "tool-use-id");
  if (!toolUseId) {
    return null;
  }
  return {
    toolUseId,
    notification: {
      error: readTaskNotificationTag(trimmed, "error"),
      outputFile: readTaskNotificationTag(trimmed, "output-file"),
      result: readTaskNotificationTag(trimmed, "result"),
      status: readTaskNotificationTag(trimmed, "status"),
      summary: readTaskNotificationTag(trimmed, "summary"),
      taskId: readTaskNotificationTag(trimmed, "task-id"),
    },
  };
}

export function collectYCodeBackgroundTaskNotificationsByToolUseId(
  messages: readonly YCodeMessageWithParts[],
): Map<string, YCodeBackgroundTaskNotificationInfo> {
  const notifications = new Map<string, YCodeBackgroundTaskNotificationInfo>();
  for (const message of messages) {
    if (message.info.role !== "user") {
      continue;
    }
    const parsed = parseYCodeBackgroundTaskNotificationText(
      textFromYCodeMessageParts(message.parts),
    );
    if (!parsed) {
      continue;
    }
    notifications.set(parsed.toolUseId, parsed.notification);
  }
  return notifications;
}

export function ycodeBackgroundTaskNotificationToolUpdateStatus(
  status: string | undefined,
): Extract<
  Extract<YCodeStreamEvent, { type: "tool_call_update" }>["status"],
  "completed" | "failed" | "stopped"
> {
  if (status === "failed" || status === "lost") {
    return "failed";
  }
  // task-notification 的 killed/stopped 都表示被停止，不能折成 completed。
  if (status === "stopped" || status === "killed") {
    return "stopped";
  }
  return "completed";
}

export function attachYCodeBackgroundTaskNotificationToRaw(
  raw: unknown,
  notification: YCodeBackgroundTaskNotificationInfo | undefined,
): unknown {
  if (!notification) {
    return raw;
  }
  const record = asPlainRecord(raw);
  const meta = asPlainRecord(record._meta);
  const ycode = asPlainRecord(meta.ycode);
  return {
    ...record,
    _meta: {
      ...meta,
      ycode: {
        ...ycode,
        taskNotification: notification,
      },
    },
  };
}

function readTaskNotificationTag(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "u"));
  const value = match?.[1]?.trim();
  return value ? decodeTaskNotificationXmlText(value) : undefined;
}

function decodeTaskNotificationXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
