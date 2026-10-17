/**
 * workspace prepare 的协议 RPC 收口。
 *
 * 拆出原因：useWorkspacePrepare.ts 只保留可单测的轻量判定入口；
 * 这里只读取 workspace presentation（mode/slash commands）；模型选择事实由目标 Host View 提供。
 */
import type { IYCodeSessionService } from "@ycode/services";
import { type YCodeProvider, type YCodeWorkspacePrepareResult } from "@ycode/shared";
import { getChatErrorMessage } from "@/lib/chatPrepareError.js";
import { logger } from "@/logger.js";
import { ycodeWorkspacePresentationToConfigOptions } from "@/lib/ycodeSessionProjection.js";

export async function prepareWorkspaceWithYCodeSessionService(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  provider: YCodeProvider;
  ycodeSessionService: Pick<IYCodeSessionService, "readWorkspacePresentation">;
}): Promise<YCodeWorkspacePrepareResult> {
  const startedAt = Date.now();
  logger.info("[ycode-workspace-presentation] workspace prepare start", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
  });

  let presentation: Awaited<ReturnType<IYCodeSessionService["readWorkspacePresentation"]>>;
  try {
    presentation = await params.ycodeSessionService.readWorkspacePresentation({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
    });
  } catch (error) {
    logger.warn("[ycode-workspace-presentation] readWorkspacePresentation failed", {
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity ?? null,
      provider: params.provider,
      durationMs: Date.now() - startedAt,
      error: getChatErrorMessage(error),
    });
    throw error;
  }

  const readPresentationDurationMs = Date.now() - startedAt;
  const configOptions = ycodeWorkspacePresentationToConfigOptions(presentation.mode);
  const totalDurationMs = Date.now() - startedAt;
  logger.info("[ycode-workspace-presentation] readWorkspacePresentation done", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
    readPresentationDurationMs,
    totalDurationMs,
    configOptionsCount: configOptions.length,
    modeCurrent: presentation.mode,
  });

  return {
    workspacePath: params.workspacePath,
    preparedSessionId: "",
    version: "YCode Protocol/1",
    provider: params.provider,
    configOptions,
    slashCommands: presentation.slashCommands,
  };
}
