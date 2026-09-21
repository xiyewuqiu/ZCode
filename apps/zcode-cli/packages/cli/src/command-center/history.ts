import type { TuiPromptInput } from "@zcode/tui";
import type { SlashCommand } from "./slash-command-types.js";
import type { CommandCenterDeps } from "./types.js";

// 官方 /login 的 API key 子命令已删除；同形文本仍可能在自定义命令里出现，
// 一旦命中就把明文 key 写进输入历史，所以这里继续按文本形态兜底。
const API_KEY_LOGIN_PATTERN = /(?:^|\s)(?:bigmodel|zai)-coding-plan-api-key(?:\s|$)/u;

export async function recordSlashCommandInHistory(
  deps: CommandCenterDeps,
  input: TuiPromptInput,
  command: SlashCommand,
): Promise<void> {
  if (!deps.recordInputHistory || !shouldRecordSlashCommand(command)) return;
  try {
    await deps.recordInputHistory(input, "slash_command");
  } catch {
    // Input history is recall UX; command execution must not depend on it.
  }
}

function shouldRecordSlashCommand(command: SlashCommand): boolean {
  return !API_KEY_LOGIN_PATTERN.test(command.args);
}
