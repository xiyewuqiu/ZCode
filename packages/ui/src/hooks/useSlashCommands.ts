/**
 * YCode Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import { useYCodeSessionStore, selectWorkspaceYCodeState } from "../store/ycodeSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useYCodeSessionStore(
    (state) => selectWorkspaceYCodeState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
