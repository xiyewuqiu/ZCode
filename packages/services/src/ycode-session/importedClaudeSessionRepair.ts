import type { YCodeSessionStateSnapshot } from "@ycode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { IYCodeAgentService } from "#src/ycode-agent/ycodeAgent.js";
import type {
  YCodeSessionReadParams,
  YCodeSessionResumeParams,
} from "#src/ycode-session/ycodeSession.js";

const logger = createServiceLogger("ycode-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: IYCodeAgentService;
  snapshot: YCodeSessionStateSnapshot;
  target: YCodeSessionResumeParams | YCodeSessionReadParams;
}): Promise<YCodeSessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[ycode-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
