/* eslint-disable max-lines -- Host 入口集中编排 local/remote service wiring，本次退出保护需要在同一处桥接 host 上报。 */
/* eslint-disable max-lines -- host process 入口集中维护 local/remote 初始化和资源回收，realtime bridge 接入后先保持同文件收口。 */
/**
 * Host Process 入口 —— 每个窗口对应一个独立的 host process
 *
 * 同一窗口的 Renderer 和手机 都 attachment 到这个 Host：
 *   Renderer / Mobile ←MessagePort→ Window Host
 *                                      ├─ local services
 *                                      └─ remote connection registry
 *
 * 启动流程：
 * 1. main 进程通过 Electron `utilityProcess.fork()` 创建本进程
 * 2. main 进程只发送一次 init-local 初始化窗口 Host
 * 3. 后续远端 connect / scoped attachment 都由同一 Host 处理
 */
import { createHostDatabaseStartup } from "./hostDatabaseStartup.js";
import { randomUUID } from "node:crypto";
import {
  MessagePortProtocol,
  ChannelServer,
  type IChannelServer,
  LoggingChannelServer,
} from "@ycode/rpc";
import { createBrowserControlMainBridge } from "./browserControlMainBridge.js";
import {
  readComputerControlDriverStatus,
  resolveComputerControlDriverBinaryPath,
} from "./computerControlDriverStatus.js";
import { materializeBrowserRecordingArtifact } from "./browserRecordingArtifactMaterializer.js";
import {
  ServiceCollection,
  IFileService,
  IClientConfigService,
  ICredentialService,
  IMediaPreviewService,
  IModelSelectionService,
  ISettingService,
  IBroadcastService,
  IWindowControllerService,
  IYCodeAgentService,
  IYCodeTaskService,
  IYCodeSessionService,
  ICuaPipSessionService,
  ISourceServerManagementService,
  IProjectService,
  IRemoteProjectService,
  ISourceServerWorkspaceService,
  IPromptAttachmentTransferService,
  type RemoteProjectHost,
  createYCodeAgentConnectionScope,
  type IServiceAccessor,
  type YCodeAgentV4ClientMode,
} from "@ycode/services";

import {
  bindRemoteProjectIdentities,
  createLocalServices,
  createRemoteProjectConnectionAdmission,
  disposeServiceResources,
  disposeServiceResourcesAndWait,
  AutomationRepo,
  createServiceLogger,
  createHostApiNetworkTransport,
  createSettingServiceWithMigrations,
  prepareRemoteServerConnection,
  remoteProjectHostIdForProfile,
  remoteProjectHostIdForTarget,
  type HostApiNetworkTransport,
} from "@ycode/services/node";
import { createHostResourceUsageResponder } from "./hostResourceUsage.js";
import {
  HostMessageTypes,
  HostResponseTypes,
  formatLogPrefix,
  formatYCodeHostProcessName,
  formatZodError,
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  isRemoteWorkspaceIdentity,
  normalizeRemoteConnectionError,
  parseRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  resolveWorkspaceKey,
  sanitizeRemoteConnectionLog,
  formatModelPickerValue,
  type YCodePromptAttachment,
  type YCodeStreamEvent,
  type YCodeTaskMeta,
  type TaskStreamMirrorableEvent,
  type TraceId,
  type YCodeTaskMode,
  type WindowHostAttachmentScope,
  type YCodeAutomation,
  type YCodeAutomationRun,
  type YCodeAutomationRunOutcome,
  type ModelSelection,
  type ConnectionProfile,
  type RemoteTarget,
  type ServerRemoteInfo,
  type SourceServerArtifactPolicy,
} from "@ycode/shared";
import {
  parseHostIncomingMessageEvent,
  rejectUnavailableAttachedServicePort,
} from "./hostMessagePortGuard.js";
// remote backend 相关模块延迟加载：ssh2 的 CJS 依赖链（asn1 等）在 asar 打包后路径断裂，
// 静态 import 会导致 local 模式的 host process 也崩溃。
// 改为动态 import，仅 remote 模式时才加载。
import type { ConnectOptions, IRemoteBackend } from "@ycode/server/remote";
import { wrapElectronPort } from "./electronPort.js";
import { createTaskRealtimeBridgeForHostInit } from "./taskRealtimeBridge.js";
import { resolveRpcLogLevel } from "./rpcLogLevel.js";
import { createHostWorkspaceTaskTracker } from "./hostWorkspaceTaskTracker.js";
import {
  createRemoteMediaPreviewProxy,
  type RemoteMediaPreviewProxy,
} from "./remoteMediaPreviewProxy.js";
import { createHostRemoteWorkspaceProxyState } from "./hostRemoteWorkspaceProxyState.js";
import { createServerRemoteWorkspaceServiceCollection } from "./remoteWorkspaceServiceCollection.js";
import { connectServerRemote } from "./serverRemoteConnection.js";
import { connectSourceServerTarget } from "./connectSourceServerTarget.js";
import { createRemotePromptAttachmentTransferService } from "./promptAttachmentTransferService.js";
import { createSourceServerRecoveryCloseEvent } from "./sourceServerRecoveryPolicy.js";
import { prepareRemoteWorkspaceIdentity } from "./remoteWorkspacePreparation.js";
import { shouldReportHostConsoleError, stringifyHostLogArg } from "./hostLog.js";
import { flushHostE2ECoverage } from "./e2eCoverage.js";
import { runHostShutdownPhases, type HostShutdownResult } from "./hostShutdownPhases.js";
import { initializeHostApiNetworkTransportOwner } from "./hostInitialization.js";
import { createHostUncaughtExceptionHandler } from "./hostUncaughtExceptionGuard.js";
import {
  recordCronRunOutcomeBestEffort,
  startManualClaimHeartbeat,
  settleCronRunTerminalOutcome,
  settleManualDispatchFailureBestEffort,
} from "./cronRunLifecycle.js";
import { createWindowHostAttachmentRegistry } from "./windowHostAttachmentRegistry.js";
import {
  createWindowRemoteConnectionRegistry,
  type WindowRemoteConnectionCloseEvent,
  type WindowRemoteConnectionHandle,
} from "./windowRemoteConnectionRegistry.js";
import { createWindowHostControllerRuntime } from "./windowHostControllerService.js";
import {
  createSourceServerHostRuntime,
  type SourceServerHostRuntime,
} from "./sourceServerHostRuntime.js";
import {
  SourceServerInstallRequiredError,
  SourceServerUpgradeRequiredError,
} from "./sourceServerConnectionManager.js";
import { resolveAutomationSubmissionModelSelection } from "./automationModelSelection.js";
import { createRemoteConnectionProgressContext } from "@ycode/server/remote/remoteConnectionProgressContext.js";
/**
 * 窗口物理连接：直连 `kind=server` 与受管 SSH/WSL/Docker Source 都只暴露
 * `serverInfo + RPC accessor`；受管 Source 的物理 owner 在 Manager，本 wrapper 只持有 lease。
 */
type WindowPhysicalConnection = {
  serverInfo: ServerRemoteInfo;
  services: IServiceAccessor;
  dispose(): void | Promise<void>;
  disposeAndWait?(options?: { timeoutMs?: number }): Promise<void>;
};
interface HostRemoteConnectionCapabilities {
  /** 物理 Source 设备身份；Registry 用它建立稳定 workspace owner。 */
  sourceServerId?: string;
  browserRecordingUploader?: Pick<IRemoteBackend, "upload">;
  remoteMediaPreviewFactory?: (
    scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>,
  ) => RemoteMediaPreviewProxy;
  /** 跨机附件暂存在 owning window Host attachment 内复用当前 transport，不读本地路径。 */
  promptAttachmentTransferFactory?: (
    scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>,
  ) => IPromptAttachmentTransferService;
  /** Source 身份解析属于目标 Environment；窗口 Host 打开项目前必须先解析 canonical key。 */
  bindWorkspaceIdentity?: (input: {
    workspacePath: string;
    stableWorkspaceIdentity: string;
    legacyRouteHint?: string;
    signal?: AbortSignal;
  }) => Promise<void>;
  /** 受管 Source 的 Profile 与物理连接由 Manager 持有，registry 不能按 logical session 回收。 */
  persistentSourceConnection?: boolean;
  profileId?: string;
}

let activeRemoteMediaRequests = 0;
const hostRemoteMediaRequestLimiter = {
  tryAcquire: () => {
    if (activeRemoteMediaRequests >= 4) return false;
    activeRemoteMediaRequests += 1;
    return true;
  },
  release: () => {
    activeRemoteMediaRequests = Math.max(0, activeRemoteMediaRequests - 1);
  },
  getState: () => ({ active: activeRemoteMediaRequests, limit: 4 }),
};
const remoteMediaRangePreviewEnabled =
  process.env["YCODE_REMOTE_MEDIA_RANGE_PREVIEW_ENABLED"] !== "0";

type RemoteAssetDirs = Pick<
  ConnectOptions,
  "mockCdnDir" | "remoteCdnBaseUrl" | "remoteCdnBaseUrls" | "remoteCacheDir"
>;

const { parentPort } = process;

// 进程检索体验优化：host 由 utilityProcess 拉起时外壳仍是 Electron Helper，
// 这里根据 main 传入的窗口 label 补一层稳定的 ycode-* title，方便系统进程列表过滤。
process.title = formatYCodeHostProcessName(process.env["YCODE_PROCESS_LABEL"]);

type HostLogLevel = "info" | "warn" | "error";

interface PendingFeedbackLogArchiveRequest {
  resolve: (archive: { path: string; size: number }) => void;
  reject: (error: Error) => void;
  onProgress?: (event: { processedBytes: number; totalBytes: number }) => void;
}

interface PendingLocalMediaPreviewPathAuthorization {
  resolve: (path: string) => void;
  reject: (error: Error) => void;
}

const pendingFeedbackLogArchiveRequests = new Map<string, PendingFeedbackLogArchiveRequest>();
let nextFeedbackLogArchiveRequestSeq = 0;
const pendingLocalMediaPreviewPathAuthorizations = new Map<
  string,
  PendingLocalMediaPreviewPathAuthorization
>();

function authorizeLocalMediaPreviewPath(path: string): Promise<string> {
  if (!parentPort) {
    return Promise.reject(new Error("parentPort unavailable"));
  }
  const requestId = randomUUID();
  return new Promise<string>((resolve, reject) => {
    pendingLocalMediaPreviewPathAuthorizations.set(requestId, { resolve, reject });
    try {
      parentPort.postMessage({
        type: HostResponseTypes.LocalMediaPreviewPathAuthorizeRequest,
        requestId,
        path,
      });
    } catch (error) {
      pendingLocalMediaPreviewPathAuthorizations.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// browser-use host↔main 桥：把 agent 的 browser 命令经 parentPort 转给 main（WebContentsView+CDP）。
// parentPort 为空（不应发生于 host 进程）时 postToMain 抛错，bridge 自身返回 backend_unavailable。
const browserControlMainBridge = createBrowserControlMainBridge({
  postToMain: (message) => {
    if (!parentPort) {
      throw new Error("parentPort unavailable");
    }
    parentPort.postMessage(message);
  },
  materializeRecording: (input) => {
    let remoteBackend: Pick<IRemoteBackend, "upload"> | undefined;
    if (input.remoteSessionId) {
      const workspaceIdentity = input.workspaceIdentity;
      if (!workspaceIdentity?.trim()) {
        throw new Error("remote Browser recording materialization requires workspaceIdentity");
      }
      // Window Host 重构后同一进程可同时持有多个远端连接，旧的进程级
      // remoteConnection 会串 session。必须用完整 scope 从 registry 的权威 entry 取 uploader。
      remoteBackend = windowRemoteConnectionRegistry.resolveScopedCapabilities({
        kind: "remote",
        remoteSessionId: input.remoteSessionId,
        workspacePath: input.workspacePath,
        workspaceIdentity,
      })?.browserRecordingUploader;
    }
    return materializeBrowserRecordingArtifact({
      ...input,
      ...(remoteBackend ? { remoteBackend } : {}),
    });
  },
});

function reportHostLog(level: HostLogLevel, args: unknown[]): void {
  if (!parentPort) {
    return;
  }

  try {
    parentPort.postMessage({
      type: HostResponseTypes.Log,
      level,
      source: "host",
      message: args.map((arg) => stringifyHostLogArg(arg)).join(" "),
    });
  } catch {
    // 日志上报失败不应影响 host 主流程。
  }
}

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const remoteConnectionProgressContext = createRemoteConnectionProgressContext({
  emit: ({ requestId, level, args }) => {
    if (!parentPort) {
      return;
    }
    try {
      parentPort.postMessage({
        type: HostResponseTypes.RemoteWorkspaceConnectionLog,
        requestId,
        level,
        message: args.map((arg) => stringifyHostLogArg(arg)).join(" "),
      });
    } catch {
      // 连接进度上报失败不应中断 SSH/WSL/Docker 的真实连接流程。
    }
  },
});

function writeHostLog(level: HostLogLevel, ...args: unknown[]): void {
  const prefix = formatLogPrefix("ycode-host", process.pid);
  const consoleFn =
    level === "error" ? rawConsole.error : level === "warn" ? rawConsole.warn : rawConsole.log;
  consoleFn(prefix, ...args);
  reportHostLog(level, [prefix, ...args]);
}

function createFullFeedbackLogArchiveViaMain(
  sourceDir: string,
  options?: {
    onProgress?: (event: { processedBytes: number; totalBytes: number }) => void;
  },
): Promise<{ path: string; size: number }> {
  const requestId = `feedback-log-archive-${Date.now()}-${nextFeedbackLogArchiveRequestSeq++}`;
  options?.onProgress?.({ processedBytes: 0, totalBytes: 0 });

  return new Promise((resolve, reject) => {
    pendingFeedbackLogArchiveRequests.set(requestId, {
      resolve,
      reject,
      onProgress: options?.onProgress,
    });
    // 问题反馈以前在 host service 内走 compactLogArchive 的 full fallback，
    // 收集范围和“导出日志”不一致，缺少 ycode-cli 日志、rollout/debug 以及导出链路脱敏。
    // 这里把完整日志打包委托给 main process 的导出日志同源逻辑，host 只拿 zip 路径继续上传。
    try {
      parentPort.postMessage({
        type: HostResponseTypes.FeedbackLogArchiveRequest,
        requestId,
        sourceDir,
      });
    } catch (error) {
      pendingFeedbackLogArchiveRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const logger = {
  info: (...args: unknown[]) => writeHostLog("info", ...args),
  warn: (...args: unknown[]) => writeHostLog("warn", ...args),
  error: (...args: unknown[]) => writeHostLog("error", ...args),
};

const cronAutomationRepo = new AutomationRepo();
const cronRunSubscriptions = new Map<string, { dispose(): void }>();

interface CronRunDispatchRequest {
  automationId: string;
  runId: string;
  prompt: string;
  targetTaskId?: string;
  modelSelection?: ModelSelection;
  mode?: YCodeTaskMode;
  workspacePath: string;
  workspaceIdentity?: string;
}

function resolveAutomationTargetServices(request: {
  workspacePath: string;
  workspaceIdentity?: string;
}): ServiceCollection {
  const remoteSession = windowRemoteConnectionRegistry.findSessionForWorkspace(request);
  if (remoteSession) {
    if (!remoteSession.workspaceIdentity) {
      throw new Error("Automation 目标 Remote Host 缺少 workspaceIdentity");
    }
    return windowRemoteConnectionRegistry.resolveScopedServices({
      kind: "remote",
      remoteSessionId: remoteSession.remoteSessionId,
      workspacePath: request.workspacePath,
      workspaceIdentity: remoteSession.workspaceIdentity,
    });
  }
  // 远程 Automation 找不到目标 logical session 时，旧派发会静默落到 Local Host，
  // 从而使用本地模型首选与 Registry。远程身份只能失败，不能跨 Environment fallback。
  if (request.workspaceIdentity && isRemoteWorkspaceIdentity(request.workspaceIdentity)) {
    throw new Error("Automation 目标 Remote Host 当前不可用");
  }
  if (!activeServices) {
    throw new Error("Local Host services are not initialized.");
  }
  return activeServices;
}

function cronRunSubscriptionKey(taskId: string, traceId: TraceId): string {
  return `${taskId}\u0000${traceId}`;
}

function parseCronRunScheduledAt(runId: string, automationId: string): number | null {
  const prefix = `${automationId}:`;
  if (!runId.startsWith(prefix)) return null;
  const value = Number(runId.slice(prefix.length).split(":")[0]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function markCronRunOutcome(params: {
  runId: string;
  automationId: string;
  workspaceKey: string;
  scheduledAt: number | null;
  trigger: "schedule" | "manual";
  outcome: YCodeAutomationRunOutcome;
  error?: string;
}): void {
  void recordCronRunOutcomeBestEffort({
    ...params,
    repo: cronAutomationRepo,
    logWarn: (message, error) => logger.warn(message, error),
  });
}

function disposeCronRunSubscription(key: string): void {
  const disposable = cronRunSubscriptions.get(key);
  if (!disposable) return;
  cronRunSubscriptions.delete(key);
  disposable.dispose();
}

async function applyCronRunConfigToExistingTask(params: {
  ycodeTaskService: IYCodeTaskService;
  taskId: string;
  traceId: TraceId;
  modelSelection?: ModelSelection;
  mode?: string;
}): Promise<void> {
  let thoughtAppliedWithModel = false;
  let modeAppliedWithModel = false;
  if (params.modelSelection) {
    await params.ycodeTaskService.setAutomationSessionConfig({
      taskId: params.taskId,
      traceId: params.traceId,
      modelSelection: params.modelSelection,
      thoughtLevel: params.modelSelection.options?.reasoningLevel,
      mode: params.mode?.trim() as YCodeTaskMode | undefined,
    });
    thoughtAppliedWithModel = true;
    modeAppliedWithModel = true;
  }
  if (!modeAppliedWithModel && params.mode?.trim()) {
    await params.ycodeTaskService.setConfigOption({
      taskId: params.taskId,
      traceId: params.traceId,
      configId: "mode",
      value: params.mode.trim(),
    });
  }
  if (!thoughtAppliedWithModel && params.modelSelection?.options?.reasoningLevel) {
    await params.ycodeTaskService.setConfigOption({
      taskId: params.taskId,
      traceId: params.traceId,
      configId: "thought_level",
      value: params.modelSelection.options.reasoningLevel,
    });
  }
}

function trackCronRunOutcome(params: {
  ycodeTaskService: IYCodeTaskService;
  taskId: string;
  traceId: TraceId;
  workspacePath: string;
  workspaceIdentity?: string;
  runId: string;
  automationId: string;
  workspaceKey: string;
  scheduledAt: number | null;
  trigger: "schedule" | "manual";
}): void {
  const key = cronRunSubscriptionKey(params.taskId, params.traceId);
  disposeCronRunSubscription(key);
  markCronRunOutcome({ ...params, outcome: "running" });
  const disposable = params.ycodeTaskService.onDynamicTaskTerminalOutcome(params.taskId)(
    (result) => {
      if (result.inputId !== params.traceId) return;
      void settleCronRunTerminalOutcome({
        ...params,
        outcome: result.outcome,
        error: result.error,
        repo: cronAutomationRepo,
        logWarn: (message, error) => logger.warn(message, error),
      });
      // 定时任务在后台完成后统一置为未读，真正打开 task 时再由导航链路清除。
      void params.ycodeTaskService.setTaskUnread({
        taskId: params.taskId,
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        unread: true,
      });
      disposeCronRunSubscription(key);
    },
  );
  const claimHeartbeat =
    params.trigger === "manual"
      ? startManualClaimHeartbeat({
          ...params,
          repo: cronAutomationRepo,
          logWarn: (message, error) => logger.warn(message, error),
        })
      : null;
  cronRunSubscriptions.set(key, {
    dispose() {
      claimHeartbeat?.dispose();
      disposable.dispose();
    },
  });
}

/**
 * 把一次 cron/manual run 直接提交给当前 host 的 V4 task service。
 * 会话内 automation 可能绑定到未激活 session，必须先恢复再应用保存的运行参数。
 */
async function dispatchCronRun(request: CronRunDispatchRequest): Promise<{
  taskId: string;
  sessionId: string;
}> {
  const targetServices = resolveAutomationTargetServices(request);
  const ycodeTaskService = targetServices.getOptional(IYCodeTaskService);
  if (!ycodeTaskService) {
    throw new Error("YCode task service is not initialized.");
  }
  const modelSelectionService = targetServices.getOptional(IModelSelectionService);
  if (!modelSelectionService) {
    throw new Error("目标 Host Model Selection service is not initialized.");
  }
  // 长期配置是原意图；首次派发在目标 Host 解析后固定。已有 run 必须直接复用，
  // 不能因账号变化或本次 Registry 读取失败重新解释历史执行选择。
  const existingRun = await cronAutomationRepo.getRun(request.runId);
  const resolvedSubmissionModelSelection = await resolveAutomationSubmissionModelSelection({
    selection: request.modelSelection,
    fixedSelection: existingRun?.modelSelection,
    modelSelectionService,
    // Repo 已在读取前完成离线导入；不再为迁移绕行 Agent/账号服务。
    // 未迁入或损坏的新值仍由此入口明确拒绝，不能当成跟随 Workspace。
    readSelection: () =>
      cronAutomationRepo.getModelSelectionForDispatch(
        request.automationId,
        resolveWorkspaceKey(request),
      ),
  });
  const submissionModelSelection = await cronAutomationRepo.fixRunModelSelection(
    request.runId,
    resolvedSubmissionModelSelection,
  );
  let trackedKey: string | null = null;
  const workspaceKey = resolveWorkspaceKey(request);
  const trigger = request.runId.includes(":manual:") ? "manual" : "schedule";
  const scheduledAt = parseCronRunScheduledAt(request.runId, request.automationId);
  try {
    const task = request.targetTaskId
      ? { taskId: request.targetTaskId }
      : await ycodeTaskService.createTask({
          workspacePath: request.workspacePath,
          workspaceIdentity: request.workspaceIdentity,
          model: formatModelPickerValue(submissionModelSelection),
          mode: request.mode,
          thoughtLevel: submissionModelSelection.options?.reasoningLevel,
          automationId: request.automationId,
        });
    // 未绑定会话时不能沿用 createTask 的 session trace 作为首条 prompt trace：
    // CLI 无法从 inputId 还原 manual/schedule admission。
    // 建会话 trace 与执行 runId 是两种身份；两条派发路径的 prompt 都必须统一使用 runId。
    const promptTraceId = request.runId as TraceId;
    if (request.targetTaskId) {
      // 绑定会话在 app 重启或切换 workspace 后通常不处于 active；旧实现直接
      // setConfig/sendPrompt 会立即报 Session is not active，看起来像「立即运行」没有触发。
      await ycodeTaskService.resumeTask({
        taskId: task.taskId,
        workspacePath: request.workspacePath,
        workspaceIdentity: request.workspaceIdentity,
        model: formatModelPickerValue(submissionModelSelection),
        thoughtLevel: submissionModelSelection.options?.reasoningLevel,
        automationId: request.automationId,
      });
      await applyCronRunConfigToExistingTask({
        ycodeTaskService,
        taskId: task.taskId,
        traceId: promptTraceId,
        modelSelection: submissionModelSelection,
        mode: request.mode,
      });
    }
    trackedKey = cronRunSubscriptionKey(task.taskId, promptTraceId);
    trackCronRunOutcome({
      ycodeTaskService,
      taskId: task.taskId,
      traceId: promptTraceId,
      workspacePath: request.workspacePath,
      workspaceIdentity: request.workspaceIdentity,
      runId: request.runId,
      automationId: request.automationId,
      workspaceKey,
      scheduledAt,
      trigger,
    });
    await ycodeTaskService.sendPrompt({
      taskId: task.taskId,
      traceId: promptTraceId,
      content: request.prompt,
      clientMode: "desktop-continuous",
      automationId: request.automationId,
    });
    return { taskId: task.taskId, sessionId: task.taskId };
  } catch (error) {
    if (trackedKey) disposeCronRunSubscription(trackedKey);
    markCronRunOutcome({
      runId: request.runId,
      automationId: request.automationId,
      workspaceKey,
      scheduledAt,
      trigger,
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function dispatchManualAutomationRun(params: {
  automation: YCodeAutomation;
  run: YCodeAutomationRun;
}): Promise<void> {
  logger.info(
    `direct manual automation dispatch started automation=${params.automation.automationId} runId=${params.run.runId}`,
  );
  let result: Awaited<ReturnType<typeof dispatchCronRun>>;
  try {
    result = await dispatchCronRun({
      automationId: params.automation.automationId,
      runId: params.run.runId,
      prompt: params.automation.prompt,
      targetTaskId: params.automation.targetTaskId,
      modelSelection: params.run.modelSelection ?? params.automation.modelSelection,
      mode: params.automation.mode,
      workspacePath: params.automation.workspacePath,
      workspaceIdentity: params.automation.workspaceIdentity,
    });
  } catch (error) {
    logger.warn(
      `direct manual automation dispatch failed automation=${params.automation.automationId} runId=${params.run.runId}:`,
      error,
    );
    await settleManualDispatchFailureBestEffort({
      repo: cronAutomationRepo,
      automationId: params.automation.automationId,
      runId: params.run.runId,
      workspaceKey: params.automation.workspaceKey,
      scheduledAt: params.run.scheduledAt ?? null,
      trigger: "manual",
      dispatchError: error,
      logWarn: (message, releaseError) => logger.warn(message, releaseError),
    });
    throw error;
  }

  try {
    await cronAutomationRepo.markManualRunDispatched({
      runId: params.run.runId,
      sessionId: result.sessionId,
      dispatchedAt: Date.now(),
    });
  } catch (error) {
    // prompt 已经 accepted/queued，台账和累计次数回写失败不能伪装成派发失败并提前释放锁；
    // 真实终态仍由 trackCronRunOutcome 收口，避免同一 automation 重复排队。
    logger.warn(
      `回写 manual automation dispatched 状态与运行次数失败 automation=${params.automation.automationId} runId=${params.run.runId}`,
      error,
    );
  }
  // sendPrompt ACK 可能只表示进入 busy queue；manual claim 必须保留到对应 turn 终态。
  logger.info(
    `direct manual automation dispatch accepted automation=${params.automation.automationId} runId=${params.run.runId} taskId=${result.taskId}`,
  );
}

// Node warning 不是远端连接失败，改成结构化 warn，避免默认 stderr 被误染成 error。
process.on("warning", (warning) => logger.warn(`${warning.name}: ${warning.message}`));

const runtimeProcessLifecycleReporter = {
  onSpawn(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessSpawned,
      ...event,
    });
  },
  onReady(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessReady,
      ...event,
    });
  },
  onExit(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessExited,
      ...event,
      signal: event.signal ?? null,
    });
  },
  onError(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessError,
      ...event,
    });
  },
  onException(event) {
    parentPort?.postMessage({ type: HostResponseTypes.AgentProcessException, ...event });
  },
} satisfies NonNullable<Parameters<typeof createLocalServices>[0]>["processLifecycleReporter"];

const runtimeTaskReporter = {
  onRunningTaskCountChanged(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentRunningTaskCountChanged,
      runningTaskCount: event.runningTaskCount,
    });
  },
} satisfies NonNullable<Parameters<typeof createLocalServices>[0]>["taskRuntimeReporter"];

const cuaOperationStateReporter = {
  onStateChanged(event) {
    if (!parentPort) {
      return;
    }
    parentPort.postMessage({
      type: HostResponseTypes.CuaOperationState,
      ...event,
    });
  },
} satisfies NonNullable<Parameters<typeof createLocalServices>[0]>["cuaOperationStateReporter"];

let untrackedPromptRpcCount = 0;
function reportHostRunningTaskCount(): void {
  runtimeTaskReporter.onRunningTaskCountChanged({
    runningTaskCount: workspaceTaskTracker.getTotalRunningTaskCount() + untrackedPromptRpcCount,
  });
}

const workspaceTaskTracker = createHostWorkspaceTaskTracker((event) => {
  parentPort?.postMessage({
    type: HostResponseTypes.WorkspaceRunningTaskCountChanged,
    ...event,
  });
  windowRemoteConnectionRegistry.setWorkspaceRunningTaskCount(event);
  reportHostRunningTaskCount();
});

function isYCodeTaskMeta(value: unknown): value is YCodeTaskMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    "taskId" in value &&
    "workspacePath" in value &&
    "traceId" in value &&
    typeof (value as { taskId?: unknown }).taskId === "string" &&
    typeof (value as { workspacePath?: unknown }).workspacePath === "string" &&
    typeof (value as { traceId?: unknown }).traceId === "string"
  );
}

function isRemoteMirrorableStreamEvent(
  event: YCodeStreamEvent,
): event is TaskStreamMirrorableEvent {
  return event.type !== "task_stream_mirror_batch" && event.type !== "task_snapshot_updated";
}

function createReportingRemoteYCodeTaskService<T extends object>(
  service: T,
  options?: {
    reportRunningPromptCount?: boolean;
    taskRealtimePort?: ReturnType<typeof createTaskRealtimeBridgeForHostInit>;
    materializePromptAttachments?: (params: {
      taskId: string;
      traceId: TraceId;
      content: string;
      attachments?: YCodePromptAttachment[];
    }) => Promise<{ content: string; attachments?: YCodePromptAttachment[] }>;
  },
): T {
  const workspaceProxyState = createHostRemoteWorkspaceProxyState();

  function forwardSessionMessageRequest(request: unknown): void {
    parentPort?.postMessage({
      type: HostResponseTypes.SessionMessageSendRequested,
      request,
    });
  }

  function subscribeSessionMessageRequests(target: T, meta: YCodeTaskMeta): void {
    const onDynamicWorkspaceEvent = Reflect.get(target, "onDynamicWorkspaceEvent");
    if (typeof onDynamicWorkspaceEvent !== "function") {
      return;
    }
    const subscribe = onDynamicWorkspaceEvent.call(target, {
      workspacePath: meta.workspacePath,
      ...(meta.workspaceIdentity ? { workspaceIdentity: meta.workspaceIdentity } : {}),
    });
    if (typeof subscribe !== "function") {
      return;
    }
    workspaceProxyState.ensureWorkspaceSubscription(meta, () =>
      subscribe((event: unknown) => {
        if (
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "workspace_session_message_send_requested"
        ) {
          forwardSessionMessageRequest((event as { request?: unknown }).request);
        }
      }),
    );
  }

  function rememberTaskMeta(result: unknown): void {
    if (isYCodeTaskMeta(result)) {
      workspaceProxyState.rememberTaskMeta(result);
      subscribeSessionMessageRequests(service, result);
      parentPort?.postMessage({
        type: HostResponseTypes.SessionRouteAnnounce,
        route: {
          sessionId: result.taskId,
        },
      });
    }
  }

  function rememberTaskMetasFromResult(result: unknown): void {
    if (Array.isArray(result)) {
      for (const item of result) {
        rememberTaskMetasFromResult(item);
      }
      return;
    }
    rememberTaskMeta(result);
    if (typeof result !== "object" || result === null) {
      return;
    }
    const items = (result as { items?: unknown }).items;
    if (Array.isArray(items)) {
      for (const item of items) {
        rememberTaskMeta(item);
      }
    }
    const snapshot = (result as { snapshot?: unknown }).snapshot;
    if (typeof snapshot === "object" && snapshot !== null) {
      rememberTaskMeta((snapshot as { meta?: unknown }).meta);
    }
    rememberTaskMeta((result as { meta?: unknown }).meta);
  }

  async function prepareRemotePromptParams(params: {
    taskId: string;
    traceId: TraceId;
    content: string;
    attachments?: YCodePromptAttachment[];
  }): Promise<{
    taskId: string;
    traceId: TraceId;
    content: string;
    attachments?: YCodePromptAttachment[];
  }> {
    if (!options?.materializePromptAttachments) {
      return params;
    }
    return {
      ...params,
      ...(await options.materializePromptAttachments(params)),
    };
  }

  async function mirrorRemotePrompt(
    target: T,
    sendPrompt: (...args: unknown[]) => Promise<unknown>,
    params: {
      taskId: string;
      traceId: TraceId;
      content: string;
      attachments?: YCodePromptAttachment[];
    },
  ): Promise<unknown> {
    const taskRealtimePort = options?.taskRealtimePort;
    const meta = workspaceProxyState.getTaskMeta(params.taskId);
    if (!taskRealtimePort || !meta) {
      return sendPrompt.call(target, params);
    }

    const mirrorTarget = {
      workspacePath: meta.workspacePath,
      workspaceIdentity: meta.workspaceIdentity,
      workspaceKey: resolveWorkspaceKey(meta),
      taskId: params.taskId,
      runId: params.traceId,
      traceId: params.traceId,
    };
    const leaseResult = await taskRealtimePort
      .acquireTaskRunLease(mirrorTarget)
      .catch((error: unknown) => {
        logger.warn("Remote runtime realtime lease failed:", error);
        return null;
      });
    if (!leaseResult?.acquired) {
      return sendPrompt.call(target, params);
    }

    taskRealtimePort.publishStreamOp(mirrorTarget, {
      kind: "user_message",
      messageId: `user-${params.traceId}`,
      content: params.content,
      attachments: params.attachments,
      timestamp: Date.now(),
    });

    // 写路径（send/stop/交互回执）已收敛 v4 命令面；本镜像属**读路径**——
    // taskRealtimePort → 手机 relay → 手机端
    // ycodeSessionStore 的整条消费链词表都是 YCodeStreamEvent。两个方案的评估结论：
    // a) relay 直接转发 v4 帧、手机端消费 v4 store（正解）：需要重做 relay stream-op
    //    协议 + 手机端 store；
    // b) 帧→YCodeStreamEvent 薄映射：等价复刻 adapter mapSessionEvent，
    //    否决。
    // 结论：本镜像保持 legacy 源不动。
    const dynamicStreamEvent = Reflect.get(target, "onDynamicStreamEvent");
    const streamDisposable =
      typeof dynamicStreamEvent === "function"
        ? dynamicStreamEvent.call(
            target,
            params.taskId,
          )((event: YCodeStreamEvent) => {
            if (isRemoteMirrorableStreamEvent(event)) {
              taskRealtimePort.publishStreamOp(mirrorTarget, {
                kind: "stream_event",
                event,
              });
            }
          })
        : null;

    try {
      return await sendPrompt.call(target, params);
    } finally {
      // 远端 ycode-server 没有 desktop realtime port；由窗口 Host 内的
      // remote facade 接管 lease 和 stream mirror，确保 UI 能持续收到远端会话流。
      streamDisposable?.dispose();
      taskRealtimePort.releaseTaskRunLease(mirrorTarget);
    }
  }

  function finishWorkspaceTask(taskId: string, meta: YCodeTaskMeta): void {
    workspaceProxyState.disposeTaskReadySubscription(taskId);
    workspaceTaskTracker.finish(taskId, meta);
  }

  function beginWorkspaceTask(target: T, taskId: string, meta: YCodeTaskMeta): boolean {
    const started = workspaceTaskTracker.begin(taskId, meta);
    if (!started) {
      return false;
    }
    const onDynamicTaskReady = Reflect.get(target, "onDynamicTaskReady");
    if (typeof onDynamicTaskReady !== "function") {
      workspaceTaskTracker.finish(taskId, meta);
      throw new Error("remote YCode task service does not expose onDynamicTaskReady");
    }
    const subscribe = onDynamicTaskReady.call(target, taskId);
    if (typeof subscribe !== "function") {
      workspaceTaskTracker.finish(taskId, meta);
      throw new Error("remote YCode task ready event is not subscribable");
    }
    workspaceProxyState.trackTaskReady(
      taskId,
      meta,
      (listener) => subscribe(listener),
      () => finishWorkspaceTask(taskId, meta),
    );
    return true;
  }

  // remote workspace 的 YCode Agent manager 跑在远端 server，desktop main 不能直接看到
  // `handles` 状态。sendPrompt Promise 只是远端 ACK，必须等待 task ready 才能允许回收 workspace。
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property === "createTask" || property === "resumeTask") && typeof value === "function") {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          rememberTaskMeta(result);
          return result;
        };
      }
      if (
        (property === "listTasks" ||
          property === "listPinnedTasks" ||
          property === "listTaskList" ||
          property === "listArchivedTasks" ||
          property === "getTaskMeta" ||
          property === "getTaskSnapshot" ||
          property === "getTaskSnapshotWithEtag") &&
        typeof value === "function"
      ) {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          rememberTaskMetasFromResult(result);
          return result;
        };
      }
      if (property === "releaseWorkspacePreparation" && typeof value === "function") {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          const context = args[0];
          if (
            typeof context === "object" &&
            context !== null &&
            typeof (context as { workspacePath?: unknown }).workspacePath === "string"
          ) {
            const workspaceContext = context as {
              workspacePath: string;
              workspaceIdentity?: string;
            };
            // pooled Host 不随 tab 退出；runtime 成功释放后必须同步解除 Host 代理层引用，
            // 否则 task meta 和动态事件 listener 会在整个应用生命周期内单调增长。
            workspaceProxyState.clearWorkspace(workspaceContext);
            workspaceTaskTracker.clearWorkspace(workspaceContext);
          }
          return result;
        };
      }
      const shouldWrapSendPrompt =
        options?.reportRunningPromptCount !== false ||
        Boolean(options?.taskRealtimePort) ||
        Boolean(options?.materializePromptAttachments);
      if (property !== "sendPrompt" || typeof value !== "function" || !shouldWrapSendPrompt) {
        return value;
      }

      return async (...args: unknown[]) => {
        let trackedTask: { taskId: string; meta: YCodeTaskMeta; started: boolean } | undefined;
        let tracksOnlyRpcLifetime = false;
        try {
          const params = args[0];
          if (
            typeof params === "object" &&
            params !== null &&
            typeof (params as { taskId?: unknown }).taskId === "string" &&
            typeof (params as { traceId?: unknown }).traceId === "string" &&
            typeof (params as { content?: unknown }).content === "string"
          ) {
            const promptParams = params as {
              taskId: string;
              traceId: TraceId;
              content: string;
              attachments?: YCodePromptAttachment[];
            };
            const taskMeta = workspaceProxyState.getTaskMeta(promptParams.taskId) as
              | YCodeTaskMeta
              | undefined;
            if (taskMeta) {
              trackedTask = {
                taskId: promptParams.taskId,
                meta: taskMeta,
                started: beginWorkspaceTask(target, promptParams.taskId, taskMeta),
              };
            } else if (options?.reportRunningPromptCount !== false) {
              // task meta 缺失时无法安全伪造 workspace identity；仅保留 ACK 期间的 Host 退出诊断，
              // 不让该 fallback 参与 workspace runtime 的释放裁决。
              tracksOnlyRpcLifetime = true;
              untrackedPromptRpcCount += 1;
              reportHostRunningTaskCount();
            }
            const preparedParams = await prepareRemotePromptParams(promptParams);
            return await mirrorRemotePrompt(
              target,
              value.bind(target) as (...promptArgs: unknown[]) => Promise<unknown>,
              preparedParams,
            );
          }
          if (options?.reportRunningPromptCount !== false) {
            tracksOnlyRpcLifetime = true;
            untrackedPromptRpcCount += 1;
            reportHostRunningTaskCount();
          }
          return await value.apply(target, args);
        } catch (error) {
          if (trackedTask?.started) {
            finishWorkspaceTask(trackedTask.taskId, trackedTask.meta);
          }
          throw error;
        } finally {
          if (tracksOnlyRpcLifetime) {
            untrackedPromptRpcCount = Math.max(0, untrackedPromptRpcCount - 1);
            reportHostRunningTaskCount();
          }
        }
      };
    },
  });
}

function warmUpYCodeAgent(
  services: ServiceCollection,
  context: { workspacePath?: string; workspaceIdentity?: string },
  reason: string,
): void {
  if (!context.workspacePath) {
    return;
  }
  const workspacePath = context.workspacePath;
  const workspaceIdentity = context.workspaceIdentity;
  const ycodeSessionService = services.getOptional(IYCodeSessionService);
  if (!ycodeSessionService) {
    return;
  }
  void ycodeSessionService
    .initializeWorkspace({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    })
    .then((result) => {
      if (!result.available) {
        if (result.reasonCode === "provider_not_ready") {
          logger.info(
            `YCode agent warmup waiting for provider/model (${reason}) workspace=${workspacePath}`,
          );
          return;
        }
        logger.warn(
          `YCode agent warmup unavailable (${reason}) workspace=${workspacePath} reason=${result.reason ?? "unknown"}`,
        );
        return;
      }
      // 模型候选和首选项已经由目标 Host ModelSelectionView 提供；workspace
      // presentation 只剩 mode 与 slash commands。预热不能为读取 presentation 额外创建
      // Agent App，否则其 MCP close 会占住协议通道并阻塞真正的 Session 初始化。
      logger.info(
        `YCode agent warmup ready (${reason}) workspace=${workspacePath} transport=${result.transportKind ?? "unknown"}`,
      );
    })
    .catch((error) => {
      logger.warn(`YCode agent warmup failed (${reason}) workspace=${workspacePath}:`, error);
    });
}

// 后台输出轮询仍需独立的 debug logger，不能随其他日志调用方移除而丢失工厂导入。
const rpcDebugLogger = createServiceLogger("rpc");

function logRpc(message: string, ...args: unknown[]): void {
  const level = resolveRpcLogLevel(message, ...args);
  if (level === "debug") {
    rpcDebugLogger.debug(undefined, message, ...args);
    return;
  }
  logger[level](message, ...args);
}

function formatRemoteTargetForLog(target: RemoteTarget): string {
  switch (target.kind) {
    case "ssh":
      return `ssh:${target.username}@${target.host}:${target.port ?? 22}`;
    case "wsl": {
      const user = target.user?.trim();
      const distro = target.distro ?? "default";
      return user ? `wsl:${distro}:${user}` : `wsl:${distro}`;
    }
    case "docker":
      return `docker:${target.container}`;
    case "server":
      return `server:${target.serverId?.trim() || target.url}`;
  }
}

console.log = (...args: unknown[]) => {
  rawConsole.log(...args);
  reportHostLog("info", args);
  remoteConnectionProgressContext.report("info", args);
};

console.warn = (...args: unknown[]) => {
  rawConsole.warn(...args);
  reportHostLog("warn", args);
  remoteConnectionProgressContext.report("warn", args);
};

console.error = (...args: unknown[]) => {
  rawConsole.error(...args);
  // Electron 会把 Node warning 先走 console.error，而 process warning listener 随后还会
  // 结构化记录 warn；若这里继续上报，就会为同一个 warning 留下一条 error 和一条 warn。
  if (!shouldReportHostConsoleError(args)) {
    return;
  }
  reportHostLog("error", args);
  remoteConnectionProgressContext.report("error", args);
};

/** 当前 host 已注册的服务集合，进程退出时用于统一回收本地资源 */
let databaseStartup: ReturnType<typeof createHostDatabaseStartup> | undefined;
const pendingStartupAttachments = new Map<string, () => void>();
let activeServices: ServiceCollection | null = null;
let activeHostApiNetworkTransport: HostApiNetworkTransport | null = null;
/**
 * 每个 Window Host 唯一的 Source Server 运行时。物理连接 owner 只在这里；
 * logical workspace / remoteSessionId 由未来的项目 UI attachment 引用，本切片不创建。
 */
let sourceServerHostRuntime: SourceServerHostRuntime | null = null;
// 资源管理器采样只在 main 请求时执行一次，Host 不维护任何周期定时器。
const hostResourceUsageResponder = createHostResourceUsageResponder({
  getAgentService: () => activeServices?.getOptional(IYCodeAgentService),
  postMessage: (message) => parentPort?.postMessage(message),
});
let activeSessionRealtimePort: ReturnType<typeof createTaskRealtimeBridgeForHostInit> = null;
let hasDisposedHostResources = false;
let disposeHostResourcesInFlight: Promise<HostShutdownResult> | null = null;

function requireActiveHostApiNetworkTransport(): HostApiNetworkTransport {
  if (!activeHostApiNetworkTransport) {
    // Bug 原因：remote asset 若在 Host 网络策略就绪前回退 global fetch，会绕过设置页显式代理。
    throw new Error("Window Host network transport is not initialized");
  }
  return activeHostApiNetworkTransport;
}

async function disposeHostRemoteConnection(connection: WindowPhysicalConnection): Promise<void> {
  if (connection.disposeAndWait) {
    await connection.disposeAndWait({ timeoutMs: 5_000 });
    return;
  }
  await connection.dispose();
}

function requireSourceServerRuntime(): SourceServerHostRuntime {
  if (!sourceServerHostRuntime) {
    throw new Error("Source Server runtime is not initialized");
  }
  return sourceServerHostRuntime;
}

/** Source 发布/项目广播只触发订阅者重新读取，不携带项目数据。 */
function notifyProjectChange(): void {
  void activeServices
    ?.get(IBroadcastService)
    .send({ channel: "state:projects", payload: {} })
    .catch((error) => logger.warn("failed to notify project change", error));
}

async function createWindowRemoteConnectionHandle(params: {
  target: RemoteTarget;
  membershipIntent?: "add" | "retain";
  existingSourceServerId?: string;
  remoteAssets: RemoteAssetDirs;
  signal: AbortSignal;
  confirmSourceServerInstall?: boolean;
}): Promise<WindowRemoteConnectionHandle<ServiceCollection, HostRemoteConnectionCapabilities>> {
  if (!activeServices) throw new Error("Local Host services are not initialized.");
  const clientConfigService = activeServices.get(IClientConfigService);
  if (params.signal.aborted) {
    throw new Error("远程连接已取消");
  }
  const closeListeners = new Set<(event: WindowRemoteConnectionCloseEvent) => void>();
  const reconnectListeners = new Set<() => void>();
  const notifyClose = (event: WindowRemoteConnectionCloseEvent) => {
    for (const listener of closeListeners) {
      listener(event);
    }
  };
  let connection: WindowPhysicalConnection;
  let managedProfile: ConnectionProfile | undefined;
  let reusedConnectionTarget: RemoteTarget | undefined;
  let managerStateSubscription: { dispose(): void } | undefined;
  let managerConnectionInvalidatedSubscription: { dispose(): void } | undefined;
  let managerReconnectSubscription: { dispose(): void } | undefined;
  let services: ServiceCollection;
  let lastNotifiedRecoveryAttempt = 0;
  let disposed = false;

  if (params.target.kind === "server") {
    // 直连 URL Source：成员 admission / commit 与 SSH/WSL/Docker 共用同一投影，
    // 但物理连接不经过 SourceServerConnectionManager。
    if (params.existingSourceServerId) throw new Error("project.host-offline");
    const admission = await prepareRemoteServerConnection({
      service: activeServices.get(IRemoteProjectService),
      credentials: activeServices.get(ICredentialService),
      target: params.target,
      intent: params.membershipIntent ?? "add",
    });
    params.signal.throwIfAborted();
    const serverConnection = await connectServerRemote(admission.target, {
      signal: params.signal,
      fetchImpl: requireActiveHostApiNetworkTransport().fetch,
      commitMembership: admission.commit,
      onClose: ({ code, reason }) => {
        notifyClose({ exitCode: code, signal: null, ...(reason ? { error: reason } : {}) });
      },
    });
    connection = {
      serverInfo: serverConnection.serverInfo,
      services: serverConnection.services,
      dispose: () => serverConnection.dispose(),
    };
  } else {
    const runtime = requireSourceServerRuntime();
    const manager = runtime.manager;
    const directory = runtime.directory;
    const existingProfile = params.existingSourceServerId
      ? (await directory.snapshot()).profiles.find(
          (item) => item.sourceServerId === params.existingSourceServerId,
        )
      : undefined;
    const existingConnection = params.existingSourceServerId
      ? manager.getOnlineConnection(params.existingSourceServerId)
      : undefined;
    if (params.existingSourceServerId && (!existingProfile || !existingConnection)) {
      throw new Error("project.host-offline");
    }
    const { profile, connection: managed } =
      existingProfile && existingConnection
        ? { profile: existingProfile, connection: existingConnection }
        : await connectSourceServerTarget(directory, manager, {
            ...(params.membershipIntent ? { membershipIntent: params.membershipIntent } : {}),
            target: params.target,
            // 窗口连接沿用既有部署语义：远端尚未安装 Source 时允许本次连接安装；
            // 设置页的显式安装确认仍走 connectProfile / confirmIdentityChange。
            allowInstall: params.confirmSourceServerInstall ?? true,
            context: {
              signal: params.signal,
              onLog: (event) => {
                const progress =
                  event.progress == null
                    ? ""
                    : ` ${(Math.max(0, Math.min(1, event.progress)) * 100).toFixed(1)}%`;
                const message =
                  event.progress == null || event.message.startsWith("upload progress:")
                    ? `[source-server:${event.phase}] ${event.message}`
                    : `[source-server:${event.phase}] upload progress (${event.message}):${progress}`;
                remoteConnectionProgressContext.report(event.level ?? "info", [message]);
              },
            },
          });
    managedProfile = profile;
    reusedConnectionTarget = managed.reusedConnectionTarget;
    managerStateSubscription = manager.onDidChangeState((state) => {
      if (state.profileId !== profile.profileId) return;
      if (state.state === "online") {
        lastNotifiedRecoveryAttempt = 0;
        return;
      }
      const closeEvent = createSourceServerRecoveryCloseEvent(state);
      if (!closeEvent) return;
      if (state.state === "retrying" && state.recoveryAttempt === lastNotifiedRecoveryAttempt) {
        return;
      }
      if (state.state === "retrying") {
        lastNotifiedRecoveryAttempt = state.recoveryAttempt ?? lastNotifiedRecoveryAttempt;
      }
      notifyClose(closeEvent);
    });
    connection = {
      serverInfo: managed.serverInfo,
      services: managed.services,
      dispose() {
        // Bug 原因：Window registry handle 是 logical/attachment lease，不是 Source connection owner。
        // 旧 entry 取消或迟到恢复时若断开 Manager，会拆掉新 entry 正在共享的 Source。
        // 真实物理连接由 SourceServerConnectionManager 在显式断开或 Host shutdown 回收。
      },
    };
    managerConnectionInvalidatedSubscription = manager.onDidInvalidateConnection((event) => {
      if (event.sourceServerId !== managed.sourceServerId || disposed) return;
      // 物理连接被更新或 Profile 被删除时，logical workspace 不能继续以 online 持有失效 services。
      // 更新允许自动恢复；删除当前 Profile 属于用户显式断开，必须发布 terminal close。
      notifyClose({
        exitCode: null,
        signal: null,
        recoverable: event.reason === "update",
      });
    });
    managerReconnectSubscription = manager.onDidReconnect((reconnected) => {
      if (reconnected.sourceServerId !== managed.sourceServerId || disposed) return;
      connection = {
        serverInfo: reconnected.serverInfo,
        services: reconnected.services,
        dispose() {
          // 同上：只释放当前 wrapper 的订阅，不跨 lease 关闭共享 Source。
        },
      };
      services = createServerRemoteWorkspaceServiceCollection({
        clientConfigService,
        connectionServices: reconnected.services,
        virtualProjects: reconnected.serverInfo.capabilities.virtualProjects === true,
        targetKind: params.target.kind,
        ...(activeServices && params.target.kind !== "server"
          ? { sourceServices: activeServices }
          : {}),
      });
      lastNotifiedRecoveryAttempt = 0;
      for (const listener of reconnectListeners) listener();
    });
  }

  if (params.signal.aborted) {
    await disposeHostRemoteConnection(connection);
    throw new Error("远程连接已取消");
  }

  services = createServerRemoteWorkspaceServiceCollection({
    clientConfigService,
    connectionServices: connection.services,
    virtualProjects: connection.serverInfo.capabilities.virtualProjects === true,
    targetKind: params.target.kind,
    ...(activeServices && params.target.kind !== "server"
      ? { sourceServices: activeServices }
      : {}),
  });

  const buildCapabilities = (): HostRemoteConnectionCapabilities => {
    const serverId = connection.serverInfo.serverId;
    // 受管 Source 的附件暂存必须复用 Manager 当前 transport；直连 server 直接走远端 RPC。
    // 这里只登记能力，真正解析 file transfer 必须发生在 attachment/录制使用时：
    // Registry 会频繁读取 capabilities（sourceServerId / keep-alive），离线恢复期间
    // getFileTransfer 会拒绝，不能让它把 bookkeeping 变成连接失败。
    const managedSource = managedProfile !== undefined && sourceServerHostRuntime !== null;
    const resolveFileTransfer = () =>
      requireSourceServerRuntime().manager.getFileTransfer(connection.serverInfo.serverId);
    const browserRecordingUploader: Pick<IRemoteBackend, "upload"> | undefined = managedSource
      ? {
          upload: (localPath, remotePath, options) =>
            resolveFileTransfer().upload(localPath, remotePath, options),
        }
      : undefined;
    const remoteMediaPreviewFactory =
      params.target.kind === "server" || !remoteMediaRangePreviewEnabled
        ? undefined
        : (scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>) =>
            createRemoteMediaPreviewProxy({
              fileService: services.get(IFileService),
              logger: {
                debug: (message, metadata) => {
                  if (process.env.NODE_ENV !== "production") logger.info(message, metadata);
                },
                warn: (message, metadata) => logger.warn(message, metadata),
              },
              scope,
              requestLimiter: hostRemoteMediaRequestLimiter,
            });
    return {
      sourceServerId: serverId,
      ...(browserRecordingUploader ? { browserRecordingUploader } : {}),
      ...(remoteMediaPreviewFactory ? { remoteMediaPreviewFactory } : {}),
      persistentSourceConnection: true,
      ...(managedProfile ? { profileId: managedProfile.profileId } : {}),
      ...(managedSource
        ? {
            promptAttachmentTransferFactory: () =>
              createRemotePromptAttachmentTransferService(resolveFileTransfer(), {
                onJanitorError: (error: unknown) =>
                  logger.warn("remote prompt attachment janitor failed", error),
              }),
          }
        : {}),
      bindWorkspaceIdentity: async (input) => {
        input.signal?.throwIfAborted();
        const workspaceService = connection.services.sourceServerWorkspaceService;
        if (!workspaceService) {
          throw new Error("Source Server workspace identity service is unavailable");
        }
        const currentRouteHint = buildRemoteWorkspaceIdentity(input.workspacePath, params.target);
        const runtime = sourceServerHostRuntime;
        const profile = managedProfile;
        if (runtime && profile) {
          const legacyRouteHint = await runtime.directory.resolveLegacyWorkspaceIdentity({
            profileId: profile.profileId,
            workspacePath: input.workspacePath,
            fallback: input.legacyRouteHint ?? currentRouteHint,
          });
          input.signal?.throwIfAborted();
          await workspaceService.resolveWorkspace({
            workspacePath: input.workspacePath,
            legacyRouteHint,
          });
          return;
        }
        // 直连 server：身份由远端 Server 解析，不存在本地 Profile 历史。
        await workspaceService.resolveWorkspace({
          workspacePath: input.workspacePath,
        });
      },
    };
  };

  return {
    ...(reusedConnectionTarget ? { reusedConnectionTarget } : {}),
    get services() {
      return services;
    },
    get sourceServerId() {
      return connection.serverInfo.serverId;
    },
    get capabilities() {
      return buildCapabilities();
    },
    onDidClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => closeListeners.delete(listener) };
    },
    onDidReconnect(listener) {
      reconnectListeners.add(listener);
      return { dispose: () => reconnectListeners.delete(listener) };
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      closeListeners.clear();
      reconnectListeners.clear();
      managerStateSubscription?.dispose();
      managerConnectionInvalidatedSubscription?.dispose();
      managerReconnectSubscription?.dispose();
      await disposeHostRemoteConnection(connection);
    },
  };
}

const windowRemoteConnectionRegistry = createWindowRemoteConnectionRegistry<
  ServiceCollection,
  HostRemoteConnectionCapabilities
>({
  connect: (request) => createWindowRemoteConnectionHandle(request),
  createId: randomUUID,
  onConnectionChanged: notifyProjectChange,
  resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
  // 受管 Source 的物理连接由 Manager 持有，logical session 清空只释放 lease；
  // 直连 server 同样保持 window-scoped 在线连接，供项目导航复用。
  shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistentSourceConnection === true,
  prepareWorkspaceIdentity: async (handle, input) => {
    await prepareRemoteWorkspaceIdentity(
      handle.services.get(IFileService),
      input,
      handle.capabilities?.bindWorkspaceIdentity,
    );
  },
  releaseWorkspace: async (services, context) => {
    await services.get(IYCodeTaskService).releaseWorkspacePreparation({
      workspacePath: context.workspacePath,
      ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
      provider: "glm",
    });
    logger.info(
      `released WSL workspace runtime, workspaceKey=${context.workspaceIdentity?.trim() || context.workspacePath}`,
    );
  },
  onWorkspaceReleaseError: (context, error) => {
    logger.warn(
      `failed to release WSL workspace runtime, workspaceKey=${context.workspaceIdentity?.trim() || context.workspacePath}`,
      error,
    );
  },
  onSessionClosed: (event) => {
    // logical session 已离线时 attachment 仍持有旧 services/订阅；后续 sessionId
    // 换代只释放 transport，无法按旧 ID 找回这些端口。Host 在失效源头统一关闭所有 clientMode。
    windowHostAttachmentRegistry.detachRemoteSessionAttachments(event.remoteSessionId);
    const session = windowRemoteConnectionRegistry.getSession(event.remoteSessionId);
    if (session?.workspacePath && session.workspaceIdentity) {
      windowHostControllerRuntime.disconnectSource({
        kind: "remote",
        ...(session.sourceServerId ? { sourceServerId: session.sourceServerId } : {}),
        remoteSessionId: event.remoteSessionId,
        workspacePath: session.workspacePath,
        workspaceIdentity: session.workspaceIdentity,
      });
    }
    parentPort?.postMessage({
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: event.remoteSessionId,
      reason: "connection-closed",
      exitCode: event.exitCode,
      signal: event.signal,
      ...(event.recoverable !== undefined ? { recoverable: event.recoverable } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.recoveryAttempt ? { recoveryAttempt: event.recoveryAttempt } : {}),
      ...(event.recoveryLimit ? { recoveryLimit: event.recoveryLimit } : {}),
      ...(event.recoveryBudgetExhausted !== undefined
        ? { recoveryBudgetExhausted: event.recoveryBudgetExhausted }
        : {}),
      ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
      ...(event.retryable !== undefined ? { retryable: event.retryable } : {}),
    });
    logWindowHostTopology("remote-connection-closed");
  },
  onSessionReconnected: async ({
    previous,
    current,
    services: currentServices,
    isCurrent,
    commit,
  }) => {
    if (!isCurrent()) {
      throw new Error("Source 重连换代已失去 Registry owner");
    }
    if (
      !previous.workspacePath ||
      !previous.workspaceIdentity ||
      !current.workspacePath ||
      !current.workspaceIdentity
    ) {
      throw new Error("Source 重连换代缺少 workspace scope");
    }
    const previousScope = {
      kind: "remote" as const,
      ...(previous.sourceServerId ? { sourceServerId: previous.sourceServerId } : {}),
      remoteSessionId: previous.remoteSessionId,
      workspacePath: previous.workspacePath,
      workspaceIdentity: previous.workspaceIdentity,
    };
    const currentScope = {
      kind: "remote" as const,
      ...(current.sourceServerId ? { sourceServerId: current.sourceServerId } : {}),
      remoteSessionId: current.remoteSessionId,
      workspacePath: current.workspacePath,
      workspaceIdentity: current.workspaceIdentity,
    };
    // Source transport 已恢复：先尝试原子替换离线投影，再让 Registry 提交新 generation。
    // 投影读取失败不能回滚已经恢复的物理连接；Controller 会保留 pending replacement，
    // 后续 query 成功后原子替换（与手动重连路径一致）。
    try {
      await windowHostControllerRuntime.replaceDisconnectedSource(previousScope, {
        scope: currentScope,
        taskService: currentServices.get(IYCodeTaskService),
        agentService: currentServices.getOptional(IYCodeAgentService),
        sourceAvailability: "online",
      });
    } catch (error) {
      logger.warn("failed to atomically replace disconnected Controller source", error);
    }
    if (!commit()) {
      throw new Error("Source 重连换代在 Controller 提交后失去 Registry owner");
    }
    try {
      parentPort?.postMessage({
        type: HostResponseTypes.RemoteWorkspaceReconnected,
        previousRemoteSessionId: previous.remoteSessionId,
        descriptor: {
          ...(current.sourceServerId ? { sourceServerId: current.sourceServerId } : {}),
          remoteSessionId: current.remoteSessionId,
          target: current.target,
          workspacePath: current.workspacePath,
          workspaceIdentity: current.workspaceIdentity,
          generation: current.generation,
        },
      });
    } catch (error) {
      // Controller 已提交新 generation 后不能再让 Registry 回滚；parentPort 失效意味着
      // Window Host 与 Main 的进程通道正在终止，交给既有 Host shutdown 回收全部 owner。
      logger.error("failed to publish committed remote workspace replacement", error);
    }
    logWindowHostTopology("remote-connection-reconnected");
  },
  onSessionReconnectError: (error) => {
    logger.warn("failed to replace Source Server logical sessions after reconnect", error);
  },
});

const windowHostControllerRuntime = createWindowHostControllerRuntime({
  createId: randomUUID,
  onSourceError: (scope, operation, error) => {
    logger.warn(
      `window Controller source ${operation} failed, scope=${scope.kind}, workspaceKey=${scope.workspaceIdentity?.trim() || scope.workspacePath}`,
      error,
    );
  },
  resolveSource: (scope) => {
    const remoteSession = windowRemoteConnectionRegistry.findSessionForWorkspace(scope);
    if (remoteSession?.workspacePath && remoteSession.workspaceIdentity) {
      const controllerScope = {
        kind: "remote" as const,
        ...(remoteSession.sourceServerId ? { sourceServerId: remoteSession.sourceServerId } : {}),
        remoteSessionId: remoteSession.remoteSessionId,
        workspacePath: remoteSession.workspacePath,
        workspaceIdentity: remoteSession.workspaceIdentity,
      };
      if (remoteSession.sourceAvailability !== "online") {
        return { scope: controllerScope, sourceAvailability: "offline" as const };
      }
      const services = windowRemoteConnectionRegistry.resolveScopedServices(controllerScope);
      return {
        scope: controllerScope,
        taskService: services.get(IYCodeTaskService),
        agentService: services.getOptional(IYCodeAgentService),
        sourceAvailability: "online" as const,
      };
    }
    // 远程 history scope 未连接或已被移除时，绝不能落回本地 tasks-index。
    if (scope.workspaceIdentity && isRemoteWorkspaceIdentity(scope.workspaceIdentity)) {
      return null;
    }
    const taskService = activeServices?.getOptional(IYCodeTaskService);
    if (!taskService) {
      return null;
    }
    return {
      scope: {
        kind: "local" as const,
        workspacePath: scope.workspacePath,
        ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
      },
      taskService,
      agentService: activeServices?.getOptional(IYCodeAgentService),
      sourceAvailability: "online" as const,
    };
  },
});

type ExposedServicePortHandle = {
  server: IChannelServer & { ready(): void };
  dispose(): void;
};

function createControllerRoutedTaskService(
  base: IYCodeTaskService,
  attachmentScope: WindowHostAttachmentScope,
): IYCodeTaskService {
  const route = async (
    params: {
      taskId: string;
      workspacePath: string;
      workspaceIdentity?: string;
    },
    mutation:
      | { kind: "pin"; pinned: boolean }
      | { kind: "archive"; archived: boolean }
      | { kind: "delete" }
      | { kind: "mark-read"; expectedUnreadAt?: number }
      | { kind: "mark-unread" },
  ) =>
    windowHostControllerRuntime.service.mutateTask({
      address: await windowHostControllerRuntime.resolveTaskAddress({
        taskId: params.taskId,
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        attachmentScope,
      }),
      mutation,
    });

  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "setTaskPinned") {
        return async (params: Parameters<IYCodeTaskService["setTaskPinned"]>[0]) => {
          const meta = await route(params, { kind: "pin", pinned: params.pinned });
          if (!meta) throw new Error("pin mutation 后 task 投影缺失");
          return meta;
        };
      }
      if (property === "archiveTask" || property === "unarchiveTask") {
        return async (
          params:
            | Parameters<IYCodeTaskService["archiveTask"]>[0]
            | Parameters<IYCodeTaskService["unarchiveTask"]>[0],
        ) => {
          const meta = await route(params, {
            kind: "archive",
            archived: property === "archiveTask",
          });
          if (!meta) throw new Error("archive mutation 后 task 投影缺失");
          return meta;
        };
      }
      if (property === "deleteTask") {
        return async (params: Parameters<IYCodeTaskService["deleteTask"]>[0]) => {
          await route(params, { kind: "delete" });
        };
      }
      if (property === "previewTaskStorage") {
        return async (params: Parameters<IYCodeTaskService["previewTaskStorage"]>[0]) =>
          windowHostControllerRuntime.service.previewTaskStorage({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              ...params,
              attachmentScope,
              allowMissingTask: true,
            }),
          });
      }
      if (property === "purgeTaskStorage") {
        return async (params: Parameters<IYCodeTaskService["purgeTaskStorage"]>[0]) =>
          windowHostControllerRuntime.service.purgeTaskStorage({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              ...params,
              attachmentScope,
              allowMissingTask: true,
            }),
            expectedRevision: params.expectedRevision,
            confirmPermanent: params.confirmPermanent,
          });
      }
      if (property === "getTaskDatabaseStats") {
        return async (params: Parameters<IYCodeTaskService["getTaskDatabaseStats"]>[0]) =>
          windowHostControllerRuntime.service.getTaskDatabaseStats({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              ...params,
              attachmentScope,
              allowMissingTask: true,
            }),
          });
      }
      if (property === "optimizeTaskDatabase") {
        return async (params: Parameters<IYCodeTaskService["optimizeTaskDatabase"]>[0]) =>
          windowHostControllerRuntime.service.optimizeTaskDatabase({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              ...params,
              attachmentScope,
              allowMissingTask: true,
            }),
            confirm: params.confirm,
          });
      }
      if (property === "deleteArchivedTasks") {
        return async (params: Parameters<IYCodeTaskService["deleteArchivedTasks"]>[0]) => {
          if (params.taskIds.length === 0) {
            return { deletedTaskIds: [], skippedTaskIds: [], failedTaskIds: [] };
          }
          return windowHostControllerRuntime.service.deleteArchivedTasks({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              workspacePath: params.workspacePath,
              workspaceIdentity: params.workspaceIdentity,
              taskId: params.taskIds[0]!,
              attachmentScope,
              allowMissingTask: true,
            }),
            taskIds: params.taskIds,
          });
        };
      }
      if (property === "deleteArchivedTask") {
        return async (params: Parameters<IYCodeTaskService["deleteArchivedTask"]>[0]) =>
          windowHostControllerRuntime.service.deleteArchivedTask({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              ...params,
              attachmentScope,
              allowMissingTask: true,
            }),
          });
      }
      if (property === "setTaskUnread") {
        return async (params: Parameters<IYCodeTaskService["setTaskUnread"]>[0]) => {
          const meta = await route(
            params,
            params.unread
              ? { kind: "mark-unread" }
              : {
                  kind: "mark-read",
                  ...(params.expectedUnreadAt != null
                    ? { expectedUnreadAt: params.expectedUnreadAt }
                    : {}),
                },
          );
          if (!meta) throw new Error("unread mutation 后 task 投影缺失");
          return meta;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function exposeServicesOnMessagePort(
  port: Electron.MessagePortMain,
  services: ServiceCollection,
  deferInit: boolean,
  clientMode: YCodeAgentV4ClientMode = "desktop-continuous",
  attachmentScope: WindowHostAttachmentScope = { kind: "local" },
  capabilities?: HostRemoteConnectionCapabilities,
): ExposedServicePortHandle {
  const wrappedPort = wrapElectronPort(port);
  const protocol = new MessagePortProtocol(wrappedPort);
  // remote 模式延迟发送 Initialize：远程建连需要时间，如果构造时就发 Initialize，
  // renderer 会立即发请求但 channel 还没注册，导致 "Unknown channel" 超时错误。
  // attach 模式复用已就绪服务，必须立即初始化新的 RPC MessagePort。
  logger.info(`creating ChannelServer (deferInit=${deferInit})`);
  const rawServer = new ChannelServer(protocol, "host", 1000, deferInit);
  const loggedServer = new LoggingChannelServer(rawServer, logRpc);
  const server = loggedServer;
  const agentService = services.getOptional(IYCodeAgentService);
  const connectionScope = agentService
    ? createYCodeAgentConnectionScope(agentService, {
        connectionId: `host-rpc-${randomUUID()}`,
        clientMode,
      })
    : undefined;
  services.register(IWindowControllerService, windowHostControllerRuntime.service);
  const controllerAttachment = windowHostControllerRuntime.createAttachmentService();
  const overrides = new Map<string, unknown>([
    [IWindowControllerService.channelName, controllerAttachment],
  ]);
  // 远端媒体必须按 attachment 的 clientMode 选择数据面：桌面使用 Host loopback Range，手机保持 inline。
  const remoteMediaPreviewProxy =
    attachmentScope.kind === "remote" && clientMode === "desktop-continuous"
      ? capabilities?.remoteMediaPreviewFactory?.(attachmentScope)
      : undefined;
  if (remoteMediaPreviewProxy) {
    overrides.set(IMediaPreviewService.channelName, remoteMediaPreviewProxy.service);
  }
  // 跨机附件暂存必须复用 owning Window Host 的当前 transport；远端 Source 无法读取 Desktop localPath。
  const remotePromptAttachmentTransfer =
    attachmentScope.kind === "remote"
      ? capabilities?.promptAttachmentTransferFactory?.(attachmentScope)
      : undefined;
  if (remotePromptAttachmentTransfer) {
    overrides.set(IPromptAttachmentTransferService.channelName, remotePromptAttachmentTransfer);
  }
  const taskService = services.getOptional(IYCodeTaskService);
  if (taskService) {
    overrides.set(
      IYCodeTaskService.channelName,
      createControllerRoutedTaskService(taskService, attachmentScope),
    );
  }
  if (connectionScope) {
    overrides.set(IYCodeAgentService.channelName, connectionScope.service);
  }
  services.exposeOnChannelServer(server, overrides);
  let disposed = false;
  let flowUpdateChain = Promise.resolve();
  const forwardFlowState = (state: "saturated" | "drained" | "closed") => {
    if (!connectionScope) return Promise.resolve();
    const update = flowUpdateChain.then(() => connectionScope.setTransportFlowState(state));
    flowUpdateChain = update.catch((error) => {
      logger.warn("failed to forward attachment connection flow state", {
        state,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return update;
  };
  const flowStateDisposable = protocol.onFlowState((state) => {
    if (disposed) return;
    // MessagePort sideband 已在 protocol 层与 Uint8Array 分流；这里只把 owning scope
    // 的 edge 串行送往 CLI，不能由 control object 指定 connectionId。
    void forwardFlowState(state).catch(() => {});
  });
  const handle: ExposedServicePortHandle = {
    server,
    dispose() {
      if (disposed) return;
      disposed = true;
      flowStateDisposable.dispose();
      controllerAttachment.dispose();
      void remoteMediaPreviewProxy?.dispose().catch((error: unknown) => {
        logger.warn("failed to dispose remote media preview proxy", error);
      });
      // close 排在所有已接收 SAT/DRN 之后；scope.dispose 自身会再次幂等确保 closed，
      // 但绝不让迟到 saturated 在 close 后复活 CLI pause state。
      void forwardFlowState("closed")
        .catch(() => {})
        .then(() => connectionScope?.dispose());
      rawServer.dispose();
      protocol.disconnect();
    },
  };
  port.once("close", () => handle.dispose());
  logger.info(`service connection ready mode=${clientMode}`);
  return handle;
}

const windowHostAttachmentRegistry = createWindowHostAttachmentRegistry<
  ServiceCollection,
  Electron.MessagePortMain,
  HostRemoteConnectionCapabilities
>({
  resolveScope: (scope: WindowHostAttachmentScope) => {
    if (scope.kind === "local") {
      if (!activeServices) {
        throw new Error("local services 尚未初始化");
      }
      return { services: activeServices, generation: 1 };
    }
    const session = windowRemoteConnectionRegistry.getSession(scope.remoteSessionId);
    if (!session) {
      throw new Error(`未找到远程 logical session，remoteSessionId=${scope.remoteSessionId}`);
    }
    return {
      services: windowRemoteConnectionRegistry.resolveScopedServices(scope),
      generation: session.generation,
      capabilities: windowRemoteConnectionRegistry.resolveScopedCapabilities(scope),
    };
  },
  expose: ({ port, services, clientMode, scope, capabilities }) =>
    exposeServicesOnMessagePort(port, services, false, clientMode, scope, capabilities),
});

function logWindowHostTopology(reason: string): void {
  const stats = windowRemoteConnectionRegistry.getStats();
  logger.info(
    `window Host topology, reason=${reason}, pid=${process.pid}, connections=${stats.connectionCount}, logicalSessions=${stats.logicalSessionCount}, attachments=${windowHostAttachmentRegistry.size()}`,
  );
}

function disposeAttachedServicePorts(): void {
  windowHostAttachmentRegistry.dispose();
}

async function disposeHostResources(reason: string): Promise<HostShutdownResult> {
  databaseStartup?.dispose();
  pendingStartupAttachments.clear();
  if (hasDisposedHostResources) {
    return (
      (await disposeHostResourcesInFlight) ?? {
        exitCode: 0,
        failedPhases: [],
        timedOutPhases: [],
      }
    );
  }
  hasDisposedHostResources = true;

  disposeHostResourcesInFlight = (async () => {
    logger.info(`disposing host resources, reason=${reason}`);

    disposeAttachedServicePorts();
    windowHostControllerRuntime.dispose();
    for (const key of Array.from(cronRunSubscriptions.keys())) {
      disposeCronRunSubscription(key);
    }
    cronAutomationRepo.close();

    if (activeSessionRealtimePort) {
      activeSessionRealtimePort.dispose();
      activeSessionRealtimePort = null;
    }

    const servicesToDispose = activeServices;
    activeServices = null;
    // Registry 是全部远端 connection 的唯一 owner；释放失败不能阻塞本地服务继续收口。
    const shutdownResult = await runHostShutdownPhases(
      [
        {
          name: "remote-registry-dispose",
          run: () => windowRemoteConnectionRegistry.dispose(),
          timeoutMs: 6_000,
        },
        {
          name: "source-server-runtime-dispose",
          run: async () => {
            sourceServerHostRuntime?.dispose();
            sourceServerHostRuntime = null;
          },
          timeoutMs: 2_000,
        },
        ...(servicesToDispose
          ? [
              {
                name: "service-dispose",
                run: () => disposeServiceResourcesAndWait(servicesToDispose),
                timeoutMs: 3_500,
              },
            ]
          : []),
      ],
      {
        phaseTimeoutMs: 5_000,
        log: (message, details) => logger.warn(message, details),
      },
    );
    if (shutdownResult.exitCode !== 0) {
      logger.warn("host resource cleanup completed with errors", {
        failedPhases: shutdownResult.failedPhases,
        reason,
        timedOutPhases: shutdownResult.timedOutPhases,
      });
    }
    activeHostApiNetworkTransport = null;
    return shutdownResult;
  })();

  const shutdownResult = await disposeHostResourcesInFlight;
  flushHostE2ECoverage((error) => {
    logger.warn("[e2e-coverage] host coverage flush failed", error);
  });
  return shutdownResult;
}

function disposeHostResourcesBestEffort(reason: string): void {
  if (hasDisposedHostResources) {
    return;
  }
  hasDisposedHostResources = true;

  logger.info(`disposing host resources, reason=${reason}`);
  disposeAttachedServicePorts();
  windowHostControllerRuntime.dispose();
  sourceServerHostRuntime?.dispose();
  sourceServerHostRuntime = null;
  for (const key of Array.from(cronRunSubscriptions.keys())) {
    disposeCronRunSubscription(key);
  }
  cronAutomationRepo.close();
  void windowRemoteConnectionRegistry.dispose();

  if (activeServices) {
    try {
      disposeServiceResources(activeServices);
    } catch (error) {
      logger.error("failed to dispose local services:", error);
    } finally {
      activeServices = null;
      activeHostApiNetworkTransport = null;
    }
  }

  if (activeSessionRealtimePort) {
    activeSessionRealtimePort.dispose();
    activeSessionRealtimePort = null;
  }
}

process.once("SIGTERM", () => {
  void disposeHostResources("SIGTERM").then(
    (result) => process.exit(result.exitCode),
    () => process.exit(1),
  );
});

process.once("SIGINT", () => {
  void disposeHostResources("SIGINT").then(
    (result) => process.exit(result.exitCode),
    () => process.exit(1),
  );
});

process.once("disconnect", () => {
  // parent IPC 消失后不会再有人发送 Dispose；有界清理结束后必须明确退出，避免 Host 常驻。
  void disposeHostResources("disconnect").finally(() => process.exit(1));
});

process.once("exit", () => {
  disposeHostResourcesBestEffort("exit");
});

let handlingFatalUncaughtException = false;
process.on(
  "uncaughtException",
  createHostUncaughtExceptionHandler({
    onRecovered: (error, origin) => {
      const memoryUsage = process.memoryUsage();
      logger.warn("contained host allocation failure from native TLS callback", {
        arrayBuffers: memoryUsage.arrayBuffers,
        external: memoryUsage.external,
        heapUsed: memoryUsage.heapUsed,
        message: error.message,
        origin,
        rss: memoryUsage.rss,
      });
    },
    onFatal: (error, origin) => {
      if (handlingFatalUncaughtException) {
        process.exit(1);
      }
      handlingFatalUncaughtException = true;
      logger.error(`uncaughtException origin=${origin}:`, error);
      void disposeHostResources(`uncaughtException:${origin}`).finally(() => process.exit(1));
    },
  }),
);

parentPort.on("message", async (e: Electron.MessageEvent) => {
  const result = parseHostIncomingMessageEvent(e);
  if (!result.success) {
    logger.error("invalid parentPort message:", formatZodError(result.error));
    return;
  }

  const msg = result.data;
  const port = e.ports[0];
  if (msg.type === HostMessageTypes.DatabaseStartupControl) {
    if (msg.control.action === "snapshot") databaseStartup?.coordinator.publish();
    else if (msg.control.action === "retry")
      void databaseStartup?.coordinator.retry(msg.control.attemptId);
    return;
  }

  if (msg.type === HostMessageTypes.CuaPipFocusChanged) {
    const service = activeServices?.getOptional(ICuaPipSessionService);
    if (service) {
      void service.publishFocus(msg.event);
    } else {
      // 取不到服务时过去静默丢弃，focus-changed 于是从链路上凭空消失
      // （dev 实测 0 条，正式包同期 92 条）。补这条才能把「main 没发」与
      // 「host 收到了但服务没注册」分开。
      logger.warn("[cua-pip-session] focus event dropped: service unavailable");
    }
    return;
  }

  if (msg.type === HostMessageTypes.ResourceUsageSnapshotRequest) {
    void hostResourceUsageResponder.handleRequest(msg);
    return;
  }
  if (msg.type === HostMessageTypes.ResourceUsageSnapshotCancel) {
    hostResourceUsageResponder.cancelRequest(msg.requestId);
    return;
  }

  if (msg.type === HostMessageTypes.FeedbackLogArchiveResult) {
    const pending = pendingFeedbackLogArchiveRequests.get(msg.requestId);
    if (!pending) {
      return;
    }
    pendingFeedbackLogArchiveRequests.delete(msg.requestId);
    if (msg.ok && msg.path && typeof msg.size === "number") {
      pending.onProgress?.({ processedBytes: msg.size, totalBytes: msg.size });
      pending.resolve({ path: msg.path, size: msg.size });
      return;
    }
    pending.reject(new Error(msg.error ?? "反馈日志归档创建失败"));
    return;
  }

  if (msg.type === HostMessageTypes.LocalMediaPreviewPathAuthorizeResult) {
    const pending = pendingLocalMediaPreviewPathAuthorizations.get(msg.requestId);
    if (!pending) return;
    pendingLocalMediaPreviewPathAuthorizations.delete(msg.requestId);
    if (msg.ok && msg.path) {
      logger.info("local media preview path authorization OK");
      pending.resolve(msg.path);
    } else {
      pending.reject(new Error(msg.error ?? "本地视频预览路径授权失败"));
    }
    return;
  }

  if (msg.type === HostMessageTypes.CronRun) {
    if (databaseStartup?.coordinator.snapshot.phase !== "ready") {
      parentPort.postMessage({
        type: HostResponseTypes.CronRunResult,
        runId: msg.runId,
        ok: false,
        error: "Local database startup is not ready",
        failureKind: "transient",
      });
      return;
    }
    void (async () => {
      try {
        const dispatchResult = await dispatchCronRun({
          ...msg,
          mode: msg.mode as YCodeTaskMode | undefined,
        });
        parentPort.postMessage({
          type: HostResponseTypes.CronRunResult,
          runId: msg.runId,
          ok: true,
          ...dispatchResult,
        });
      } catch (error) {
        parentPort.postMessage({
          type: HostResponseTypes.CronRunResult,
          runId: msg.runId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          failureKind: "transient",
        });
      }
    })();
    return;
  }

  if (msg.type === HostMessageTypes.BrowserExecuteResult) {
    // main 的 WebContentsView+CDP 执行完 browser 命令，按 requestId 关联回 bridge 的 pending。
    void browserControlMainBridge.handleResult({
      requestId: msg.requestId,
      result: msg.result,
    });
    return;
  }

  if (msg.type === HostMessageTypes.Dispose) {
    // main 进程通知清理（窗口关闭 / app 退出时）
    // 这里必须等待统一资源清理完成（含异步收尾写回），再让进程退出；main 侧仍有强杀 timer 兜底。
    const result = await disposeHostResources("parent dispose");
    process.exit(result.exitCode);
    return;
  }

  if (msg.type === HostMessageTypes.Broadcast) {
    return;
  }

  if (msg.type === HostMessageTypes.SessionMessageDeliver) {
    const ycodeTaskService = activeServices?.getOptional(IYCodeTaskService);
    if (!ycodeTaskService) {
      parentPort.postMessage({
        type: HostResponseTypes.SessionMessageDeliverResult,
        result: {
          error: "YCode task service is not initialized.",
          messageId: msg.request.messageId,
          requestId: msg.request.requestId,
          sessionId: msg.request.fromSessionId,
          status: "failed",
        },
      });
      return;
    }

    void ycodeTaskService
      .deliverSessionMessage(msg.request)
      .then((deliveryResult) => {
        parentPort.postMessage({
          type: HostResponseTypes.SessionMessageDeliverResult,
          result: deliveryResult,
        });
      })
      .catch((error) => {
        parentPort.postMessage({
          type: HostResponseTypes.SessionMessageDeliverResult,
          result: {
            error: error instanceof Error ? error.message : String(error),
            messageId: msg.request.messageId,
            requestId: msg.request.requestId,
            sessionId: msg.request.fromSessionId,
            status: "failed",
          },
        });
      });
    return;
  }

  if (msg.type === HostMessageTypes.SessionMessageDeliveryResult) {
    const ycodeTaskService = activeServices?.getOptional(IYCodeTaskService);
    if (!ycodeTaskService) {
      logger.warn("session message delivery result received before YCode task service initialized");
      return;
    }
    void ycodeTaskService.sendSessionMessageDeliveryResult(msg.result).catch((error) => {
      logger.warn("failed to forward session message delivery result:", error);
    });
    return;
  }

  if (msg.type === HostMessageTypes.ConnectRemoteWorkspace) {
    const workspacePath = msg.workspacePath ?? "/";
    const workspaceIdentity =
      msg.workspaceIdentity ?? buildRemoteWorkspaceIdentity(workspacePath, msg.target);
    logger.info(
      `connecting window-scoped remote source, requestId=${msg.requestId}, target=${formatRemoteTargetForLog(msg.target)}`,
    );
    void remoteConnectionProgressContext
      .run(msg.requestId, () =>
        windowRemoteConnectionRegistry.connect({
          requestId: msg.requestId,
          target: msg.target,
          remoteAssets: msg.remoteAssets,
          workspacePath,
          workspaceIdentity,
          ...(msg.workspacePurpose ? { workspacePurpose: msg.workspacePurpose } : {}),
          ...(msg.confirmSourceServerInstall !== undefined
            ? { confirmSourceServerInstall: msg.confirmSourceServerInstall }
            : {}),
        }),
      )
      .then(async (descriptor) => {
        const replacedOfflineSessions = windowRemoteConnectionRegistry
          .listSessions()
          .filter(
            (session) =>
              session.remoteSessionId !== descriptor.remoteSessionId &&
              session.state === "disconnected" &&
              session.workspacePath === descriptor.workspacePath &&
              session.workspaceIdentity === descriptor.workspaceIdentity,
          );
        for (const replaced of replacedOfflineSessions) {
          if (replaced.workspacePath && replaced.workspaceIdentity) {
            const previousScope = {
              kind: "remote",
              ...(replaced.sourceServerId ? { sourceServerId: replaced.sourceServerId } : {}),
              remoteSessionId: replaced.remoteSessionId,
              workspacePath: replaced.workspacePath,
              workspaceIdentity: replaced.workspaceIdentity,
            } as const;
            const nextScope = {
              kind: "remote",
              ...(descriptor.sourceServerId ? { sourceServerId: descriptor.sourceServerId } : {}),
              remoteSessionId: descriptor.remoteSessionId,
              workspacePath: replaced.workspacePath,
              workspaceIdentity: replaced.workspaceIdentity,
            } as const;
            try {
              const services = windowRemoteConnectionRegistry.resolveScopedServices(nextScope);
              await windowHostControllerRuntime.replaceDisconnectedSource(previousScope, {
                scope: nextScope,
                taskService: services.get(IYCodeTaskService),
                sourceAvailability: "online",
              });
            } catch (error) {
              // source 已连接但 task-index 暂时不可读时不能回滚 transport，也不能删除上一代
              // 离线可信投影。Controller 会保留 pending replacement，后续 query 成功后原子替换。
              logger.warn("failed to atomically replace disconnected Controller source", error);
            }
          }
          windowHostAttachmentRegistry.detachRemoteSessionAttachments(replaced.remoteSessionId);
          await windowRemoteConnectionRegistry.disposeSession(replaced.remoteSessionId);
          // 重连替换后旧 remoteSessionId 已不再可 attachment；同步清理 Main 的端口请求关联，
          // 但不向 Renderer 伪报一次新的 transport failure。
          parentPort.postMessage({
            type: HostResponseTypes.RemoteWorkspaceClosed,
            remoteSessionId: replaced.remoteSessionId,
            reason: "disposed",
          });
        }
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceConnected,
          requestId: msg.requestId,
          descriptor,
        });
        logWindowHostTopology("remote-connected");
      })
      .catch((error) => {
        const failure = normalizeRemoteConnectionError(error);
        // 安装/升级等待是 typed 终态：Renderer 依赖 reasonCode + profileId 进入确认流程，
        // 不能把 Source Server 需要安装误报成普通连接失败。
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceConnectFailed,
          requestId: msg.requestId,
          error: sanitizeRemoteConnectionLog(failure.message) || "Remote connection failed",
          reasonCode: failure.code,
          ...(error instanceof SourceServerUpgradeRequiredError ||
          error instanceof SourceServerInstallRequiredError
            ? { profileId: error.profileId }
            : {}),
          ...((error instanceof SourceServerUpgradeRequiredError ||
            error instanceof SourceServerInstallRequiredError) &&
          msg.target.kind === "wsl"
            ? { resolvedWslTarget: msg.target }
            : {}),
          ...(failure.retryable === undefined ? {} : { retryable: failure.retryable }),
        });
      });
    return;
  }

  if (msg.type === HostMessageTypes.CancelRemoteWorkspaceConnect) {
    windowRemoteConnectionRegistry.cancelConnect(msg.requestId);
    return;
  }

  if (msg.type === HostMessageTypes.BindRemoteWorkspaceContext) {
    const previous = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    let workspaceReady: Promise<void>;
    try {
      workspaceReady = windowRemoteConnectionRegistry.bindWorkspaceContext({
        remoteSessionId: msg.remoteSessionId,
        workspacePath: msg.workspacePath,
        workspaceIdentity: msg.workspaceIdentity,
      });
    } catch (error) {
      logger.warn(
        `failed to bind remote workspace context, remoteSessionId=${msg.remoteSessionId}`,
        error,
      );
      return;
    }
    const current = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    if (current) {
      // scope generation 换代后，旧 Renderer/手机 attachment 不得继续持有远端 IO facade。
      windowHostAttachmentRegistry.detachStaleRemoteSessionAttachments(
        msg.remoteSessionId,
        current.generation,
      );
    }
    void workspaceReady.catch((error) => {
      logger.warn(
        `failed to prepare bound remote workspace, remoteSessionId=${msg.remoteSessionId}`,
        error,
      );
    });
    if (previous?.workspacePath && previous.workspaceIdentity) {
      windowHostControllerRuntime.removeSource({
        kind: "remote",
        ...(previous.sourceServerId ? { sourceServerId: previous.sourceServerId } : {}),
        remoteSessionId: msg.remoteSessionId,
        workspacePath: previous.workspacePath,
        workspaceIdentity: previous.workspaceIdentity,
      });
    }
    logger.info(
      `bound remote workspace context, remoteSessionId=${msg.remoteSessionId}, workspacePath=${msg.workspacePath}`,
    );
    return;
  }

  if (msg.type === HostMessageTypes.DisposeRemoteWorkspaceSession) {
    const disposedSession = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    windowHostAttachmentRegistry.detachRemoteSessionAttachments(msg.remoteSessionId);
    void windowRemoteConnectionRegistry
      .disposeSession(msg.remoteSessionId)
      .then(() => {
        if (disposedSession?.workspacePath && disposedSession.workspaceIdentity) {
          windowHostControllerRuntime.removeSource({
            kind: "remote",
            ...(disposedSession.sourceServerId
              ? { sourceServerId: disposedSession.sourceServerId }
              : {}),
            remoteSessionId: msg.remoteSessionId,
            workspacePath: disposedSession.workspacePath,
            workspaceIdentity: disposedSession.workspaceIdentity,
          });
        }
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceClosed,
          remoteSessionId: msg.remoteSessionId,
          reason: "disposed",
        });
        logWindowHostTopology("remote-session-disposed");
      })
      .catch((error) => {
        logger.warn(
          `failed to dispose remote logical session, remoteSessionId=${msg.remoteSessionId}`,
          error,
        );
      });
    return;
  }

  if (msg.type === HostMessageTypes.AttachServicePort) {
    if (!port) {
      logger.error("attach-service-port message missing MessagePort");
      return;
    }
    if (msg.scope.kind === "local" && databaseStartup?.coordinator.snapshot.phase !== "ready") {
      // 刷新/手机 attachment 复用同一 Host，等待现有准备，不启动第二个执行者。
      pendingStartupAttachments.set(msg.attachmentId, () => {
        windowHostAttachmentRegistry.attach({ ...msg, port });
      });
      port.once("close", () => pendingStartupAttachments.delete(msg.attachmentId));
      return;
    }
    try {
      if (msg.scope.kind === "remote") {
        // Bind 与 Attach 共用 parentPort，但 WSL 上一代 workspace release 可能仍在途。
        // 持有已转移 port 等待 Host 内 generation barrier，避免新 attachment 踩过旧 runtime 清理。
        await windowRemoteConnectionRegistry.waitForScopedServices(msg.scope);
      }
      windowHostAttachmentRegistry.attach({
        requestId: msg.requestId,
        attachmentId: msg.attachmentId,
        clientMode: msg.clientMode,
        scope: msg.scope,
        port,
      });
      logger.info(
        `attached scoped service port, attachmentId=${msg.attachmentId}, scope=${msg.scope.kind}, clientMode=${msg.clientMode}`,
      );
      logWindowHostTopology("attachment-added");
    } catch (error) {
      // 跨 logical session 或旧 identity 的 port 若继续暴露，会把远端请求路由到错误 source。
      // scope 校验失败必须关闭已转移端口并明确记录，禁止回退 active local services。
      rejectUnavailableAttachedServicePort(port, false);
      logger.warn(`failed to attach scoped service port, attachmentId=${msg.attachmentId}`, error);
    }
    return;
  }

  if (msg.type === HostMessageTypes.DetachServicePort) {
    pendingStartupAttachments.delete(msg.attachmentId);
    windowHostAttachmentRegistry.detach(msg.attachmentId);
    logger.info(`detached service port, attachmentId=${msg.attachmentId}`);
    logWindowHostTopology("attachment-removed");
    return;
  }

  if (!port) {
    return;
  }

  if (msg.type === HostMessageTypes.InitLocal) {
    if (!port) {
      logger.error("init-local message missing MessagePort");
      return;
    }
    if (databaseStartup) {
      port.close();
      databaseStartup.coordinator.publish();
      return;
    }
    let basePortClosed = false;
    port.once("close", () => {
      basePortClosed = true;
    });
    databaseStartup = createHostDatabaseStartup({
      startupId: msg.databaseStartupId,
      cwd: msg.agentSpawnFallbackCwd ?? process.cwd(),
      workingDirectories:
        msg.agentWarmupTargets?.map((target) => target.workspacePath) ??
        (msg.workspacePath ? [msg.workspacePath] : []),
      env: msg.runtimeProcessEnvPatch,
      publish: (state) => {
        parentPort?.postMessage({ type: HostResponseTypes.DatabaseStartupState, state });
        if (state.phase === "ready") {
          for (const attach of pendingStartupAttachments.values()) {
            try {
              attach();
            } catch (error) {
              logger.warn("startup attachment failed", error);
            }
          }
          pendingStartupAttachments.clear();
        }
      },
      onFailure: (error) =>
        logger.error(
          `local database startup failed attempt=${databaseStartup?.coordinator.snapshot.attemptId}`,
          error,
        ),
      initializeServices: async () => {
        logger.info("initializing local services");
        activeSessionRealtimePort = createTaskRealtimeBridgeForHostInit(msg, parentPort);
        // 旧 Team 补组织必须与网络代理读取共用同一个 Setting 实例及写队列。
        // 只注入 service 会跳过默认装配分支，导致缺组织的升级用户永远无法恢复连接。
        const { service: settingService, prepareLegacyAccountConnections } =
          createSettingServiceWithMigrations();
        const hostApiNetworkTransport = createHostApiNetworkTransport(async () => {
          const settings = await settingService.get();
          return {
            httpProxy: settings.httpProxy,
            noProxy: settings.httpProxyNoProxy,
            caCertPath: settings.httpProxyCaCertPath,
          };
        });
        const services = await initializeHostApiNetworkTransportOwner({
          transport: hostApiNetworkTransport,
          log: (message, details) => logger.warn(message, details),
          establishOwner: () => {
            const initializedServices = createLocalServices({
              parentPort,
              settingService,
              prepareLegacyAccountConnections,
              hostApiNetworkTransport,
              authorizeLocalMediaPreviewPath,
              runtimeProcessEnvPatch: msg.runtimeProcessEnvPatch,
              agentRuntimeContext: {
                getDeviceMid: () => msg.deviceMid,
                runtimeSurface: "desktop_local_host",
              },
              serviceAuthorityMode: "desktop-local",
              // 远端项目入口的物理连接器：直连 server 走窗口 registry；隧道 Source 复用
              // 同一 runtime 的 Management（Profile/凭据由 Directory 持有）。
              remoteProjectConnection: {
                connectHost: async (host) => {
                  if (host.target?.kind === "server") {
                    const connected = await windowRemoteConnectionRegistry.connectSource({
                      target: host.target,
                      remoteAssets: msg.remoteAssets ?? {},
                      membershipIntent: "retain",
                    });
                    return remoteProjectHostIdForTarget(host.target, connected.sourceServerId);
                  }
                  if (!sourceServerHostRuntime) {
                    throw new Error(
                      "remote-project.connector-unavailable: Source Server runtime is not initialized",
                    );
                  }
                  const management = sourceServerHostRuntime.management;
                  const snapshot = await management.getSnapshot();
                  const profiles = snapshot.profiles.filter(
                    (profile) =>
                      profile.lifecycleState !== "retired" &&
                      remoteProjectHostIdForProfile(profile) === host.id,
                  );
                  const preferred = new Set(
                    snapshot.servers.map((server) => server.preferredProfileId),
                  );
                  const profile =
                    profiles.find((item) => preferred.has(item.profileId)) ?? profiles[0];
                  if (!profile) throw new Error("remote-project.profile-not-found");
                  const connected = await management.connectProfile(profile.profileId, {
                    retainedOnly: true,
                  });
                  const resolved = connected.profiles.find(
                    (item) => item.profileId === profile.profileId,
                  );
                  if (
                    !resolved ||
                    !connected.states.some(
                      (state) => state.profileId === resolved.profileId && state.state === "online",
                    )
                  ) {
                    throw new Error("project.host-offline");
                  }
                  return remoteProjectHostIdForProfile(resolved);
                },
                readConnectionStates: async () => {
                  const result = new Map<
                    string,
                    Pick<
                      RemoteProjectHost,
                      | "connectionStatus"
                      | "lastConnectionError"
                      | "lastConnectionStatus"
                      | "upgradeTarget"
                    >
                  >();
                  for (const state of windowRemoteConnectionRegistry.listConnections()) {
                    if (state.target.kind !== "server") continue;
                    result.set(remoteProjectHostIdForTarget(state.target, state.sourceServerId), {
                      connectionStatus:
                        state.state === "online"
                          ? "online"
                          : state.state === "connecting"
                            ? "connecting"
                            : "offline",
                    });
                  }
                  if (!sourceServerHostRuntime) return result;
                  const snapshot = await sourceServerHostRuntime.directory.snapshot();
                  for (const state of sourceServerHostRuntime.manager.listStates()) {
                    const profile = snapshot.profiles.find(
                      (item) => item.profileId === state.profileId,
                    );
                    if (!profile) continue;
                    const id = remoteProjectHostIdForProfile(profile);
                    const value =
                      state.state === "online"
                        ? "online"
                        : ["bootstrapping", "retrying", "updating"].includes(state.state)
                          ? "connecting"
                          : "offline";
                    if (
                      result.get(id)?.connectionStatus !== "online" &&
                      (result.get(id)?.connectionStatus !== "connecting" || value === "online")
                    ) {
                      result.set(id, {
                        connectionStatus: value,
                        lastConnectionError: state.error,
                        lastConnectionStatus: state.state,
                        upgradeTarget: state.upgradeTarget,
                      });
                    }
                  }
                  return result;
                },
              },
              // 项目服务的跨 host 路由只复用窗口内既有 remote attachment；没有在线 workspace 时显式失败。
              resolveProjectHostService: async (hostId) => {
                // Source 隧道连接没有独立 logical session 时，仍按设备身份路由到既有物理连接；
                // 项目读写前先解析 canonical workspace key，避免 UI 用 stable identity 直接查库。
                const sourceState = sourceServerHostRuntime?.manager.listStates().find((state) => {
                  if (!state.sourceServerId) return false;
                  return (
                    remoteHostIdFromWorkspaceIdentity(
                      buildServerRemoteWorkspaceIdentity({
                        serverId: state.sourceServerId,
                        workspacePath: "/",
                      }),
                    ) === hostId
                  );
                });
                const sourceConnection = sourceState?.sourceServerId
                  ? sourceServerHostRuntime?.manager.getOnlineConnection(sourceState.sourceServerId)
                  : undefined;
                if (sourceConnection?.services.projectService) {
                  const projectService = sourceConnection.services.projectService;
                  const workspaceService = sourceConnection.services.sourceServerWorkspaceService;
                  const sourceServerId = sourceState!.sourceServerId!;
                  if (!workspaceService) throw new Error("project.host-offline");
                  return bindRemoteProjectIdentities(projectService, async (workspacePath) => {
                    await workspaceService.resolveWorkspace({ workspacePath });
                    return buildServerRemoteWorkspaceIdentity({
                      serverId: sourceServerId,
                      workspacePath,
                    });
                  });
                }
                const session = windowRemoteConnectionRegistry
                  .listSessions()
                  .find(
                    (item) =>
                      item.workspaceIdentity &&
                      remoteHostIdFromWorkspaceIdentity(item.workspaceIdentity) === hostId,
                  );
                if (!session?.workspacePath || !session.workspaceIdentity)
                  throw new Error("project.host-offline");
                const scoped = windowRemoteConnectionRegistry.resolveScopedServices({
                  kind: "remote",
                  remoteSessionId: session.remoteSessionId,
                  workspacePath: session.workspacePath,
                  workspaceIdentity: session.workspaceIdentity,
                });
                const service = scoped.getOptional(IProjectService);
                if (!service) throw new Error("project.host-offline");
                const sourceServerId = parseRemoteWorkspaceIdentity(
                  session.workspaceIdentity,
                )?.sourceServerId;
                const workspaceService = scoped.getOptional(ISourceServerWorkspaceService);
                if (!sourceServerId || !workspaceService) return service;
                return bindRemoteProjectIdentities(service, async (workspacePath) => {
                  await workspaceService.resolveWorkspace({
                    workspacePath,
                    legacyRouteHint: session.workspaceIdentity,
                  });
                  return buildServerRemoteWorkspaceIdentity({
                    serverId: sourceServerId,
                    workspacePath,
                  });
                });
              },
              ycodeAgentSpawnFallbackCwd: msg.agentSpawnFallbackCwd,
              ycodeBuiltinProviderConfigFilePath: msg.ycodeBuiltinProviderConfigFilePath,
              processLifecycleReporter: runtimeProcessLifecycleReporter,
              taskRuntimeReporter: runtimeTaskReporter,
              feedback: {
                getDeviceMid: () => msg.deviceMid,
                apiBaseUrl: msg.feedbackApiBase,
                createFullLogArchive: createFullFeedbackLogArchiveViaMain,
              },
              forwardSessionMessageSendRequested: (request) => {
                parentPort?.postMessage({
                  type: HostResponseTypes.SessionMessageSendRequested,
                  request,
                });
              },
              onAutomationManualRunRequested: dispatchManualAutomationRun,
              // browser-use：agent 的 interaction/browserExecute 经 ycodeAgentService 转到这个 executor，
              // 再经 parentPort 到 main 的 WebContentsView+CDP 执行。
              browserControlExecutor: browserControlMainBridge,
              // CUA 顶部提示属于物理 Windows 桌面投影；非 Windows 和远端 authority 都不得上报。
              cuaOperationStateReporter:
                process.platform === "win32" ? cuaOperationStateReporter : undefined,
              // 电脑控制驱动（cua-driver）随包分发，只有 desktop local host 能探测它的状态；
              // 探测实现读 resources/tools（打包态）或 bundled-tools（开发态）并跑 --version。
              computerControlDriverStatusProbe: readComputerControlDriverStatus,
              // 同一个解析器再喂给 spawn env：设置页开启电脑控制后，agent 子进程据此把驱动
              // 组装成内置 MCP server。远端 workspace host 不注入（远控不得操作本机桌面）。
              resolveComputerControlDriverBinaryPath,
            });
            activeServices = initializedServices;
            activeHostApiNetworkTransport = hostApiNetworkTransport;
            return initializedServices;
          },
        });
        const ycodeTaskService = services.getOptional(IYCodeTaskService);
        if (ycodeTaskService) {
          const reportingYCodeTaskService = createReportingRemoteYCodeTaskService(
            ycodeTaskService,
            {
              reportRunningPromptCount: false,
            },
          );
          services.register(IYCodeTaskService, reportingYCodeTaskService);
        }
        // Source Server 运行时仅存在于 desktop local host；远端 Host 不注册管理频道。
        // Application data 目录由 Main 的 remoteAssets 下发，Directory 本身只写 AppSettings。
        const sourceServerArtifactPolicy: SourceServerArtifactPolicy =
          msg.remoteAssets?.sourceServerArtifactPolicy ?? "release-versioned";
        sourceServerHostRuntime = createSourceServerHostRuntime({
          settingService: services.get(ISettingService),
          credentialService: services.get(ICredentialService),
          logger,
          ...(msg.remoteAssets ? { remoteAssets: msg.remoteAssets } : {}),
          artifactPolicy: sourceServerArtifactPolicy,
          fetch: hostApiNetworkTransport.fetch,
          isDisposed: () => hasDisposedHostResources,
          // 成员 admission 与项目广播都注入既有 RemoteProjectService；Manager 不直接持库。
          admitConnection: createRemoteProjectConnectionAdmission(
            services.get(IRemoteProjectService),
          ),
          onProjectChange: notifyProjectChange,
          onBeforeSourceServerRemoved: async (sourceServerId) => {
            // 删除 Source 时同时移除其设备级远端项目 host；不调用远端删除。
            const hostId = remoteHostIdFromWorkspaceIdentity(
              buildServerRemoteWorkspaceIdentity({ serverId: sourceServerId, workspacePath: "/" }),
            );
            if (!hostId) throw new Error("remote-project.invalid-host-identity");
            await services.get(IRemoteProjectService).removeHost(hostId);
          },
          onConnectionLog: (event) => {
            const progress = event.progress == null ? "" : ` ${Math.round(event.progress * 100)}%`;
            logger.info(`[source-server:${event.phase}] ${event.message}${progress}`);
          },
        });
        services.register(ISourceServerManagementService, sourceServerHostRuntime.management);
        hasDisposedHostResources = false;
        disposeHostResourcesInFlight = null;
        const agentWarmupTargets =
          msg.agentWarmupTargets && msg.agentWarmupTargets.length > 0
            ? msg.agentWarmupTargets
            : msg.workspacePath
              ? [
                  {
                    workspacePath: msg.workspacePath,
                    ...(msg.workspaceIdentity ? { workspaceIdentity: msg.workspaceIdentity } : {}),
                  },
                ]
              : [];
        // Main 已按最近使用顺序把启动预热限制为 3 个；Host 必须显式消费这份
        // 固定名单，不能让后续 task-list observer 再隐式扩大，也不能因单个失败扫描补位。
        agentWarmupTargets.forEach((target, index) => {
          warmUpYCodeAgent(
            services,
            target,
            `local host init (${index + 1}/${agentWarmupTargets.length})`,
          );
        });
        logger.info("exposing services on ChannelServer...");
        if (!basePortClosed)
          windowHostAttachmentRegistry.attach({
            requestId: `init-local-${randomUUID()}`,
            attachmentId: `base-${randomUUID()}`,
            clientMode: "desktop-continuous",
            scope: { kind: "local" },
            port,
          });
        logWindowHostTopology("base-attachment-ready");
        logger.info("local services ready, all channels registered");
        // Directory 初始化与启动重连属于远程附加能力：base attachment 已就绪后再后台执行，
        // 不阻塞首帧。开关关闭或目录初始化失败只记录日志，本地 Host 保持可用。
        void sourceServerHostRuntime
          .startStartupReconnect()
          .then((results) => {
            const online = results.filter((result) => result.status === "online").length;
            for (const result of results) {
              if (result.status === "failed") {
                logger.warn("Source Server startup reconnect failed", {
                  profileId: result.profileId,
                  error: result.error,
                });
              }
            }
            logger.info(
              `Source Server startup reconnect finished, online=${online}, failed=${results.length - online}`,
            );
          })
          .catch((error) =>
            logger.warn(
              "Source Server directory initialization failed; local services remain available",
              error,
            ),
          );
      },
    });
    await databaseStartup.coordinator.start();
  }
});
