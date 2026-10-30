import {
  databaseStartupErrorCodeSchema,
  databaseStartupErrorDetailsSchema,
  databaseMigrationFactsSchema,
} from "../database-startup.js";
/* oxlint-disable eslint(max-lines) -- YCode Protocol schema 需要单文件导出，方便 app 与 agent 共享同一份协议契约。 */
// ── 旧协议删除边界──────────────────────
// 剩余 ~257 个导出：旧 YCode Protocol 方法契约、请求/响应/事件 schema、
// session/workspace state snapshot 投影等（承重类型已迁 ycode-protocol-legacy-types.ts）。
// 已连根删除的死词（词表+schema+两侧实现）：session/steer、session/rewind、
// session/rewindCascade、session/previewFileRewind、session/applyFileRewind、
// prompt/enhance 全簇（含 promptEnhanceResult 通知）、plugins/marketplace/list；
// session/fork 客户端链已删（op+schema 留存 = v4 forkSessionAtMessage 钩子消费）。
// 消费者：services 旧栈（ycodeProtocolClient/ycodeAgent/ycodeAgentService/ycodeSession*）、
// CLI bootstrap 旧协议 server（ycode-protocol/server-operations、plugins、session-mapper 等）、
// UI 旧投影（ycodeSessionProjection 等读路径）。
// 上述旧协议 client/server 组删除时，本文件整体删除。
// 注：外部零消费 schema 多为存活 schema 联合的内部依赖，随宿主文件一起处理，勿单删。
import { bashOutputDisplaySchema } from "../bash-output-display.js";
// 后台详情共享精简的只读响应 schema，不携带命令或计时元数据。
export * from "../background-bash-output.js";
import { executionOutputPreviewSchema } from "../execution-output-preview.js";
import { z } from "zod";
export * from "../process-diagnostic.js";
import { errorAttributionSchema } from "../ycode-protocol-v4/snapshot.js";
import { modelSelectionSchema } from "../model-selection.js";
import { completeModelPropertiesDataSchema } from "../model-config.js";
import { modelExecutionSchema } from "../model-execution.js";
import { APP_USAGE_RANGES, appUsageSnapshotSchema } from "../usage-stats.js";
// browser-use 命令/结果契约单一来源：agent 构造、协议校验和 main executor 共用同一 schema。
import { browserClientModeSchema, browserCommandSchema } from "../browser-use/commands.js";
import {
  browserBackendListResultSchema,
  browserSessionContextKindSchema,
} from "../browser-use/backend.js";
import { browserCommandResultSchema } from "../browser-use/result.js";
import { integratedTerminalShellSelectionSchema } from "../validationAppSettings.js";
import { appToolSearchModeSchema } from "../app-runtime-preferences.js";
import { ycodeTaskModeSchema } from "../ycode-task-mode-schema.js";
import {
  ycodeDeliveryKindSchema,
  ycodeMessageVisibilitySchema,
  ycodeSyntheticUserMessageSourceSchema as legacyYcodeSyntheticUserMessageSourceSchema,
  ycodeWorkspaceRefSchema,
  ycodePermissionDecisionSchema,
  ycodePermissionResponseSchema,
  ycodePermissionUpdateSchema,
  ycodeSessionModeSchema,
  ycodeSessionStatusSchema,
  ycodeSessionKindSchema,
  ycodeSessionGoalSchema,
  ycodeSessionGoalVerificationSchema,
  ycodeSessionGoalVerificationTimelineSchema,
  ycodeInteractionRequestOriginSchema,
  ycodeToolStateSchema,
  ycodeSessionApiRetryStatusSchema,
  ycodeSessionContextUsageSchema,
  ycodeSessionInfoSchema,
  ycodeSessionRuntimeStateSchema,
  ycodeMessageWithPartsSchema,
  ycodeMessagePartSchema,
} from "../ycode-protocol-legacy-types.js";

export {
  hookExecutionProjectionSchema,
  hookInvocationRowSchema,
  type HookExecutionProjection,
  type HookInvocationRow,
} from "../ycode-protocol-v4/rows.js";

export const YCODE_PROTOCOL_NAME = "YCode Protocol" as const;
export const YCODE_PROTOCOL_VERSION = 1 as const;
// V4 wire 与 legacy 主协议并存；禁止为了 V4 physical framing 改写 legacy 版本。
export const YCODE_PROTOCOL_V4_WIRE_VERSION = 3 as const;
export const ycodeRuntimeCapabilitiesSchema = z.object({
  independentPlanState: z.boolean().optional(),
});
export const ycodeProtocolErrorCodes = {
  sessionUnavailable: -32004,
} as const;

const nonEmptyString = z.string().trim().min(1);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const timestampMsSchema = z.number().int().nonnegative();
const protocolInstantSchema = z.union([timestampMsSchema, nonEmptyString, z.date()]);

// Tool result display 不受模型文本 budget 约束；Node REPL 图片必须在 Agent/App 协议边界
// 做严格限长，避免截图把 continuous 或 replayable 消息扩成无界载荷。
export const ycodeNodeReplImageToolResultDisplaySchema = z
  .object({
    kind: z.literal("node_repl_images"),
    images: z
      .array(
        z
          .object({
            base64: z
              .string()
              .min(1)
              .max(200 * 1024),
            mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/iu),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    truncated: z.boolean().optional(),
    source: z.literal("browser_turn_end").optional(),
  })
  .strict();

// 同理：CreateWorkflow 的类型检查诊断也是 display 通道，必须在协议边界限长，
// 避免大量诊断把 continuous/replayable 消息扩成无界载荷。
// causalityGraph 在工具输出边界已限长，这里镜像同一组上界（与 v4 rows 保持一致）。
// 图的词汇表刻意很小：step 卡片 + actor 车道 + 一种箭头（runs after，`back` 只标回边）+
// 返回物标记。分析器的 kind / certainty / exact / region 不进载荷。
// 名字只在运行时成形（`` agent(`研究员${i + 1}`) ``）时静态能拿到的形状：第一个洞之前的
// 字面量（head）与最后一个洞之后的字面量（tail）。至少一个在场，两者都已 trim 且含实义字符。
// Bug 修复：这两个字段随 0a8b059f40 落进 contracts 与 v4 镜像，v3 这份漏改——.strict()
// 之下带插值名的工作流会让整个 display 验证失败、图整块消失，所以这里必须与 v4 逐字段对齐。
const ycodeWorkflowNamePatternSchema = z
  .object({
    head: z.string().min(1).max(128).optional(),
    tail: z.string().min(1).max(128).optional(),
  })
  .strict();

// 一条边 = runs after；step 边与阶段边同形，`back` 只标循环回边。
const ycodeWorkflowEdgeSchema = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    back: z.literal(true).optional(),
  })
  .strict();

const ycodeCreateWorkflowCausalityGraphDisplaySchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            kind: z.enum(["ask", "world-read"]),
            label: z.string().min(1).max(128),
            // 内联 `agent()` receiver 让 label 落到兜底串时，那个名字的静态形状。
            labelPattern: ycodeWorkflowNamePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            lane: z.string().min(1).max(64),
            lanes: z.array(z.string().min(1).max(64)).max(32).optional(),
            // 展开自的站点 id，只出现在 may-set 车道展开的拷贝上（实时叠加的关联键）；
            // 加字段是 additive 的，不带它的旧载荷照常通过 .strict()。
            source: z.string().min(1).max(64).optional(),
            // 作者用 `phase("…")` 标记划入的阶段。
            // 与图的 phases / phaseEdges / exits 同进同退：全在场或全缺席。
            phase: z.string().min(1).max(64).optional(),
            repeat: z.enum(["stack", "serial"]).optional(),
          })
          .strict(),
      )
      .max(64),
    lanes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            // `name` 缺席而 agent() 首参是带洞的模板串时的静态形状；与 name 互斥。
            namePattern: ycodeWorkflowNamePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(32),
    // 参与者与交接；镜像 v4。
    participants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            phase: z.string().min(1).max(64),
            lane: z.string().min(1).max(64),
            steps: z.array(z.string().min(1).max(64)).min(1).max(64),
            member: z
              .object({ index: z.number().int().nonnegative(), of: z.number().int().positive() })
              .strict()
              .optional(),
            many: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(64),
    handoffs: z
      .array(
        ycodeWorkflowEdgeSchema
          .extend({ types: z.array(z.string().min(1).max(128)).min(1).max(8).optional() })
          .strict(),
      )
      .max(256),
    // 阶段词汇表：作者施加的分组结构，主画面以它为节点。与 phaseEdges / exits / Step.phase
    // 全有或全无——零标记脚本全缺席，UI 据此退回 step/车道视图。零成员阶段也在表里。
    // `unphased` 无 name，显示名由 UI 本地化。
    phases: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            // 进入本阶段时还在跑的其他阶段（它们的 strand 尚未 join），阶段表序，不含自己，
            // 为空时缺席。是节点事实而不是边——控制没有从那里转移过来，所以不进 phaseEdges。
            // 时间轴据此把相邻阶段折成一条分叉的「带」，侧栏迷你轨道画成双线段。
            alongside: z.array(z.string().min(1).max(64)).min(1).max(32).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    phaseEdges: z.array(ycodeWorkflowEdgeSchema).max(128).optional(),
    // 控制流可在其后正常完成的阶段（阶段视图的「阶段 → 返回物」箭头）；组内可为空数组。
    exits: z.array(z.string().min(1).max(64)).max(32).optional(),
    sink: z.array(z.string().min(1).max(64)).max(64).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const ycodeCreateWorkflowToolResultDisplaySchema = z
  .object({
    kind: z.literal("create_workflow"),
    ok: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    diagnostics: z
      .array(
        z
          .object({
            line: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            code: z.number().int().nonnegative(),
            message: z.string().min(1).max(2_048),
          })
          .strict(),
      )
      .max(100),
    causalityGraph: ycodeCreateWorkflowCausalityGraphDisplaySchema.optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

const ycodeToolResultObjectSchema = jsonObjectSchema.superRefine((result, context) => {
  const display = result.display;
  if (typeof display !== "object" || display === null || Array.isArray(display)) {
    return;
  }
  const kind = (display as Record<string, unknown>).kind;
  const schemaByKind: Record<string, z.ZodTypeAny> = {
    node_repl_images: ycodeNodeReplImageToolResultDisplaySchema,
    create_workflow: ycodeCreateWorkflowToolResultDisplaySchema,
    bash_output: bashOutputDisplaySchema,
  };
  const schema = typeof kind === "string" ? schemaByKind[kind] : undefined;
  if (!schema) return;
  const parsed = schema.safeParse(display);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    context.addIssue({ ...issue, path: ["display", ...issue.path] });
  }
});

export const ycodeProtocolRequestIdSchema = z.union([z.string(), z.number().int()]);
export type YCodeProtocolRequestId = z.infer<typeof ycodeProtocolRequestIdSchema>;

export const ycodeProtocolTraceSchema = z
  .object({
    traceparent: nonEmptyString.optional(),
    traceId: nonEmptyString.optional(),
    parentId: nonEmptyString.optional(),
    spanId: nonEmptyString.optional(),
  })
  .strict();
export type YCodeProtocolTrace = z.infer<typeof ycodeProtocolTraceSchema>;

export const ycodeProtocolRequestSchema = z
  .object({
    id: ycodeProtocolRequestIdSchema,
    method: nonEmptyString,
    params: z.unknown().optional(),
    trace: ycodeProtocolTraceSchema.optional(),
  })
  .strict();
export type YCodeProtocolRequest = z.infer<typeof ycodeProtocolRequestSchema>;

export const ycodeProtocolNotificationSchema = z
  .object({
    method: nonEmptyString,
    params: z.unknown().optional(),
    trace: ycodeProtocolTraceSchema.optional(),
  })
  .strict();
export type YCodeProtocolNotification = z.infer<typeof ycodeProtocolNotificationSchema>;

export const ycodeProtocolResponseSchema = z
  .object({
    id: ycodeProtocolRequestIdSchema,
    result: z.unknown(),
  })
  .strict();
export type YCodeProtocolResponse = z.infer<typeof ycodeProtocolResponseSchema>;

export const ycodeProtocolErrorSchema = z
  .object({
    id: ycodeProtocolRequestIdSchema,
    error: z
      .object({
        code: z.number().int(),
        message: nonEmptyString,
        data: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type YCodeProtocolError = z.infer<typeof ycodeProtocolErrorSchema>;

export const ycodeProtocolMessageSchema = z.union([
  ycodeProtocolRequestSchema,
  ycodeProtocolNotificationSchema,
  ycodeProtocolResponseSchema,
  ycodeProtocolErrorSchema,
]);
export type YCodeProtocolMessage = z.infer<typeof ycodeProtocolMessageSchema>;

export const ycodeProtocolNotifications = {
  storageStartup: "startup/storageState",
  providerRuntimeHeadersCancelled: "interaction/providerRuntimeHeadersCancelled",
  mcpTelemetry: "process/mcpTelemetry",
  mcpResourceSamples: "process/mcpResourceSamples",
  toolExecResource: "process/toolExecResource",
  pluginOperationProgress: "plugins/operationProgress",
  processResourceSample: "process/resourceSample",
  // MCP Apps：模型侧 app-tool 调用投递给唯一页面实例（CLI → host → renderer）。
  mcpUiAppToolCall: "mcp/ui/appToolCall",
} as const;

/** 启动控制面独立于 task stream；数据库身份不可携带路径/凭据。 */
export const ycodeStorageStartupStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    databaseId: z.string().min(1).max(128),
    databaseKind: z.enum(["session", "tasks-index"]),
    phase: z.enum(["checking", "waiting_for_lock", "migrating", "committing", "ready", "failed"]),
    // 包含锁内、版本 SQL 之前的可选 lastAppliedMigrationId；旧通知仍可解析。
    migration: databaseMigrationFactsSchema.optional(),
    elapsedMs: z.number().nonnegative().finite(),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    errorCode: databaseStartupErrorCodeSchema.optional(),
    ...databaseStartupErrorDetailsSchema.shape,
  })
  .strict()
  .superRefine((state, context) => {
    if (state.phase === "failed" && !state.errorCode)
      context.addIssue({ code: "custom", message: "failed requires errorCode" });
  });
export type YCodeStorageStartupState = z.infer<typeof ycodeStorageStartupStateSchema>;

const ycodeMcpTelemetryPlatformSchema = z.enum([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
  "cygwin",
]);
const ycodeMcpTelemetryArchSchema = z.enum([
  "arm",
  "arm64",
  "ia32",
  "loong64",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "riscv64",
  "s390",
  "s390x",
  "x64",
]);
const ycodeMcpTelemetryBaseSchema = z
  .object({
    arch: ycodeMcpTelemetryArchSchema,
    occurredAt: z.number().int().nonnegative(),
    platform: ycodeMcpTelemetryPlatformSchema,
  })
  .strict();
const ycodeMcpProcessTelemetryBaseShape = {
  mcpId: z
    .string()
    .regex(
      /^(?:builtin:(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+(?::(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+)*|(?:plugin|custom):[a-f0-9]{12})$/,
    ),
  mcpInstanceId: nonEmptyString,
  mcpIsolation: z.enum(["session", "workspace"]),
  mcpSource: z.enum(["builtin", "plugin", "custom"]),
} as const;

export const ycodeMcpTelemetryEventSchema = z.discriminatedUnion("kind", [
  ycodeMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("process_start"),
      ...ycodeMcpProcessTelemetryBaseShape,
    })
    .strict(),
  ycodeMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("process_crash"),
      ...ycodeMcpProcessTelemetryBaseShape,
      affectedSessionCount: z.number().int().nonnegative().max(10_000),
      exitCode: z.number().int().nullable(),
      signal: nonEmptyString.nullable(),
      uptimeMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  ycodeMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("session_startup"),
      configuredCount: z.number().int().nonnegative().max(10_000),
      connectedCount: z.number().int().nonnegative().max(10_000),
      failedCount: z.number().int().nonnegative().max(10_000),
      processCount: z.number().int().nonnegative().max(10_000),
      sessionId: nonEmptyString,
    })
    .strict(),
  ycodeMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("memory"),
      ...ycodeMcpProcessTelemetryBaseShape,
      memoryKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
      memoryScope: z.enum(["process_tree", "direct_process"]),
      orphanSuspected: z.boolean(),
      ownerSessionCount: z.number().int().nonnegative().max(10_000),
      unownedSeconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
]);
export type YCodeMcpTelemetryEvent = z.infer<typeof ycodeMcpTelemetryEventSchema>;

/** MCP 每五分钟只探测一次，周期由生产者与设备总量过期判据共用。 */
export const YCODE_MCP_RESOURCE_SAMPLE_INTERVAL_MS = 5 * 60_000;

export const ycodeMcpResourceSampleSchema = z
  .object({
    mcpId: ycodeMcpProcessTelemetryBaseShape.mcpId,
    instanceToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    sampledAt: z.number().int().nonnegative(),
    intervalMs: z.number().finite().positive(),
    processCount: z.number().int().positive().max(100_000),
    rssKbTotal: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    rssKbMaxProcess: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cpuTimeMsDelta: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    uptimeMinutes: z.number().int().nonnegative(),
    platform: ycodeMcpTelemetryPlatformSchema,
    arch: ycodeMcpTelemetryArchSchema,
    logicalCpuCount: z.number().int().positive().max(4_096),
    totalMemoryGb: z.number().int().nonnegative().max(1_048_576),
  })
  .strict();
export type YCodeMcpResourceSample = z.infer<typeof ycodeMcpResourceSampleSchema>;
// 通知输入有界；main 另按每个上报窗口的 32 个 MCP 分组执行事件额度。
export const ycodeMcpResourceSamplesSchema = z.array(ycodeMcpResourceSampleSchema).max(1_024);

export const BASH_RESOURCE_SAMPLE_INTERVAL_MS = 15_000;
export const BASH_RESOURCE_MAX_SAMPLES = 20;

/** Bash 子进程的有界完成事实；禁止命令、路径与会话标识进入遥测旁路。 */
export const ycodeToolExecResourceSchema = z
  .object({
    // 同一完成事实可能经多个 Host 转发；随机标识仅供 main 去重，旧 CLI 缺字段仍兼容。
    completionToken: z.string().uuid().optional(),
    platform: ycodeMcpTelemetryPlatformSchema,
    toolName: z.literal("bash"),
    durationMs: z.number().finite().min(BASH_RESOURCE_SAMPLE_INTERVAL_MS),
    exitKind: z.enum(["completed", "timeout", "killed", "error"]),
    treeRssKbPeak: z.number().finite().nonnegative().optional(),
    treeCpuTimeMs: z.number().finite().nonnegative().optional(),
    sampleCount: z.number().int().nonnegative().max(BASH_RESOURCE_MAX_SAMPLES),
    cliRssKb: z.number().finite().nonnegative(),
    systemFreeMemoryKb: z.number().finite().nonnegative(),
  })
  .strict();
export type YCodeToolExecResource = z.infer<typeof ycodeToolExecResourceSchema>;

export const ycodeProcessResourceSampleSchema = z
  .object({
    platform: z.enum([
      "aix",
      "android",
      "darwin",
      "freebsd",
      "haiku",
      "linux",
      "netbsd",
      "openbsd",
      "sunos",
      "win32",
      "cygwin",
    ]),
    arch: z.enum([
      "arm",
      "arm64",
      "ia32",
      "loong64",
      "mips",
      "mipsel",
      "ppc",
      "ppc64",
      "riscv64",
      "s390",
      "s390x",
      "x64",
    ]),
    logicalCpuCount: z.number().int().positive().max(4_096),
    intervalMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1_000),
    cpuCores: z.number().finite().nonnegative().max(4_096),
    cpuPercent: z.number().finite().nonnegative().max(100_000),
    rssKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /**
     * 以下四项为遥测新增字段，全部可选：旧 CLI 发来的样本仍能通过校验，因此
     * **不递增协议握手版本号**（握手版本是兼容性开关，不是字段版本）。
     */
    heapUsedKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    uptimeMinutes: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 365 * 24 * 60)
      .optional(),
    totalMemoryGb: z.number().int().nonnegative().max(1_048_576).optional(),
    /**
     * CLI 进程启动时随机生成的实例标识，仅供 app 侧 main 统计「同时存活几个 CLI 进程」
     * 与「最大单进程 RSS」。不进 ARMS 属性、不含 pid。收紧字符集是隐私红线的机械保障：
     * 路径、workspace 标识这类内容不可能通过校验。
     */
    instanceToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .strict();
export type YCodeProcessResourceSample = z.infer<typeof ycodeProcessResourceSampleSchema>;

export const ycodeProcessChildProcessesParamsSchema = z.object({}).strict();
export const ycodeProcessChildProcessSchema = z
  .object({
    pid: z.number().int().positive(),
    serverName: nonEmptyString,
    mcpSource: z.enum(["builtin", "plugin", "custom"]),
    /** 官方/第三方插件的插件名（`plugin:<name>:<key>` 的 name，或官方 host MCP 对应插件）；custom 无 */
    pluginName: nonEmptyString.optional(),
  })
  .strict();
export const ycodeProcessChildProcessesResultSchema = z
  .object({
    processes: z.array(ycodeProcessChildProcessSchema).max(10_000),
  })
  .strict();
export type YCodeProcessChildProcess = z.infer<typeof ycodeProcessChildProcessSchema>;
export type YCodeProcessChildProcessesResult = z.infer<
  typeof ycodeProcessChildProcessesResultSchema
>;

export type YCodeDeliveryKind = z.infer<typeof ycodeDeliveryKindSchema>;
// TurnStarted 与持久 message 必须共用同一来源词表；否则 live event 能通过而 cold
// message 在 app/agent 边界被拒绝，造成 continuous/replayable 语义分叉。
const ycodeTurnInputSourceSchema = legacyYcodeSyntheticUserMessageSourceSchema;
export const ycodeSessionPersistenceSchema = z.enum(["immediate", "deferred"]);
export type YCodeSessionPersistence = z.infer<typeof ycodeSessionPersistenceSchema>;
export type YCodeWorkspaceRef = z.infer<typeof ycodeWorkspaceRefSchema>;
export const ycodePermissionOptionSchema = z
  .object({
    optionId: nonEmptyString,
    kind: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    response: ycodePermissionResponseSchema,
  })
  .strict();

const ycodeProtocolMcpEntrySchema = z
  .object({
    name: nonEmptyString,
    value: z.string(),
  })
  .strict();

const ycodeProtocolMcpOAuthSchema = z.union([
  z
    .object({
      type: z.literal("client_credentials"),
      clientId: nonEmptyString,
      clientSecret: nonEmptyString,
      clientName: nonEmptyString.optional(),
      scope: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("authorization_code"),
      clientId: nonEmptyString.optional(),
      clientSecret: nonEmptyString.optional(),
      clientName: nonEmptyString.optional(),
      redirectPath: nonEmptyString.optional(),
      scope: z.string().optional(),
    })
    .strict(),
]);

export const ycodeProtocolMcpServerSchema = z.union([
  z
    .object({
      name: nonEmptyString,
      command: nonEmptyString,
      args: z.array(z.string()),
      env: z.array(ycodeProtocolMcpEntrySchema),
      isolation: z.enum(["session", "workspace"]).optional(),
      protocolVersion: z.enum(["legacy", "auto", "2026-07-28"]).optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      name: nonEmptyString,
      type: z.enum(["http", "sse"]),
      url: nonEmptyString,
      headers: z.array(ycodeProtocolMcpEntrySchema),
      oauth: ycodeProtocolMcpOAuthSchema.optional(),
      isolation: z.enum(["session", "workspace"]).optional(),
      protocolVersion: z.enum(["legacy", "auto", "2026-07-28"]).optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
]);
export type YCodeProtocolMcpServer = z.infer<typeof ycodeProtocolMcpServerSchema>;

export const ycodeMcpServerStatusKindSchema = z.enum([
  "connecting",
  "connected",
  "disabled",
  "disconnected",
  "failed",
  "untrusted",
]);
export const MCP_SERVER_FAILURE_KINDS = [
  "config_invalid",
  "runtime_unavailable",
  "process_start_failed",
  "network_unreachable",
  "connection_timeout",
  "protocol_negotiation_failed",
  "tool_list_failed",
  "unexpected_disconnect",
  "oauth_authorization_failed",
  "official_origin_untrusted",
  "not_authenticated",
  "coding_plan_required",
  "server_not_found",
  "server_unavailable",
  "rate_limited",
  "server_internal_error",
  "protocol_error",
  "status_unavailable",
  "connection_failed",
] as const;
export const mcpServerFailureKindSchema = z.enum(MCP_SERVER_FAILURE_KINDS);
export type McpServerFailureKind = z.infer<typeof mcpServerFailureKindSchema>;
export const ycodeMcpServerStatusSnapshotSchema = z
  .object({
    status: ycodeMcpServerStatusKindSchema,
    transport: z.enum(["stdio", "http", "sse"]),
    toolCount: z.number().int().nonnegative(),
    updatedAt: nonEmptyString,
    error: z.string().optional(),
    failureKind: mcpServerFailureKindSchema.optional(),
    serverRequestId: nonEmptyString.optional(),
    protocolEra: z.enum(["legacy", "modern"]).optional(),
    authorization: z
      .object({
        type: z.literal("oauth_authorization_code"),
        authorizationUrl: nonEmptyString,
        startedAt: nonEmptyString,
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodeMcpServerStatusSnapshot = z.infer<typeof ycodeMcpServerStatusSnapshotSchema>;

export const ycodeMcpListModeSchema = z.enum(["connect", "status"]);
export type YCodeMcpListMode = z.infer<typeof ycodeMcpListModeSchema>;

export const ycodeMcpListParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    mcpServers: z.array(ycodeProtocolMcpServerSchema).optional(),
    mode: ycodeMcpListModeSchema.default("connect"),
  })
  .strict();
export const ycodeMcpListResultSchema = z
  .object({
    statuses: z.record(z.string(), ycodeMcpServerStatusSnapshotSchema),
  })
  .strict();
export type YCodeMcpListResult = z.infer<typeof ycodeMcpListResultSchema>;

export const ycodeSessionImportMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: timestampMsSchema.optional(),
  })
  .strict();
export type YCodeSessionImportMessage = z.infer<typeof ycodeSessionImportMessageSchema>;

export const ycodeSessionImportHistorySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("claudeCode"),
      title: z.string().optional(),
      createdAt: timestampMsSchema.optional(),
      updatedAt: timestampMsSchema.optional(),
      messages: z.array(ycodeSessionImportMessageSchema).min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("sharedContext"),
      title: z.string().trim().min(1),
      createdAt: timestampMsSchema.optional(),
      markdown: z.string().min(1),
      provenance: z
        .object({
          shareId: z.string().trim().min(1),
          contextId: z.string().trim().min(1).optional(),
          shareUrl: z.string().url().optional(),
          status: z.enum(["pending", "reserved", "attached", "discarded"]).optional(),
          projectionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          artifactSetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          formatterVersion: z.literal(1),
          markdownSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          installedArtifacts: z.array(
            z
              .object({
                artifactId: z.string().trim().min(1),
                workspaceRelativePath: z.string().trim().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
]);
export type YCodeSessionImportHistory = z.infer<typeof ycodeSessionImportHistorySchema>;

export const ycodeThoughtLevelOptionSchema = z
  .object({
    value: nonEmptyString,
    label: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();
export const ycodeModelReasoningOptionsSchema = z
  .object({
    levels: z.array(ycodeThoughtLevelOptionSchema),
    defaultLevel: nonEmptyString.optional(),
  })
  .strict();
export type YCodeModelReasoningOptions = z.infer<typeof ycodeModelReasoningOptionsSchema>;

export const ycodeModelFormatPropertiesSchema = completeModelPropertiesDataSchema.pick({
  inputFormat: true,
  outputFormat: true,
});
export type YCodeModelFormatProperties = z.infer<typeof ycodeModelFormatPropertiesSchema>;

export const ycodeModelOptionSchema = z
  .object({
    ref: modelSelectionSchema,
    label: nonEmptyString,
    providerLabel: nonEmptyString.optional(),
    description: z.string().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    reasoning: ycodeModelReasoningOptionsSchema.optional(),
    properties: ycodeModelFormatPropertiesSchema,
    disabledReason: z.string().optional(),
  })
  .strict();
export type YCodeModelOption = z.infer<typeof ycodeModelOptionSchema>;

export const ycodeAccountAccessSchema = z.discriminatedUnion("planKind", [
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("start-plan"),
    })
    .strict(),
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("individual-coding-plan"),
    })
    .strict(),
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("team-coding-plan"),
      productId: nonEmptyString,
      organizationId: nonEmptyString,
      projectId: nonEmptyString,
    })
    .strict(),
]);
export type YCodeAccountAccess = z.infer<typeof ycodeAccountAccessSchema>;

/** Active Model 固定的账号访问类别；当前商品和 Team scope 由账号服务在请求期解析。 */
export const ycodeProviderAccountAccessSchema = z
  .object({
    type: z.literal("zhipu-account"),
    accountType: z.enum(["zai", "bigmodel"]),
    mode: z.enum(["start-plan", "individual-coding-plan", "team-coding-plan", "off-peak"]),
    entitled: z.boolean(),
  })
  .strict();
export type YCodeProviderAccountAccess = z.infer<typeof ycodeProviderAccountAccessSchema>;

export type YCodeSessionMode = z.infer<typeof ycodeSessionModeSchema>;
export type YCodeSessionKind = z.infer<typeof ycodeSessionKindSchema>;
export type YCodeSessionGoal = z.infer<typeof ycodeSessionGoalSchema>;

export const ycodeSessionTodoItemSchema = z
  .object({
    content: nonEmptyString,
    status: z.enum(["pending", "in_progress", "completed"]),
    priority: z.enum(["high", "medium", "low"]),
  })
  .strict();
export const ycodeSessionGoalStatsSchema = z
  .object({
    timeUsedSeconds: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative(),
    tokenBudget: z.number().int().positive().nullable(),
    contextUsed: z.number().int().nonnegative(),
    contextWindow: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    iterationCount: z.number().int().nonnegative(),
  })
  .strict();
export type YCodeSessionGoalStats = z.infer<typeof ycodeSessionGoalStatsSchema>;
export type YCodeSessionGoalVerification = z.infer<typeof ycodeSessionGoalVerificationSchema>;
export type YCodeSessionGoalVerificationTimeline = z.infer<
  typeof ycodeSessionGoalVerificationTimelineSchema
>;

export const ycodeSessionTodoGroupSchema = z
  .object({
    id: nonEmptyString,
    source: z.enum(["goal_iteration", "session"]),
    goalIteration: z.number().int().positive().optional(),
    targetId: nonEmptyString.optional(),
    startedAt: timestampMsSchema.optional(),
    updatedAt: timestampMsSchema.optional(),
    todos: z.array(ycodeSessionTodoItemSchema),
  })
  .strict();
export type YCodeSessionTodoGroup = z.infer<typeof ycodeSessionTodoGroupSchema>;

export const ycodeSessionSettingsStateSchema = z
  .object({
    model: z
      .object({
        // 未绑定是合法恢复状态；不能为满足协议而伪造模型或阻断历史读取。
        current: modelSelectionSchema.optional(),
        available: z.array(ycodeModelOptionSchema),
        lastUsed: modelSelectionSchema.optional(),
      })
      .strict(),
    thoughtLevel: z
      .object({
        enabled: z.boolean(),
        current: nonEmptyString.optional(),
        defaultLevel: nonEmptyString.optional(),
        available: z.array(ycodeThoughtLevelOptionSchema),
      })
      .strict(),
    mode: z
      .object({
        current: ycodeSessionModeSchema,
      })
      .strict(),
    permission: z
      .object({
        mode: ycodeSessionModeSchema.optional(),
        rulesRevision: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodeSessionSettingsState = z.infer<typeof ycodeSessionSettingsStateSchema>;
export const ycodePendingPermissionSchema = z
  .object({
    requestId: nonEmptyString,
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    reason: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    input: z.unknown().optional(),
    origin: ycodeInteractionRequestOriginSchema.optional(),
    options: z.array(ycodePermissionOptionSchema).min(1),
    requestedAt: timestampMsSchema,
  })
  .strict();
export type YCodePendingPermission = z.infer<typeof ycodePendingPermissionSchema>;

export const ycodeActiveToolCallSchema = z
  .object({
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    status: z.enum(["pending", "running", "completed", "failed", "denied"]),
    startedAt: timestampMsSchema.optional(),
  })
  .strict();
export type YCodeActiveToolCall = z.infer<typeof ycodeActiveToolCallSchema>;

export const ycodeSessionProjectionSchema = z
  .object({
    sessionId: nonEmptyString,
    status: ycodeSessionStatusSchema,
    mode: ycodeSessionModeSchema,
    turnCount: z.number().int().nonnegative(),
    totalTokenCount: z.number().int().nonnegative(),
    contextUsed: z.number().int().nonnegative(),
    contextWindow: z.number().int().nonnegative(),
    currentTurnId: nonEmptyString.optional(),
    pendingPermissions: z.array(ycodePendingPermissionSchema),
    activeToolCalls: z.array(ycodeActiveToolCallSchema),
    backgroundJobs: z.array(jsonObjectSchema),
    target: ycodeSessionGoalSchema.nullable().optional(),
    lastError: z
      .object({
        type: nonEmptyString,
        code: nonEmptyString.optional(),
        message: nonEmptyString,
        detail: z.string().optional(),
        attribution: errorAttributionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodeSessionProjection = z.infer<typeof ycodeSessionProjectionSchema>;
export type YCodeToolState = z.infer<typeof ycodeToolStateSchema>;
export const ycodeSlashCommandSchema = z
  .object({
    name: nonEmptyString,
    description: z.string(),
    inputHint: z.string().optional(),
    source: z.enum(["builtin", "custom"]).optional(),
  })
  .strict();
export type YCodeSessionApiRetryStatus = z.infer<typeof ycodeSessionApiRetryStatusSchema>;
export type YCodeSessionContextUsage = z.infer<typeof ycodeSessionContextUsageSchema>;
export const ycodeModelStreamingKindSchema = z.enum([
  "start",
  "finish",
  "error",
  "text_start",
  "text_delta",
  "text_end",
  "reasoning_start",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_input_delta",
  "tool_input_end",
  "tool_call",
]);
export const ycodeModelStreamingEventPayloadSchema = z
  .object({
    assistantMessageId: z.string().optional(),
    delta: z.string().optional(),
    done: z.boolean().optional(),
    input: z.unknown().optional(),
    kind: ycodeModelStreamingKindSchema,
    partId: z.string().optional(),
    providerExecuted: z.boolean().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
  })
  .strict();
export const ycodeSessionStateSnapshotSchema = z
  .object({
    protocol: z
      .object({
        name: z.literal(YCODE_PROTOCOL_NAME),
        version: z.literal(YCODE_PROTOCOL_VERSION),
      })
      .strict(),
    session: ycodeSessionInfoSchema,
    settings: ycodeSessionSettingsStateSchema,
    projection: ycodeSessionProjectionSchema,
    runtime: ycodeSessionRuntimeStateSchema,
    messages: z.array(ycodeMessageWithPartsSchema),
    goalStats: ycodeSessionGoalStatsSchema.optional(),
    todos: z.array(ycodeSessionTodoItemSchema).optional(),
    todoGroups: z.array(ycodeSessionTodoGroupSchema).optional(),
    slashCommands: z.array(ycodeSlashCommandSchema).optional(),
  })
  .strict();
export type YCodeSessionStateSnapshot = z.infer<typeof ycodeSessionStateSnapshotSchema>;

export const ycodeEventEnvelopeSchema = z
  .object({
    eventId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    seq: z.number().int().nonnegative(),
    traceId: nonEmptyString.optional(),
    timestamp: timestampMsSchema,
    deliveryKind: ycodeDeliveryKindSchema.optional(),
  })
  .strict();

const ycodeComputerUseOperationEventBaseSchema = z
  .object({
    eventId: nonEmptyString,
    sequenceNumber: z.number().int().nonnegative(),
    sessionId: nonEmptyString,
    timestamp: timestampMsSchema,
  })
  .strict();

const ycodeComputerUseTurnStartedEventSchema = ycodeComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-started"),
  turnId: nonEmptyString,
});
const ycodeComputerUseTurnCompletedEventSchema = ycodeComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-completed"),
  turnId: nonEmptyString,
});
const ycodeComputerUseTurnFailedEventSchema = ycodeComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-failed"),
  turnId: nonEmptyString,
});
const ycodeComputerUseToolScheduledEventSchema = ycodeComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("tool-scheduled"),
  turnId: nonEmptyString,
  toolCallId: nonEmptyString,
  toolName: nonEmptyString,
  // 这个 cell 是否在用 Computer Use。只表达布尔事实，不再携带动作名——旧的
  // operationAction 靠从模型源码里抽取动作名得到，SDK 面一变就整体失配（见
  // bootstrap/src/ycode-protocol/computer-use-operation-event.ts 的 usesComputerUse）。
  // 只挂在 scheduled 上：ToolCallStartedPayload 没有 input，start 时已拿不到模型源码。
  computerUse: z.literal(true).optional(),
});
const ycodeComputerUseToolStartedEventSchema = ycodeComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("tool-started"),
  turnId: nonEmptyString.optional(),
  toolCallId: nonEmptyString,
  toolName: nonEmptyString.optional(),
});
const ycodeComputerUseSessionClosedEventSchema = ycodeComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("session-closed"),
});

export const ycodeComputerUseOperationEventSchema = z.discriminatedUnion("kind", [
  ycodeComputerUseTurnStartedEventSchema,
  ycodeComputerUseTurnCompletedEventSchema,
  ycodeComputerUseTurnFailedEventSchema,
  ycodeComputerUseToolScheduledEventSchema,
  ycodeComputerUseToolStartedEventSchema,
  ycodeComputerUseSessionClosedEventSchema,
]);
export type YCodeComputerUseOperationEvent = z.infer<typeof ycodeComputerUseOperationEventSchema>;

export const ycodeSessionEventTypeSchema = z.enum([
  "session.created",
  "session.resumed",
  "session.updated",
  "session.titleUpdated",
  "session.closed",
  "turn.started",
  "turn.steerQueued",
  "turn.steerDrained",
  "turn.completed",
  "turn.failed",
  "message.upserted",
  "message.removed",
  "part.started",
  "part.delta",
  "part.upserted",
  "part.removed",
  "model.streaming",
  "tool.updated",
  "permission.requested",
  "permission.resolved",
  "userInput.requested",
  "userInput.resolved",
  "checkpoint.created",
  "rewind.triggered",
  "streamRecovery.updated",
]);
export type YCodeSessionEventType = z.infer<typeof ycodeSessionEventTypeSchema>;

export const ycodeProtocolErrorDetailSchema = z
  .object({
    type: nonEmptyString,
    message: nonEmptyString,
    stack: z.string().optional(),
    code: z.string().optional(),
    detail: z.string().optional(),
    underlyingErrorMessage: z.string().optional(),
    underlyingErrorDetail: z.string().optional(),
    attribution: errorAttributionSchema.optional(),
    retryable: z.boolean().optional(),
    data: z.unknown().optional(),
  })
  .strict();
export const ycodeSessionCreatedEventPayloadSchema = z
  .object({
    mode: ycodeSessionModeSchema,
    contextWindow: z.number().int().nonnegative(),
  })
  .strict();
export const ycodeSessionResumedEventPayloadSchema = z
  .object({
    directory: nonEmptyString,
    interruptedToolCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    partCount: z.number().int().nonnegative(),
    recoveredCompactTimelineCount: z.number().int().nonnegative().optional(),
    recoveredSteerInputCount: z.number().int().nonnegative().optional(),
    resumedTodoCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export const ycodeSessionTitleUpdatedEventPayloadSchema = z
  .object({
    messageID: nonEmptyString.optional(),
    previousTitle: z.string(),
    source: z.enum(["default", "first_input", "generated", "custom"]),
    title: z.string(),
  })
  .strict();
export const ycodeTurnStartedEventPayloadSchema = z
  .object({
    turnNumber: z.number().int().nonnegative(),
    input: z.string(),
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    inputSource: ycodeTurnInputSourceSchema.optional(),
    inputVisibility: ycodeMessageVisibilitySchema.optional(),
    executionKind: z.enum(["agent", "controlOnly"]).optional(),
    targetId: nonEmptyString.optional(),
    messageId: nonEmptyString.optional(),
    foregroundExecutionId: nonEmptyString.optional(),
    intent: jsonObjectSchema.optional(),
    originMeta: jsonObjectSchema.optional(),
    // runtime 会透传后台唤醒来源，strict schema 必须同步声明以免丢弃整条事件。
    backgroundSource: z.enum(["bash", "subagent"]).optional(),
    attachments: z.array(jsonObjectSchema).optional(),
  })
  .strict();
const ycodeTurnSteerSourceSchema = z.enum(["plan_approval_feedback", "workflow_refine_feedback"]);
const ycodeTurnSteerCommandKindSchema = z.enum(["sendText", "sendGoalCommand", "compact"]);
const ycodeTurnSteerDeliverySchema = z.enum(["queue", "guide"]);

export const ycodeTurnSteerQueuedEventPayloadSchema = z
  .object({
    pendingInputId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    input: z.string(),
    inputPreview: z.string(),
    inputSize: z.number().int().nonnegative(),
    commandKind: ycodeTurnSteerCommandKindSchema.optional(),
    source: ycodeTurnSteerSourceSchema.optional(),
    toolDisallowlist: z.array(nonEmptyString).optional(),
    delivery: ycodeTurnSteerDeliverySchema.optional(),
    targetTurnId: nonEmptyString,
    queueLength: z.number().int().nonnegative(),
    intent: jsonObjectSchema.optional(),
  })
  .strict();
export const ycodeTurnSteerDrainedEventPayloadSchema = z
  .object({
    pendingInputIds: z.array(nonEmptyString),
    queryIds: z.array(nonEmptyString).optional(),
    targetTurnId: nonEmptyString,
    injectedMessageIds: z.array(nonEmptyString),
    drainedInputs: z
      .array(
        z
          .object({
            pendingInputId: nonEmptyString,
            messageId: nonEmptyString,
            text: z.string(),
            delivery: ycodeTurnSteerDeliverySchema.optional(),
            intent: jsonObjectSchema.optional(),
            toolDisallowlist: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const ycodeTurnCompletedEventPayloadSchema = z
  .object({
    response: z.string(),
    tokenCount: z.number().int().nonnegative(),
    usage: z.unknown().optional(),
    toolCallCount: z.number().int().nonnegative(),
    historyRoundCount: z.number().int().nonnegative().optional(),
    duration: z.number().nonnegative(),
    // runtime turn.completed 会附带 cacheStats，协议 schema 之前漏掉该字段。
    // strict 校验失败会让桌面端丢掉终态事件，表现为消息已完成但 UI 一直没有回复。
    cacheStats: z
      .object({
        totalMessages: z.number().int().nonnegative(),
        cachedMessages: z.number().int().nonnegative(),
        lastCacheHit: z.boolean(),
        cacheReadTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    inputId: nonEmptyString.optional(),
    resultType: z.enum([
      "success",
      // "cancelled": 用户主动中断属于正常结束，复用 turn.completed 上报，避免被映射成 turn.failed。
      "cancelled",
      "error_max_turns",
      "error_max_budget",
      "error_during_execution",
      "error_max_tool_calls",
    ]),
    backgroundSubagentResultConsumed: z.boolean().optional(),
  })
  .strict();
export const ycodeTurnFailedEventPayloadSchema = z
  .object({
    error: ycodeProtocolErrorDetailSchema,
    turnPhase: z.string(),
    inputId: nonEmptyString.optional(),
    backgroundSubagentResultConsumed: z.boolean().optional(),
  })
  .strict();
export const ycodeMessageUpsertedEventPayloadSchema = z
  .object({
    content: z.string(),
    attachments: z.array(z.unknown()).optional(),
    toolCalls: z.array(z.unknown()).optional(),
    type: z.string().optional(),
    compactBoundary: z.unknown().optional(),
  })
  .strict();
export const ycodeMessageRemovedEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    reason: z.string().optional(),
  })
  .strict();
export const ycodeMessagePartDeltaEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    partId: nonEmptyString,
    field: z.enum(["text", "reasoning", "input", "output"]).optional(),
    delta: z.string(),
  })
  .strict();
export const ycodeMessagePartUpsertedEventPayloadSchema = z
  .object({
    part: ycodeMessagePartSchema,
  })
  .strict();
export const ycodeMessagePartRemovedEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    partId: nonEmptyString,
    reason: z.string().optional(),
  })
  .strict();
const ycodeToolCallBasePayloadSchema = z
  .object({
    toolCallId: nonEmptyString,
    toolName: z.string().optional(),
    parentToolCallId: nonEmptyString.optional(),
    source: z.enum(["subagent"]).optional(),
    agentId: nonEmptyString.optional(),
    agentType: nonEmptyString.optional(),
    // subagent mirror 会携带后台归因；strict schema 漏字段会让 session/event 整条被丢弃。
    background: z.boolean().optional(),
    childSessionId: nonEmptyString.optional(),
    childToolCallId: nonEmptyString.optional(),
    description: z.string().optional(),
  })
  .strict();

export const ycodeToolUpdatedEventPayloadSchema = z.discriminatedUnion("kind", [
  ycodeToolCallBasePayloadSchema
    .extend({
      kind: z.literal("scheduled"),
      // 修复：CLI 调度事件已携带所属消息 ID；漏声明会让严格校验丢弃整条事件。
      assistantMessageId: nonEmptyString.optional(),
      toolName: nonEmptyString,
      input: z.unknown().optional(),
      inputByteLength: z.number().int().nonnegative().optional(),
      inputOmitted: z.boolean().optional(),
      inputRef: z.literal("model_stream").optional(),
      dependencies: z.array(nonEmptyString).optional(),
      parallelGroupIndex: z.number().int().nonnegative().optional(),
      canRunParallel: z.boolean().optional(),
      schedule: jsonObjectSchema.optional(),
    })
    .strict(),
  ycodeToolCallBasePayloadSchema
    .extend({
      kind: z.literal("started"),
      startedAt: protocolInstantSchema,
    })
    .strict(),
  ycodeToolCallBasePayloadSchema
    .extend({
      kind: z.literal("progress"),
      elapsedMs: z.number().nonnegative().optional(),
      pid: z.number().int().optional(),
      stdoutBytes: z.number().int().nonnegative().optional(),
      stderrBytes: z.number().int().nonnegative().optional(),
      outputBytes: z.number().int().nonnegative().optional(),
      outputPreview: executionOutputPreviewSchema.optional(),
      stdoutTail: z.string().optional(),
      stderrTail: z.string().optional(),
    })
    .strict(),
  ycodeToolCallBasePayloadSchema
    .extend({
      kind: z.literal("result"),
      result: ycodeToolResultObjectSchema,
      duration: z.number().nonnegative(),
    })
    .strict(),
  ycodeToolCallBasePayloadSchema
    .extend({
      kind: z.literal("error"),
      error: ycodeProtocolErrorDetailSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("batch"),
      toolCallIds: z.array(nonEmptyString),
      successCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
    })
    .strict(),
  ycodeToolCallBasePayloadSchema
    .extend({
      kind: z.literal("raw"),
      payload: jsonObjectSchema,
    })
    .strict(),
]);
export const ycodePermissionRequestedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string(),
    input: z.unknown(),
    suggestedPermissionUpdates: z.array(ycodePermissionUpdateSchema).optional(),
    origin: ycodeInteractionRequestOriginSchema.optional(),
    options: z.array(ycodePermissionOptionSchema).min(1),
    childSessionId: nonEmptyString.optional(),
    background: z.boolean().optional(),
  })
  .strict();
export const ycodePermissionResolvedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString.optional(),
    decision: ycodePermissionDecisionSchema.optional(),
    reason: z.string().optional(),
    modifiedInput: z.unknown().optional(),
    inputSummary: z.unknown().optional(),
    childSessionId: nonEmptyString.optional(),
    background: z.boolean().optional(),
  })
  .strict();
export const ycodeUserInputRequestedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString,
    prompt: z.string(),
    inputType: z.enum(["text", "choice", "confirm"]).optional(),
    choices: z.array(z.string()).optional(),
  })
  .strict();
export const ycodeUserInputResolvedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString,
    value: z.unknown().optional(),
    cancelled: z.boolean().optional(),
  })
  .strict();
export const ycodeSessionClosedEventPayloadSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

function ycodeSessionEventEnvelopeFor<T extends YCodeSessionEventType>(
  type: T,
  payload: z.ZodTypeAny,
) {
  return ycodeEventEnvelopeSchema.extend({
    type: z.literal(type),
    payload: payload.optional(),
  });
}

export const ycodeSessionEventSchema = z.discriminatedUnion("type", [
  ycodeSessionEventEnvelopeFor("session.created", ycodeSessionCreatedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("session.resumed", ycodeSessionResumedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("session.updated", jsonObjectSchema),
  ycodeSessionEventEnvelopeFor("session.titleUpdated", ycodeSessionTitleUpdatedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("session.closed", ycodeSessionClosedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("turn.started", ycodeTurnStartedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("turn.steerQueued", ycodeTurnSteerQueuedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("turn.steerDrained", ycodeTurnSteerDrainedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("turn.completed", ycodeTurnCompletedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("turn.failed", ycodeTurnFailedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("message.upserted", ycodeMessageUpsertedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("message.removed", ycodeMessageRemovedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("part.started", ycodeMessagePartUpsertedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("part.delta", ycodeMessagePartDeltaEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("part.upserted", ycodeMessagePartUpsertedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("part.removed", ycodeMessagePartRemovedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("model.streaming", ycodeModelStreamingEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("tool.updated", ycodeToolUpdatedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("permission.requested", ycodePermissionRequestedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("permission.resolved", ycodePermissionResolvedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("userInput.requested", ycodeUserInputRequestedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("userInput.resolved", ycodeUserInputResolvedEventPayloadSchema),
  ycodeSessionEventEnvelopeFor("checkpoint.created", jsonObjectSchema),
  ycodeSessionEventEnvelopeFor("rewind.triggered", jsonObjectSchema),
  ycodeSessionEventEnvelopeFor("streamRecovery.updated", jsonObjectSchema),
]);
export type YCodeSessionEvent = z.infer<typeof ycodeSessionEventSchema>;

export const ycodeSessionEventsResultSchema = z
  .object({
    events: z.array(ycodeSessionEventSchema),
  })
  .strict();
export const ycodeSessionMessagesResultSchema = z
  .object({
    messages: z.array(ycodeMessageWithPartsSchema),
  })
  .strict();
export const ycodeStateUpdatedNotificationSchema = z
  .object({
    type: z.literal("state.updated"),
    scope: z.enum(["server", "workspace", "session"]),
    workspace: ycodeWorkspaceRefSchema.optional(),
    sessionId: nonEmptyString.optional(),
    revision: z.number().int().nonnegative(),
    reason: z.string().optional(),
    patch: z.unknown(),
  })
  .strict();
export type YCodeStateUpdatedNotification = z.infer<typeof ycodeStateUpdatedNotificationSchema>;

export const ycodeSessionSubscribeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    deliveryKind: ycodeDeliveryKindSchema,
    afterSeq: z.number().int().nonnegative().optional(),
    includeSnapshot: z.boolean().default(false),
  })
  .strict();
export type YCodeSessionSubscribeParams = z.infer<typeof ycodeSessionSubscribeParamsSchema>;

export const ycodeSessionSubscribeResultSchema = z
  .object({
    sessionId: nonEmptyString,
    eventSeq: z.number().int().nonnegative(),
    events: z.array(ycodeSessionEventSchema),
    snapshot: ycodeSessionStateSnapshotSchema.optional(),
  })
  .strict();
export const ycodeSessionListResultSchema = z
  .object({
    sessions: z.array(ycodeSessionInfoSchema),
  })
  .strict();

const ycodeSessionSubagentBaseSchema = z
  .object({
    childSessionId: nonEmptyString,
    agentId: nonEmptyString.optional(),
    toolCallId: nonEmptyString.optional(),
    subagentType: nonEmptyString,
    title: nonEmptyString,
    summary: z.string().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ycodeSessionRunningSubagentSchema = ycodeSessionSubagentBaseSchema.extend({
  status: z.enum(["running", "waiting", "blocked"]),
});
export type YCodeSessionRunningSubagent = z.infer<typeof ycodeSessionRunningSubagentSchema>;

export const ycodeSessionEndedSubagentSchema = ycodeSessionSubagentBaseSchema.extend({
  status: z.enum(["success", "failed", "cancelled", "lost"]),
});
export type YCodeSessionEndedSubagent = z.infer<typeof ycodeSessionEndedSubagentSchema>;

export const ycodeSessionSubagentsResultSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    childSessionIds: z.array(nonEmptyString),
    running: z.array(ycodeSessionRunningSubagentSchema),
    ended: z
      .object({
        total: z.number().int().nonnegative(),
        items: z.array(ycodeSessionEndedSubagentSchema),
        nextCursor: nonEmptyString.optional(),
      })
      .strict(),
  })
  .strict();
export type YCodeSessionSubagentsResult = z.infer<typeof ycodeSessionSubagentsResultSchema>;
export const ycodeSessionCreateParamsSchema = z
  .object({
    sessionId: nonEmptyString.optional(),
    workspace: ycodeWorkspaceRefSchema,
    parentSessionId: nonEmptyString.optional(),
    mode: ycodeSessionModeSchema.optional(),
    model: modelSelectionSchema.optional(),
    persistence: ycodeSessionPersistenceSchema.optional(),
    thoughtLevel: nonEmptyString.optional(),
    titleGenerationEnabled: z.boolean().optional(),
    mcpServers: z.array(ycodeProtocolMcpServerSchema).optional(),
    toolAllowlist: z.array(nonEmptyString).optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
    importedHistory: ycodeSessionImportHistorySchema.optional(),
    // 动态工作流灰度：host 裁决后下发，缺省不下发 = 不注册工作流工具簇（fail-closed）。
    dynamicWorkflowEnabled: z.boolean().optional(),
  })
  .strict();
export type YCodeSessionCreateParams = z.infer<typeof ycodeSessionCreateParamsSchema>;

export const ycodeSessionResumeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    workspace: ycodeWorkspaceRefSchema.optional(),
    // 旧 session 尚无 runtime/model_selection entry 时，由同 task 的索引元数据提供迁移 hint。
    thoughtLevel: nonEmptyString.optional(),
    mcpServers: z.array(ycodeProtocolMcpServerSchema).optional(),
    // 冷恢复重建 runtime 时必须沿用 create 的工具面约束（否则会绕过 allow/deny，尤其 CUA 会话）。
    toolAllowlist: z.array(nonEmptyString).optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
    // 与 create 同语义；resume 不带会导致冷恢复丢工作流工具簇。
    dynamicWorkflowEnabled: z.boolean().optional(),
  })
  .strict();
export type YCodeSessionResumeParams = z.infer<typeof ycodeSessionResumeParamsSchema>;

export const ycodeSessionListParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema.optional(),
    // 显式身份查询包含隐藏会话；普通列表仍只返回主任务，避免索引修复激活 runtime。
    sessionIds: z.array(nonEmptyString).min(1).max(64).optional(),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type YCodeSessionListParams = z.infer<typeof ycodeSessionListParamsSchema>;

export const ycodeSessionSubagentsParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    endedCursor: nonEmptyString.optional(),
    endedLimit: z.number().int().positive().max(100).default(20),
  })
  .strict();
export type YCodeSessionSubagentsParams = z.infer<typeof ycodeSessionSubagentsParamsSchema>;

export const ycodeUsageStatsParamsSchema = z
  .object({
    range: z.enum(APP_USAGE_RANGES),
    timeZone: z.string().optional(),
  })
  .strict();
export const ycodeUsageStatsResultSchema = appUsageSnapshotSchema;
export const ycodeTaskTokenUsageParamsSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();
export const ycodeTaskTokenUsageResultSchema = z
  .object({
    sessionId: nonEmptyString,
    totalTokens: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    modelRequestCount: z.number().int().nonnegative(),
    modelErrorCount: z.number().int().nonnegative(),
    inputBaselineBySource: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
export type YCodeTaskTokenUsageResult = z.infer<typeof ycodeTaskTokenUsageResultSchema>;

export const ycodeSessionReadParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    deliveryKind: ycodeDeliveryKindSchema.optional(),
    messageLimit: z.number().int().positive().optional(),
    afterSeq: z.number().int().nonnegative().optional(),
  })
  .strict();
export type YCodeSessionReadParams = z.infer<typeof ycodeSessionReadParamsSchema>;

export const ycodeSessionMessagesParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    afterMessageId: nonEmptyString.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type YCodeSessionMessagesParams = z.infer<typeof ycodeSessionMessagesParamsSchema>;

export const ycodeSessionEventsParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    afterSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type YCodeSessionEventsParams = z.infer<typeof ycodeSessionEventsParamsSchema>;

export const ycodeSessionRuntimePreferencesScopeSchema = z.enum([
  "runtime-materialization",
  "user-execution",
]);
export type YCodeSessionRuntimePreferencesScope = z.infer<
  typeof ycodeSessionRuntimePreferencesScopeSchema
>;

export const YCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS = 15_000;

export const ycodeSessionRequestRuntimePreferencesParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    scope: ycodeSessionRuntimePreferencesScopeSchema,
  })
  .strict();
export type YCodeSessionRequestRuntimePreferencesParams = z.infer<
  typeof ycodeSessionRequestRuntimePreferencesParamsSchema
>;

export const DEFAULT_YCODE_MODEL_CONTEXT_BUDGET_STRATEGY = "preflight-v1" as const;

// 3.12.2：legacy 仅为旧协议接收兼容；Runtime 一律归一为上面的共享默认策略。
export const ycodeModelContextBudgetStrategySchema = z.enum(["legacy", "preflight-v1"]);
export type YCodeModelContextBudgetStrategy = z.infer<typeof ycodeModelContextBudgetStrategySchema>;

export const ycodeSessionRuntimePreferencesResultSchema = z
  .object({
    nativeSearchEnhancementsEnabled: z.boolean(),
    // 兼容旧 Host：缺少字段时按产品默认关闭。
    toolSearchMode: appToolSearchModeSchema.default("off"),
    memoryEnabled: z.boolean().default(false),
    askUserQuestionAutoResolutionEnabled: z.boolean().default(true),
    integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
    // 兼容旧 Host：缺少字段时在协议解析边界使用当前默认策略。
    modelContextBudgetStrategy: ycodeModelContextBudgetStrategySchema.default(
      DEFAULT_YCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
    ),
  })
  .strict();
export type YCodeSessionRuntimePreferencesResult = z.infer<
  typeof ycodeSessionRuntimePreferencesResultSchema
>;

/**
 * App 在提交 prompt 前只读采集的 IAB 可见状态。该字段只用于 provider-visible
 * ambient context，不进入用户可见 transcript；内容有界，禁止携带页面正文或凭据。
 */
export const ycodeBrowserAmbientContextSchema = z
  .object({
    tabCount: z.number().int().positive().max(100),
    currentUrl: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();
export type YCodeBrowserAmbientContext = z.infer<typeof ycodeBrowserAmbientContextSchema>;

export const ycodeSessionSendParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    modelExecution: modelExecutionSchema.optional(),
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    content: z.string(),
    attachments: z.array(jsonObjectSchema).optional(),
    browserAmbientContext: ycodeBrowserAmbientContextSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    expectedProviderRevision: nonEmptyString.optional(),
    automationId: nonEmptyString.optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.modelExecution && !payload.modelSelection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "modelExecution requires modelSelection",
        path: ["modelExecution"],
      });
    }
  });
export const ycodeSessionSendResultSchema = z
  .object({
    sessionId: nonEmptyString,
    accepted: z.literal(true),
    stateRevision: z.number().int().nonnegative(),
  })
  .strict();
export type YCodeSessionSendResult = z.infer<typeof ycodeSessionSendResultSchema>;

export const ycodeSessionHistoryTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("turn"),
      turnIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message"),
      messageId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("checkpoint"),
      checkpointId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("latestCheckpoint"),
    })
    .strict(),
]);
export type YCodeSessionHistoryTarget = z.infer<typeof ycodeSessionHistoryTargetSchema>;

export const ycodeSessionForkParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    target: ycodeSessionHistoryTargetSchema.default({
      kind: "latestCheckpoint",
    }),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type YCodeSessionForkParams = z.infer<typeof ycodeSessionForkParamsSchema>;

export const ycodeSessionForkResultSchema = z
  .object({
    forkedSessionId: nonEmptyString,
    parentSessionId: nonEmptyString.optional(),
    targetMessageId: nonEmptyString.optional(),
    targetCheckpointId: nonEmptyString.optional(),
    response: z.string(),
    snapshot: ycodeSessionStateSnapshotSchema,
  })
  .strict();
export type YCodeSessionForkResult = z.infer<typeof ycodeSessionForkResultSchema>;

export const ycodeSessionCompactParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    instructions: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type YCodeSessionCompactParams = z.infer<typeof ycodeSessionCompactParamsSchema>;

export const ycodeSessionCompactResultSchema = z
  .object({
    response: z.string(),
    snapshot: ycodeSessionStateSnapshotSchema,
    compact: z
      .object({
        state: z.enum(["accepted", "already_running"]),
        inputId: nonEmptyString.optional(),
        operationId: nonEmptyString.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodeSessionCompactResult = z.infer<typeof ycodeSessionCompactResultSchema>;

export const ycodeSessionGoalActionSchema = z.enum([
  "show",
  "set",
  "replace",
  "pause",
  "resume",
  "clear",
]);
export type YCodeSessionGoalAction = z.infer<typeof ycodeSessionGoalActionSchema>;

export const ycodeSessionGoalParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    action: ycodeSessionGoalActionSchema,
    objective: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type YCodeSessionGoalParams = z.infer<typeof ycodeSessionGoalParamsSchema>;

export const ycodeSessionGoalResultSchema = z
  .object({
    response: z.string(),
    snapshot: ycodeSessionStateSnapshotSchema,
    startedTurn: z.boolean().optional(),
  })
  .strict();
export type YCodeSessionGoalResult = z.infer<typeof ycodeSessionGoalResultSchema>;

export const ycodeSessionStopParamsSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();
const ycodeBackgroundTaskInfoStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "spawn_error",
  "lost",
]);

export const ycodeBackgroundTaskInfoSchema = z
  .object({
    taskId: nonEmptyString,
    toolCallId: nonEmptyString.optional(),
    toolName: nonEmptyString.optional(),
    taskKind: z.enum(["bash", "subagent"]).optional(),
    blocked: z.boolean().optional(),
    blockedReason: z.string().optional(),
    cancellable: z.boolean().optional(),
    cancelRequestedAt: protocolInstantSchema.optional(),
    command: z.string().optional(),
    description: z.string().optional(),
    status: ycodeBackgroundTaskInfoStatusSchema,
    pid: z.number().int().positive().optional(),
    startedAt: protocolInstantSchema.optional(),
    completedAt: protocolInstantSchema.optional(),
    outputPath: z.string().optional(),
    stderrPersistedOutputPath: z.string().optional(),
    stdoutPersistedOutputPath: z.string().optional(),
    outputBytes: z.number().int().nonnegative().optional(),
    outputTruncated: z.boolean().optional(),
    outputTail: z.string().optional(),
    stderrBytes: z.number().int().nonnegative().optional(),
    stderrTail: z.string().optional(),
    stdoutBytes: z.number().int().nonnegative().optional(),
    stdoutTail: z.string().optional(),
    terminalId: nonEmptyString.optional(),
  })
  .strict();
export const ycodeSessionCancelBackgroundTaskParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    taskId: nonEmptyString,
  })
  .strict();
export type YCodeSessionCancelBackgroundTaskParams = z.infer<
  typeof ycodeSessionCancelBackgroundTaskParamsSchema
>;

export const ycodeSessionCancelBackgroundTaskResultSchema = z
  .object({
    cancelled: z.boolean(),
    reason: z.string().optional(),
    snapshot: ycodeBackgroundTaskInfoSchema.optional(),
    status: ycodeBackgroundTaskInfoStatusSchema,
    taskId: nonEmptyString,
  })
  .strict();
export type YCodeSessionCancelBackgroundTaskResult = z.infer<
  typeof ycodeSessionCancelBackgroundTaskResultSchema
>;

export const ycodeSessionSetModelParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    model: modelSelectionSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: z.boolean().default(true),
  })
  .strict();
export type YCodeSessionSetModelParams = z.infer<typeof ycodeSessionSetModelParamsSchema>;

export const ycodeSessionSetThoughtLevelParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    thoughtLevel: nonEmptyString.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: z.boolean().default(true),
  })
  .strict();
export type YCodeSessionSetThoughtLevelParams = z.infer<
  typeof ycodeSessionSetThoughtLevelParamsSchema
>;

export const ycodeSessionSetModeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    mode: ycodeSessionModeSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type YCodeSessionSetModeParams = z.infer<typeof ycodeSessionSetModeParamsSchema>;

export const ycodeSessionCloseParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    expectedPersistence: ycodeSessionPersistenceSchema.optional(),
  })
  .strict();
export type YCodeSessionCloseParams = z.infer<typeof ycodeSessionCloseParamsSchema>;
export const ycodeSessionCloseResultSchema = z
  .object({
    closed: z.boolean().optional(),
  })
  .strict();
export type YCodeSessionCloseResult = z.infer<typeof ycodeSessionCloseResultSchema>;
export const ycodeWorkspaceReadPresentationParamsSchema = z
  .object({ workspace: ycodeWorkspaceRefSchema })
  .strict();
export const ycodeWorkspacePresentationSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    mode: ycodeSessionModeSchema,
    slashCommands: z.array(ycodeSlashCommandSchema),
  })
  .strict();
export type YCodeWorkspacePresentation = z.infer<typeof ycodeWorkspacePresentationSchema>;
const workspaceHookSha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const ycodeWorkspaceHookTrustGrantParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    bundleDigest: workspaceHookSha256DigestSchema,
    hookDeclarationDigest: workspaceHookSha256DigestSchema,
  })
  .strict();
export type YCodeWorkspaceHookTrustGrantParams = z.infer<
  typeof ycodeWorkspaceHookTrustGrantParamsSchema
>;
export const ycodeWorkspaceHookTrustGrantReasonCodeSchema = z.enum([
  "workspace_hooks_blocked_by_policy",
  "workspace_hooks_bundle_changed",
  "workspace_hooks_snapshot_mismatch",
  "workspace_hooks_policy_requires_pretrust",
  "workspace_hooks_trust_store_corrupt",
  "workspace_hooks_config_unreadable",
]);
export type YCodeWorkspaceHookTrustGrantReasonCode = z.infer<
  typeof ycodeWorkspaceHookTrustGrantReasonCodeSchema
>;
export const ycodeWorkspaceHookTrustGrantResultSchema = z
  .object({
    accepted: z.boolean(),
    reasonCode: ycodeWorkspaceHookTrustGrantReasonCodeSchema.optional(),
  })
  .strict();
export type YCodeWorkspaceHookTrustGrantResult = z.infer<
  typeof ycodeWorkspaceHookTrustGrantResultSchema
>;
const ycodeWorkspaceModelToolCallSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    input: z.unknown(),
  })
  .strict();
const ycodeWorkspaceModelMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }).strict(),
  z.object({ role: z.literal("user"), content: z.string() }).strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(ycodeWorkspaceModelToolCallSchema).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      content: z.string(),
      toolCallId: nonEmptyString,
      toolName: nonEmptyString,
      isError: z.boolean().optional(),
    })
    .strict(),
]);
const ycodeWorkspaceModelToolSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ycodeWorkspaceGenerateTextParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    selection: modelSelectionSchema,
    prompt: nonEmptyString.optional(),
    messages: z.array(ycodeWorkspaceModelMessageSchema).min(1).optional(),
    tools: z.array(ycodeWorkspaceModelToolSchema).optional(),
    querySource: nonEmptyString,
    maxOutputTokens: z.number().int().positive().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict()
  .refine((value) => value.prompt !== undefined || value.messages !== undefined, {
    message: "prompt 或 messages 至少需要提供一个",
  });
export const ycodeWorkspaceGenerateTextResultSchema = z
  .object({
    text: z.string(),
    selection: modelSelectionSchema,
    toolCalls: z.array(ycodeWorkspaceModelToolCallSchema).optional(),
    // 可选以兼容仍在运行的旧 app-server；新 CLI 始终返回结构化结束原因。
    finishReason: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number().nonnegative().optional(),
        outputTokens: z.number().nonnegative().optional(),
        totalTokens: z.number().nonnegative().optional(),
        cacheReadTokens: z.number().nonnegative().optional(),
        cacheWriteTokens: z.number().nonnegative().optional(),
        reasoningTokens: z.number().nonnegative().optional(),
        serverToolUse: z
          .object({
            webSearchRequests: z.number().nonnegative().optional(),
            webFetchRequests: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodeWorkspaceGenerateTextParams = z.infer<
  typeof ycodeWorkspaceGenerateTextParamsSchema
>;
export type YCodeWorkspaceModelMessage = z.infer<typeof ycodeWorkspaceModelMessageSchema>;
export type YCodeWorkspaceModelTool = z.infer<typeof ycodeWorkspaceModelToolSchema>;
export type YCodeWorkspaceGenerateTextResult = z.infer<
  typeof ycodeWorkspaceGenerateTextResultSchema
>;
export const ycodeWorkspaceCancelGenerateTextParamsSchema = z
  .object({ operationId: nonEmptyString })
  .strict();
export const ycodeWorkspaceCancelGenerateTextResultSchema = z
  .object({ operationId: nonEmptyString, cancelled: z.boolean() })
  .strict();

export const ycodeProviderTestModelConnectivityParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    selection: modelSelectionSchema,
  })
  .strict();
export const ycodeProviderTestModelConnectivityResultSchema = z
  .object({ success: z.literal(true) })
  .strict();
export type YCodeProviderTestModelConnectivityParams = z.infer<
  typeof ycodeProviderTestModelConnectivityParamsSchema
>;
export type YCodeProviderTestModelConnectivityResult = z.infer<
  typeof ycodeProviderTestModelConnectivityResultSchema
>;

export const ycodeInteractionPreferencesSchema = z
  .object({
    askUserQuestionAutoResolutionEnabled: z.boolean(),
  })
  .strict();
export type YCodeInteractionPreferences = z.infer<typeof ycodeInteractionPreferencesSchema>;

export const ycodeWorkspaceUpdateInteractionPreferencesParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    preferences: ycodeInteractionPreferencesSchema,
  })
  .strict();
export type YCodeWorkspaceUpdateInteractionPreferencesParams = z.infer<
  typeof ycodeWorkspaceUpdateInteractionPreferencesParamsSchema
>;

export const ycodeWorkspaceUpdateInteractionPreferencesResultSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    askUserQuestionAutoResolutionEnabled: z.boolean(),
    snoozedInteractionCount: z.number().int().nonnegative(),
  })
  .strict();
export type YCodeWorkspaceUpdateInteractionPreferencesResult = z.infer<
  typeof ycodeWorkspaceUpdateInteractionPreferencesResultSchema
>;

export const ycodeModelIoPreferencesSchema = z
  .object({
    fullRetentionEnabled: z.boolean(),
  })
  .strict();
export type YCodeModelIoPreferences = z.infer<typeof ycodeModelIoPreferencesSchema>;

export const ycodeWorkspaceUpdateModelIoPreferencesParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    preferences: ycodeModelIoPreferencesSchema,
  })
  .strict();
export type YCodeWorkspaceUpdateModelIoPreferencesParams = z.infer<
  typeof ycodeWorkspaceUpdateModelIoPreferencesParamsSchema
>;

export const ycodeWorkspaceUpdateModelIoPreferencesResultSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    fullRetentionEnabled: z.boolean(),
    updatedSessionCount: z.number().int().nonnegative(),
  })
  .strict();
export type YCodeWorkspaceUpdateModelIoPreferencesResult = z.infer<
  typeof ycodeWorkspaceUpdateModelIoPreferencesResultSchema
>;

// 动态工作流灰度门禁：workspace 级事实，旧 CLI method-not-found → host 降级忽略。
export const ycodeWorkspaceUpdateDynamicWorkflowPolicyParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type YCodeWorkspaceUpdateDynamicWorkflowPolicyParams = z.infer<
  typeof ycodeWorkspaceUpdateDynamicWorkflowPolicyParamsSchema
>;

export const ycodeWorkspaceUpdateDynamicWorkflowPolicyResultSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type YCodeWorkspaceUpdateDynamicWorkflowPolicyResult = z.infer<
  typeof ycodeWorkspaceUpdateDynamicWorkflowPolicyResultSchema
>;

export const ycodePermissionRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    reason: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    input: z.unknown(),
    origin: ycodeInteractionRequestOriginSchema.optional(),
    options: z.array(ycodePermissionOptionSchema).min(1),
  })
  .strict();
export type YCodePermissionRequestParams = z.infer<typeof ycodePermissionRequestParamsSchema>;

/** Agent 请求 app 枚举当前 workspace/session 可达且已完成握手的 browser backend。 */
export const ycodeBrowserListParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    workspaceKey: nonEmptyString,
    workspacePath: nonEmptyString,
    workspaceIdentity: nonEmptyString.optional(),
    remoteSessionId: nonEmptyString.optional(),
    clientMode: browserClientModeSchema,
    sessionContext: browserSessionContextKindSchema,
  })
  .strict();
export type YCodeBrowserListParams = z.infer<typeof ycodeBrowserListParamsSchema>;

export const ycodeBrowserListResultSchema = browserBackendListResultSchema;
export type YCodeBrowserListResult = z.infer<typeof ycodeBrowserListResultSchema>;

/** Agent 把一条 browser-use 命令发送给 app 执行。 */
export const ycodeBrowserExecuteParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    browserId: nonEmptyString.optional(),
    browserGeneration: z.number().int().nonnegative().optional(),
    workspaceKey: nonEmptyString.optional(),
    workspacePath: nonEmptyString.optional(),
    workspaceIdentity: nonEmptyString.optional(),
    remoteSessionId: nonEmptyString.optional(),
    clientMode: browserClientModeSchema.optional(),
    sessionContext: browserSessionContextKindSchema.optional(),
    command: browserCommandSchema,
  })
  .strict();
export type YCodeBrowserExecuteParams = z.infer<typeof ycodeBrowserExecuteParamsSchema>;

// browser command result 是 app/agent 的同源协议结果；其中 duplicate_request_id 用于在真正维护
// pending/running 生命周期的边界拒绝 correlation key 冲突，不能依赖上游 UUID 概率保证。
export const ycodeBrowserExecuteResultSchema = browserCommandResultSchema;
export type YCodeBrowserExecuteResult = z.infer<typeof ycodeBrowserExecuteResultSchema>;

export const ycodeUserInputOptionSchema = z
  .object({
    value: nonEmptyString,
    label: nonEmptyString,
    description: z.string().optional(),
    preview: z.string().optional(),
  })
  .strict();
export const ycodeUserInputQuestionSchema = z
  .object({
    question: nonEmptyString,
    header: nonEmptyString,
    options: z.array(ycodeUserInputOptionSchema).min(1),
    multiSelect: z.boolean().optional(),
  })
  .strict();
export type YCodeUserInputQuestion = z.infer<typeof ycodeUserInputQuestionSchema>;

export const ycodeUserInputRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    toolCallId: nonEmptyString.optional(),
    toolName: nonEmptyString.optional(),
    prompt: z.string().optional(),
    questions: z.array(ycodeUserInputQuestionSchema).min(1).optional(),
    input: z.unknown().optional(),
    origin: ycodeInteractionRequestOriginSchema.optional(),
    schema: z.unknown().optional(),
  })
  .strict();
export type YCodeUserInputRequestParams = z.infer<typeof ycodeUserInputRequestParamsSchema>;

export const ycodeUserInputResponseSchema = z
  .object({
    action: z.enum(["accept", "decline", "cancel"]),
    content: jsonObjectSchema.optional(),
    reason: z.string().optional(),
  })
  .strict();
export type YCodeUserInputResponse = z.infer<typeof ycodeUserInputResponseSchema>;

export const ycodeProviderRuntimeHeadersRequestReasonSchema = z.enum(["model-request"]);
export const ycodeProviderRuntimeHeadersRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    workspace: ycodeWorkspaceRefSchema,
    modelSelection: modelSelectionSchema,
    providerId: nonEmptyString,
    accountAccess: ycodeProviderAccountAccessSchema.optional(),
    reason: ycodeProviderRuntimeHeadersRequestReasonSchema,
  })
  .strict();
export type YCodeProviderRuntimeHeadersRequestParams = z.infer<
  typeof ycodeProviderRuntimeHeadersRequestParamsSchema
>;

/** 请求取消只作用于同 workspace/session 的这一轮凭据刷新。 */
export const ycodeProviderRuntimeHeadersCancelledSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    workspace: ycodeWorkspaceRefSchema,
  })
  .strict();
export type YCodeProviderRuntimeHeadersCancelled = z.infer<
  typeof ycodeProviderRuntimeHeadersCancelledSchema
>;

export const ycodeProviderRuntimeHeadersResponseSchema = z.discriminatedUnion("headersApplied", [
  z
    .object({
      headersApplied: z.literal(true),
      // 合并重接：成功必须携带当前请求的鉴权材料，不依赖旧 Registry 已被写入。
      requestAuth: z
        .object({
          apiKey: nonEmptyString.optional(),
          headers: z.record(nonEmptyString, nonEmptyString).optional(),
        })
        .strict(),
      errorMessage: nonEmptyString.optional(),
    })
    .strict(),
  z
    .object({
      headersApplied: z.literal(false),
      errorMessage: nonEmptyString.optional(),
    })
    .strict(),
]);
export type YCodeProviderRuntimeHeadersResponse = z.infer<
  typeof ycodeProviderRuntimeHeadersResponseSchema
>;

// ── Plugin management (list + enable/disable) ──
// 镜像 @ycode/contracts 的 PluginMetadata, 仅保留 UI 需要的可序列化字段。
export const ycodePluginOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type YCodePluginOptionValue = z.infer<typeof ycodePluginOptionValueSchema>;
export const ycodePluginScopeSchema = z.enum(["user", "workspace"]);
export type YCodePluginScope = z.infer<typeof ycodePluginScopeSchema>;
export const ycodePluginHookDetailSchema = z
  .object({
    event: nonEmptyString,
    matcher: z.string().optional(),
    type: z.enum(["command", "process"]),
    command: nonEmptyString,
    args: z.array(z.string()).optional(),
    async: z.boolean().optional(),
    shell: z.union([z.literal(true), z.string()]).optional(),
    timeout: z.number().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    sourcePath: z.string(),
    runnable: z.boolean(),
  })
  .strict();
export const ycodePluginUserConfigOptionSchema = z
  .object({
    default: ycodePluginOptionValueSchema.optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    title: z.string().optional(),
    type: z.enum(["string", "number", "boolean", "directory", "file"]).optional(),
  })
  .strict();
export type YCodePluginUserConfigOption = z.infer<typeof ycodePluginUserConfigOptionSchema>;

// 组件类型与详情弹窗/市场详情共用的分组顺序保持一致：agent / command / skill / hook / mcp。
// 注意：这三个 schema 必须定义在 ycodePluginInfoSchema 之前，因为后者（.strict()）的 components 字段引用了它们。
export const ycodePluginComponentKindSchema = z.enum(["agent", "command", "skill", "hook", "mcp"]);
export type YCodePluginComponentKind = z.infer<typeof ycodePluginComponentKindSchema>;

export const ycodePluginComponentItemSchema = z
  .object({
    name: nonEmptyString,
    // 描述来自组件 frontmatter（SKILL.md / command / agent）或 manifest；缺失时省略，不伪造。
    description: z.string().optional(),
  })
  .strict();
export const ycodePluginComponentGroupSchema = z
  .object({
    kind: ycodePluginComponentKindSchema,
    items: z.array(ycodePluginComponentItemSchema),
  })
  .strict();
export type YCodePluginComponentGroup = z.infer<typeof ycodePluginComponentGroupSchema>;

export const ycodePluginInfoSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    enabled: z.boolean(),
    source: nonEmptyString,
    marketplace: nonEmptyString,
    // manifest（plugin.json）的作者/主页回退字段；商店 listing 缺失时详情页信息区用它兜底。
    author: z.string().optional(),
    authorUrl: z.string().optional(),
    homepage: z.string().optional(),
    skillCount: z.number().int().nonnegative().optional(),
    skillRootCount: z.number().int().nonnegative(),
    commandRootCount: z.number().int().nonnegative(),
    // 权威组件清单（名称 + 可选描述），由 CLI 对插件根目录枚举得出，与启用态无关。
    // 详情 UI 直接展示，取代旧的「数量取协议、名称靠 UI 侧 join」脆弱方案。optional 兼容旧 payload。
    components: z.array(ycodePluginComponentGroupSchema).optional(),
    declaredMcpServerNames: z.array(z.string()).optional(),
    hostMcpServerNames: z.array(z.string()).optional(),
    mcpServerNames: z.array(z.string()),
    hookDetails: z.array(ycodePluginHookDetailSchema).optional(),
    rootPath: z.string(),
    userConfig: z.record(z.string(), ycodePluginUserConfigOptionSchema).optional(),
    configuredOptions: z.record(z.string(), ycodePluginOptionValueSchema).optional(),
    // 缺省表示 package 可用；missing 用于保留已声明但目标 Host 尚未物化的配置行。
    packageStatus: z.literal("missing").optional(),
    rootSource: ycodePluginScopeSchema.optional(),
    enabledSource: ycodePluginScopeSchema.optional(),
    optionSources: z.record(z.string(), ycodePluginScopeSchema).optional(),
  })
  .strict();
export type YCodePluginInfo = z.infer<typeof ycodePluginInfoSchema>;

export const ycodePluginDiagnosticSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["warning", "error"]).optional(),
    pluginId: z.string().optional(),
  })
  .strict();
export type YCodePluginDiagnostic = z.infer<typeof ycodePluginDiagnosticSchema>;

export const ycodePluginsListParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    configScope: ycodePluginScopeSchema.optional(),
  })
  .strict();
export const ycodePluginsListResultSchema = z
  .object({
    plugins: z.array(ycodePluginInfoSchema),
    diagnostics: z.array(ycodePluginDiagnosticSchema),
  })
  .strict();
export type YCodePluginsListResult = z.infer<typeof ycodePluginsListResultSchema>;

// ── Plugin 对话引用 catalog──
// Session-scoped 只读投影：带 sessionId → 该 Session 创建时冻结的身份 catalog；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。身份与能力字段保持
// identifiers-only，不携带 rootPath/配置等；可选 icon/displayName(I18n)/description(I18n)
// 仅供 UI 展示与 Picker 搜索，不参与身份、权限或 runtime reminder。
export const ycodePluginReferenceCatalogEntrySchema = z
  .object({
    // 仅 referenceCatalogWithCategory 返回；旧入口保持原结构。
    category: nonEmptyString.optional(),
    pluginId: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    icon: z.string().optional(),
    // 商店 listing 的 display-only 本地化显示名投影（沿 icon 先例）：让 Picker 能按
    // 中文显示名搜索/展示；locale 解析复用 shared 的 plugin-display-name helper。
    displayName: z.string().optional(),
    displayNameI18n: z.record(z.string(), z.string()).optional(),
    // 仅供 Picker 展示，不进入能力身份或 model-only reminder。
    description: z.string().optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean(),
    // 非空 = 与其他 enabled Plugin 共享 manifest name 的 V1 fail closed 冲突：
    // Picker 禁选并展示原因，runtime 解析按 ambiguous 跳过。
    conflictingPluginIds: z.array(nonEmptyString),
    skillQualifiedNames: z.array(nonEmptyString),
    mcpServerNames: z.array(nonEmptyString),
    // 旧 Host 不投影该字段时按空数组兼容；只有新 Agent 会把它用于 reminder live 交集。
    subagentNames: z.array(nonEmptyString).default([]),
  })
  .strict();
export type YCodePluginReferenceCatalogEntry = z.infer<
  typeof ycodePluginReferenceCatalogEntrySchema
>;

export const ycodePluginsReferenceCatalogParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    // 已有 Session 的 Picker 必须带 sessionId 才能拿到 session-owned catalog；
    // session 不存在时按协议错误 fail closed，禁止静默回退 workspace authority。
    sessionId: nonEmptyString.optional(),
  })
  .strict();
export type YCodePluginsReferenceCatalogParams = z.infer<
  typeof ycodePluginsReferenceCatalogParamsSchema
>;
export const ycodePluginsReferenceCatalogResultSchema = z
  .object({
    authority: z.enum(["session", "workspace"]),
    plugins: z.array(ycodePluginReferenceCatalogEntrySchema),
  })
  .strict();
export type YCodePluginsReferenceCatalogResult = z.infer<
  typeof ycodePluginsReferenceCatalogResultSchema
>;

// ── Skill 对话引用 catalog──
// 新草稿读取 workspace 当前目录；已有 Session 读取 AgentRuntime 首次 context
// 初始化时冻结的发现结果。该协议只承载 Composer 的只读引用投影，不替代 Settings
// 的 Skill 管理接口，也不持久化 runtime 快照。
export const ycodeSkillReferenceCatalogEntrySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    description: z.string(),
    path: nonEmptyString,
    scope: z.enum(["workspace", "user", "plugin"]),
    enabled: z.literal(true),
    pluginName: nonEmptyString.optional(),
  })
  .strict();
export type YCodeSkillReferenceCatalogEntry = z.infer<typeof ycodeSkillReferenceCatalogEntrySchema>;

export const ycodeSkillsReferenceCatalogParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    // 带 sessionId 时必须命中该进程内的 resident Session；未知 Session fail closed，
    // 禁止回退到 workspace 当前目录而把新 Skill 泄漏进旧对话。
    sessionId: nonEmptyString.optional(),
  })
  .strict();
export type YCodeSkillsReferenceCatalogParams = z.infer<
  typeof ycodeSkillsReferenceCatalogParamsSchema
>;
export const ycodeSkillsReferenceCatalogResultSchema = z
  .object({
    authority: z.enum(["session", "workspace"]),
    skills: z.array(ycodeSkillReferenceCatalogEntrySchema),
  })
  .strict();
export type YCodeSkillsReferenceCatalogResult = z.infer<
  typeof ycodeSkillsReferenceCatalogResultSchema
>;

// ── 已保存工作流的 GUI 中枢──
// workspace 级、无会话的五个方法，照 skills/referenceCatalog 的先例：每次调用现扫
// `<cwd>/.ycode/workflows/`（挂载时快照会漏掉手改的文件）。形状与 @ycode/contracts 的
// saved-workflow.ts 逐字对齐——依赖方向是 contracts → shared，所以这里结构化地再声明一遍，
// 而不是 import；两边的 strict 形状由 bootstrap 侧的协议测试互相钉住。
export const ycodeSavedWorkflowArgTypeSchema = z.enum(["string", "number", "boolean", "json"]);
export type YCodeSavedWorkflowArgType = z.infer<typeof ycodeSavedWorkflowArgTypeSchema>;
export const ycodeSavedWorkflowArgDeclarationSchema = z
  .object({
    type: ycodeSavedWorkflowArgTypeSchema,
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .strict();
export type YCodeSavedWorkflowArgDeclaration = z.infer<
  typeof ycodeSavedWorkflowArgDeclarationSchema
>;
export const ycodeSavedWorkflowArgsDeclarationSchema = z.record(
  z.string(),
  ycodeSavedWorkflowArgDeclarationSchema,
);
export type YCodeSavedWorkflowArgsDeclaration = z.infer<
  typeof ycodeSavedWorkflowArgsDeclarationSchema
>;
export const ycodeSavedWorkflowMetaSchema = z
  .object({
    description: nonEmptyString,
    whenToUse: nonEmptyString.optional(),
    args: ycodeSavedWorkflowArgsDeclarationSchema.optional(),
  })
  .strict();
export type YCodeSavedWorkflowMeta = z.infer<typeof ycodeSavedWorkflowMetaSchema>;
// 作用域两档：项目档落 `<cwd>/.ycode/workflows/`、全局档落 agent 机器的 `~/.ycode/workflows/`。作用域由文件所在目录推得，frontmatter 不存 scope。
export const ycodeSavedWorkflowScopeSchema = z.enum(["project", "global"]);
export type YCodeSavedWorkflowScope = z.infer<typeof ycodeSavedWorkflowScopeSchema>;
export const ycodeSavedWorkflowEntrySchema = z
  .object({
    name: nonEmptyString,
    description: z.string(),
    whenToUse: z.string().optional(),
    args: ycodeSavedWorkflowArgsDeclarationSchema.optional(),
    scope: ycodeSavedWorkflowScopeSchema,
    path: nonEmptyString,
  })
  .strict();
export type YCodeSavedWorkflowEntry = z.infer<typeof ycodeSavedWorkflowEntrySchema>;
export const ycodeSavedWorkflowInvalidEntrySchema = z
  .object({ path: nonEmptyString, reason: nonEmptyString })
  .strict();
export type YCodeSavedWorkflowInvalidEntry = z.infer<typeof ycodeSavedWorkflowInvalidEntrySchema>;
/** 名字非法 / 未找到 / frontmatter 坏 / 读错——与 core store 的 resolve 失败四态逐字对应。 */
export const ycodeSavedWorkflowFailureReasonSchema = z.enum([
  "invalid_name",
  "not_found",
  "parse_error",
  "read_error",
]);
export type YCodeSavedWorkflowFailureReason = z.infer<typeof ycodeSavedWorkflowFailureReasonSchema>;
const ycodeSavedWorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: ycodeSavedWorkflowFailureReasonSchema,
    detail: z.string().optional(),
  })
  .strict();

export const ycodeWorkflowsListParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    // 缺省即 `project`（本项目档）。给 `global` 时改扫本机 `~/.ycode/workflows/`；此时 `workspace`
    // 仍必填，但只是**载体运行时**——协议处理器对全局档不读它的路径。
    scope: ycodeSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type YCodeWorkflowsListParams = z.infer<typeof ycodeWorkflowsListParamsSchema>;
export const ycodeWorkflowsListResultSchema = z
  .object({
    workflows: z.array(ycodeSavedWorkflowEntrySchema),
    invalid: z.array(ycodeSavedWorkflowInvalidEntrySchema),
    // 扫过的目录（本地绝对路径），即使目录还不存在也回：GUI 的文件监听靠它 watch。
    dir: nonEmptyString,
  })
  .strict();
export type YCodeWorkflowsListResult = z.infer<typeof ycodeWorkflowsListResultSchema>;

export const ycodeWorkflowsGetParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    name: nonEmptyString,
    // 缺省 `project`；`global` 时只查本机全局根。`workspace` 语义同 list（全局档只当载体）。
    scope: ycodeSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type YCodeWorkflowsGetParams = z.infer<typeof ycodeWorkflowsGetParamsSchema>;
export const ycodeWorkflowsGetResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      name: nonEmptyString,
      path: nonEmptyString,
      scope: ycodeSavedWorkflowScopeSchema,
      meta: ycodeSavedWorkflowMetaSchema,
      /** 脚本本体（frontmatter 之后逐字节），即被类型检查与执行的那一份。 */
      script: z.string(),
    })
    .strict(),
  ycodeSavedWorkflowFailureSchema,
]);
export type YCodeWorkflowsGetResult = z.infer<typeof ycodeWorkflowsGetResultSchema>;

export const ycodeWorkflowsUpdateMetaParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    name: nonEmptyString,
    meta: ycodeSavedWorkflowMetaSchema,
    // 缺省 `project`；`global` 时只写本机全局根那一份。`workspace` 语义同 list。
    scope: ycodeSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type YCodeWorkflowsUpdateMetaParams = z.infer<typeof ycodeWorkflowsUpdateMetaParamsSchema>;
export const ycodeWorkflowsUpdateMetaResultSchema = z.union([
  z.object({ ok: z.literal(true), path: nonEmptyString }).strict(),
  ycodeSavedWorkflowFailureSchema,
]);
export type YCodeWorkflowsUpdateMetaResult = z.infer<typeof ycodeWorkflowsUpdateMetaResultSchema>;

export const ycodeWorkflowsDeleteParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    name: nonEmptyString,
    // 缺省 `project`；`global` 时按 scope 选根删除（不再写死 roots[0]）。`workspace` 语义同 list。
    scope: ycodeSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type YCodeWorkflowsDeleteParams = z.infer<typeof ycodeWorkflowsDeleteParamsSchema>;
export const ycodeWorkflowsDeleteResultSchema = z.union([
  z.object({ ok: z.literal(true), path: nonEmptyString }).strict(),
  ycodeSavedWorkflowFailureSchema,
]);
export type YCodeWorkflowsDeleteResult = z.infer<typeof ycodeWorkflowsDeleteResultSchema>;

export const YCODE_WORKFLOWS_RUNS_MAX_LIMIT = 50;
export const ycodeWorkflowsRunsParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    /** 只要这个名字的 run（`dwf_run.name` 字面等值）；缺省即本项目全部 run。 */
    name: nonEmptyString.optional(),
    limit: z.number().int().min(1).max(YCODE_WORKFLOWS_RUNS_MAX_LIMIT),
    // 缺省 `project`：只查 `dwf_run.cwd === workspacePath` 的 run。`global` 时**不**按 cwd 过滤，
    // 跨所有项目取该名字的运行历史（全局工作流在任何项目里跑，历史因此跨 cwd）；结果行带 `cwd`
    // 供 GUI 标项目。`workspace` 语义同 list（全局档只当载体）。
    scope: ycodeSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type YCodeWorkflowsRunsParams = z.infer<typeof ycodeWorkflowsRunsParamsSchema>;
// 三终态词汇：errored = 脚本之错，stopped = 被停下（可恢复）。
export const ycodeSavedWorkflowRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "errored",
  "stopped",
]);
export type YCodeSavedWorkflowRunStatus = z.infer<typeof ycodeSavedWorkflowRunStatusSchema>;
export const ycodeSavedWorkflowRunStopReasonSchema = z.enum([
  "user",
  "model",
  "provider",
  "interrupted",
  "superseded",
]);
export const ycodeSavedWorkflowRunSchema = z
  .object({
    runId: nonEmptyString,
    name: z.string().optional(),
    status: ycodeSavedWorkflowRunStatusSchema,
    // `status === "stopped"` 才在场。
    stopReason: ycodeSavedWorkflowRunStopReasonSchema.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    spentTokens: z.number(),
    /** 发起它的会话与 CreateWorkflow 工具调用：有这两个才能从中枢打开实例详情。老行可缺。 */
    parentSessionId: z.string().optional(),
    toolCallId: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    // 实际运行的项目目录（`dwf_run.cwd`）。全局档的 `workflows/runs` 跨 cwd 查询，GUI 用它给
    // 每行标项目；项目档变体里它恒等于 workspacePath，GUI 可忽略。老行可缺。
    cwd: z.string().optional(),
    // 这次运行发布的**用户面产物**：中枢的运行历史行在
    // 状态词之后画一串 kind chips，详情页头部的「最近产物」条取最近一次 completed run 的这一份。
    // ⚠ 术语：这里的 artifact 是脚本经 `artifact.*` 发布给用户看的产出，不是脚本的顶层返回值。
    // 只带 chip 画得下的字段（≤ 8 件，取最新版的元数据）；字节与条目经 v4 查询按需读。
    // optional，照上面 `cwd` 的先例：老 CLI 不发，少一个键是退化不是错误。
    artifacts: z
      .array(
        z
          .object({
            id: nonEmptyString,
            kind: z.enum(["file", "markdown", "chart", "table", "metrics", "board"]),
            title: z.string().optional(),
            version: z.number(),
            contentType: z.string().optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
  })
  .strict();
export type YCodeSavedWorkflowRun = z.infer<typeof ycodeSavedWorkflowRunSchema>;
export const ycodeWorkflowsRunsResultSchema = z
  .object({
    runs: z.array(ycodeSavedWorkflowRunSchema),
    /** 为真时才在场：还有更多 run 没进这一页（多取一条判定，不是 length === limit）。 */
    truncated: z.literal(true).optional(),
  })
  .strict();
export type YCodeWorkflowsRunsResult = z.infer<typeof ycodeWorkflowsRunsResultSchema>;

// workflows/move：把本机全局根的同名文件搬到 `workspace` 项目根。**只此一向**：项目→全局不是搬文件而是模型的概括（「提升为
// 全局」在该项目开新会话、经 SaveWorkflow 另存），所以没有 `to` 参数。同机同用户，rename 优先、EXDEV
// 回落 copy+unlink；逐字节搬，不改内容（frontmatter 不存 scope）；`move` 不覆盖——目标已存在即拒绝
// （覆盖是 SaveWorkflow 经确认窗才有的动作，不变式 7）。`workspace` 既是载体运行时也是目标项目。
export const ycodeWorkflowsMoveParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    name: nonEmptyString,
  })
  .strict();
export type YCodeWorkflowsMoveParams = z.infer<typeof ycodeWorkflowsMoveParamsSchema>;
export const ycodeWorkflowsMoveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      /** 源落点路径（全局根，搬走前）。 */
      from: nonEmptyString,
      /** 目标落点路径（项目根，搬到处）。 */
      to: nonEmptyString,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      // target_exists：目标档已有同名（move 不覆盖）；not_found：源档没有这个名字；
      // read_error / write_error：搬运时的 I/O 失败；invalid_name：名字先验没过。
      reason: z.enum(["invalid_name", "not_found", "target_exists", "read_error", "write_error"]),
      path: z.string().optional(),
      detail: z.string().optional(),
    })
    .strict(),
]);
export type YCodeWorkflowsMoveResult = z.infer<typeof ycodeWorkflowsMoveResultSchema>;

// 推荐 Prompt 的可信插件解析：UI 不拆解 stableId，也不从旧目录快照推断可安装性。
export const ycodePluginSuggestedReferenceStatusSchema = z.enum([
  "ready",
  "disabled",
  "missing",
  "conflict",
  "unavailable",
]);
export type YCodePluginSuggestedReferenceStatus = z.infer<
  typeof ycodePluginSuggestedReferenceStatusSchema
>;
export const ycodePluginOperationStateSchema = z.enum([
  "checking",
  "refreshing",
  "installing",
  "enabling",
  "cancelling",
  "cancelled",
  "complete",
  "failed",
]);
export type YCodePluginOperationState = z.infer<typeof ycodePluginOperationStateSchema>;
export const ycodePluginOperationProgressNotificationSchema = z
  .object({
    operationId: nonEmptyString,
    state: z.literal("refreshing"),
  })
  .strict();
export type YCodePluginOperationProgressNotification = z.infer<
  typeof ycodePluginOperationProgressNotificationSchema
>;
export const ycodePluginsResolveSuggestedReferenceParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    stableId: nonEmptyString,
    operationId: nonEmptyString,
    clientMode: ycodeDeliveryKindSchema,
    deliveryKind: ycodeDeliveryKindSchema,
  })
  .strict();
export type YCodePluginsResolveSuggestedReferenceParams = z.infer<
  typeof ycodePluginsResolveSuggestedReferenceParamsSchema
>;
export const ycodePluginsSetEnabledParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginId: nonEmptyString,
    enabled: z.boolean(),
    operationId: nonEmptyString.optional(),
    scope: ycodePluginScopeSchema.optional(),
  })
  .strict();
export const ycodePluginsSetEnabledResultSchema = z
  .object({
    plugin: ycodePluginInfoSchema,
    enabled: z.boolean(),
  })
  .strict();
export type YCodePluginsSetEnabledResult = z.infer<typeof ycodePluginsSetEnabledResultSchema>;

// 商店信息（Store Listing）：目录条目携带的展示性元数据（显示名/icon/分类/作者/链接/hero/
// 示例提示词），全部可选，UI 缺失时按降级矩阵处理（字母头像/隐藏区块/省略信息行）。
// i18n 采用 `<字段>I18n` map，locale 解析复用 shared 的 plugin-display-name helper。
export const ycodePluginStoreListingSchema = z
  .object({
    displayName: z.string().optional(),
    displayNameI18n: z.record(z.string(), z.string()).optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    author: z.string().optional(),
    authorUrl: z.string().optional(),
    homepage: z.string().optional(),
    privacyPolicy: z.string().optional(),
    termsOfService: z.string().optional(),
    heroImage: z.string().optional(),
    examplePrompts: z.array(z.string()).optional(),
    examplePromptsI18n: z.record(z.string(), z.array(z.string())).optional(),
    /**
     * 需要付费套餐才好用的插件：市场目录条目声明 `requiresPaidPlan: true`，
     * UI 在标题右侧展示提示图标。描述的是「使用条件」而非「插件是收费商品」——
     * 不参与安装门禁与计费，命名也不绑定具体套餐商品名。
     */
    requiresPaidPlan: z.boolean().optional(),
  })
  .strict();
export type YCodePluginStoreListing = z.infer<typeof ycodePluginStoreListingSchema>;

export const ycodePluginsResolveSuggestedReferenceResultSchema = z
  .object({
    stableId: nonEmptyString,
    status: ycodePluginSuggestedReferenceStatusSchema,
    marketplace: nonEmptyString.optional(),
    pluginName: nonEmptyString.optional(),
    sourceTrust: z.literal("official").optional(),
    // 官方 Marketplace listing 的可选展示投影；不参与身份、安装或权限判断。
    icon: z.string().optional(),
    listing: ycodePluginStoreListingSchema.optional(),
    diagnostics: z.array(ycodePluginDiagnosticSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "ready" && value.status !== "disabled" && value.status !== "missing") {
      return;
    }
    if (!value.marketplace || !value.pluginName || value.sourceTrust !== "official") {
      context.addIssue({
        code: "custom",
        message: "actionable suggested Plugin results require trusted install identity",
      });
    }
  });
export type YCodePluginsResolveSuggestedReferenceResult = z.infer<
  typeof ycodePluginsResolveSuggestedReferenceResultSchema
>;

export const ycodePluginMarketplaceSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    source: jsonObjectSchema,
    description: z.string().optional(),
    lastUpdated: z.string().optional(),
    pluginCount: z.number().int().nonnegative(),
    isOfficial: z.boolean().optional(),
    // 目录顶层 featured 策展名单（商店「公开」分段 Featured 区）。
    featured: z.array(z.string()).optional(),
    refreshFailure: z
      .object({
        code: z.string(),
        failedAt: z.string(),
        message: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodePluginMarketplaceSummary = z.infer<typeof ycodePluginMarketplaceSummarySchema>;

export const ycodeAvailablePluginSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    installed: z.boolean(),
    componentTypes: z.array(z.string()).optional(),
    listing: ycodePluginStoreListingSchema.optional(),
  })
  .strict();
export type YCodeAvailablePluginSummary = z.infer<typeof ycodeAvailablePluginSummarySchema>;

export const ycodeInstalledPluginSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    enabled: z.boolean(),
    scope: ycodePluginScopeSchema,
    installPath: z.string().optional(),
    installedAt: z.string().optional(),
    componentTypes: z.array(z.string()).optional(),
    hookDetails: z.array(ycodePluginHookDetailSchema).optional(),
    updateStatus: z.enum(["none", "update-available", "version-changed"]).optional(),
    latestVersion: z.string().optional(),
    listing: ycodePluginStoreListingSchema.optional(),
  })
  .strict();
export type YCodeInstalledPluginSummary = z.infer<typeof ycodeInstalledPluginSummarySchema>;

export const ycodePluginsOverviewParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    configScope: ycodePluginScopeSchema.optional(),
  })
  .strict();
export const ycodePluginsOverviewResultSchema = z
  .object({
    marketplaces: z.array(ycodePluginMarketplaceSummarySchema),
    availablePlugins: z.array(ycodeAvailablePluginSummarySchema),
    installedPlugins: z.array(ycodeInstalledPluginSummarySchema),
    restorableBuiltins: z.array(ycodeAvailablePluginSummarySchema),
    diagnostics: z.array(ycodePluginDiagnosticSchema),
    capability: z
      .object({
        supported: z.boolean(),
        reason: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type YCodePluginsOverviewResult = z.infer<typeof ycodePluginsOverviewResultSchema>;

export const ycodePluginsMarketplaceAddParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    source: nonEmptyString,
    dryRun: z.boolean().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const ycodePluginsMarketplaceRemoveParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    marketplace: nonEmptyString,
  })
  .strict();
export const ycodePluginsMarketplaceUpdateParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    marketplace: nonEmptyString.optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const ycodePluginsMarketplaceMutationResultSchema = z
  .object({
    marketplace: ycodePluginMarketplaceSummarySchema.optional(),
    marketplaces: z.array(ycodePluginMarketplaceSummarySchema).optional(),
    diagnostics: z.array(ycodePluginDiagnosticSchema).optional(),
  })
  .strict();
export type YCodePluginsMarketplaceMutationResult = z.infer<
  typeof ycodePluginsMarketplaceMutationResultSchema
>;

export const ycodePluginsInstallParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginName: nonEmptyString,
    marketplace: nonEmptyString,
    scope: ycodePluginScopeSchema.optional(),
    dryRun: z.boolean().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const ycodePluginsCancelOperationParamsSchema = z
  .object({
    operationId: nonEmptyString,
  })
  .strict();
export type YCodePluginsCancelOperationParams = z.infer<
  typeof ycodePluginsCancelOperationParamsSchema
>;

export const ycodePluginsCancelOperationResultSchema = z
  .object({
    operationId: nonEmptyString,
    cancelled: z.boolean(),
  })
  .strict();
export type YCodePluginsCancelOperationResult = z.infer<
  typeof ycodePluginsCancelOperationResultSchema
>;
export const ycodePluginsUninstallParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginId: nonEmptyString.optional(),
    pluginName: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
    removeCache: z.boolean().optional(),
  })
  .strict();
export const ycodePluginsInstallResultSchema = z
  .object({
    installedPlugins: z.array(ycodeInstalledPluginSummarySchema),
    dependencyClosure: z.array(z.string()),
    diagnostics: z.array(ycodePluginDiagnosticSchema),
  })
  .strict();
export type YCodePluginsInstallResult = z.infer<typeof ycodePluginsInstallResultSchema>;

export const ycodePluginsUninstallResultSchema = z
  .object({
    removedPlugin: ycodeInstalledPluginSummarySchema.optional(),
    diagnostics: z.array(ycodePluginDiagnosticSchema),
  })
  .strict();
export type YCodePluginsUninstallResult = z.infer<typeof ycodePluginsUninstallResultSchema>;

export const ycodePluginsUpdateParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginId: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
  })
  .strict();
export const ycodePluginsRestoreBuiltinParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginId: nonEmptyString,
  })
  .strict();
export const ycodePluginsRestoreBuiltinResultSchema = z
  .object({
    pluginId: nonEmptyString,
    diagnostics: z.array(ycodePluginDiagnosticSchema),
  })
  .strict();
export type YCodePluginsRestoreBuiltinResult = z.infer<
  typeof ycodePluginsRestoreBuiltinResultSchema
>;

export const ycodePluginsConfigureParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginId: nonEmptyString,
    options: jsonObjectSchema,
    clearOptionKeys: z.array(nonEmptyString).optional(),
    scope: ycodePluginScopeSchema.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
export const ycodePluginsConfigureResultSchema = z
  .object({
    pluginId: nonEmptyString,
    diagnostics: z.array(ycodePluginDiagnosticSchema),
  })
  .strict();
export type YCodePluginsConfigureResult = z.infer<typeof ycodePluginsConfigureResultSchema>;

export const ycodePluginsResetConfigParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginId: nonEmptyString,
    scope: ycodePluginScopeSchema.optional(),
  })
  .strict();
export type YCodePluginsResetConfigParams = z.infer<typeof ycodePluginsResetConfigParamsSchema>;

export const ycodePluginsValidateParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginName: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
    source: nonEmptyString.optional(),
  })
  .strict();
export const ycodePluginsValidateResultSchema = z
  .object({
    ok: z.boolean(),
    diagnostics: z.array(ycodePluginDiagnosticSchema),
    compatibility: z
      .object({
        runnable: z.array(z.string()),
        diagnosticOnly: z.array(z.string()),
        unsupported: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type YCodePluginsValidateResult = z.infer<typeof ycodePluginsValidateResultSchema>;

// plugins/describe：按需枚举单个插件的组件「名称 + 描述」。
// 已安装插件读本地缓存目录；未安装候选按需解析/临时 clone 源后枚举再清理。
export const ycodePluginsDescribeParamsSchema = z
  .object({
    workspace: ycodeWorkspaceRefSchema,
    pluginName: nonEmptyString,
    marketplace: nonEmptyString,
  })
  .strict();
export const ycodePluginsDescribeResultSchema = z
  .object({
    components: z.array(ycodePluginComponentGroupSchema),
    diagnostics: z.array(ycodePluginDiagnosticSchema).optional(),
    // 插件包内 plugin.json 的展示性回退字段；未安装候选详情页信息区在商店 listing 缺失时兜底。
    metadata: z
      .object({
        author: z.string().optional(),
        authorUrl: z.string().optional(),
        homepage: z.string().optional(),
        version: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type YCodePluginsDescribeResult = z.infer<typeof ycodePluginsDescribeResultSchema>;

export const ycodeAutomationScheduleRuleSchema = z
  .object({
    unit: z.enum(["minute", "hourly", "daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().positive(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    anchorAt: z.number().int(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    monthDays: z.array(z.number().int().min(1).max(31)).optional(),
    /** yearly 用：1-12 人类月份。缺省回退 anchorAt 的月份（兼容未写该字段的旧记录）。 */
    months: z.array(z.number().int().min(1).max(12)).optional(),
    monthlyMode: z.enum(["date", "weekday"]).optional(),
  })
  .strict();
export type YCodeAutomationScheduleRuleProtocol = z.infer<typeof ycodeAutomationScheduleRuleSchema>;

/** 会话侧长间隔周期 carrier 的 unit 枚举（与 scheduleRule.unit 同集）。 */
export const ycodeAutomationIntervalUnitSchema = z.enum([
  "minute",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const ycodeAutomationProtocolSchema = z
  .object({
    automationId: nonEmptyString,
    title: z.string(),
    cronExpr: nonEmptyString,
    prompt: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    mode: ycodeTaskModeSchema.optional(),
    targetTaskId: nonEmptyString.optional(),
    enabled: z.boolean(),
    lifecycleStatus: z.enum(["active", "completed", "failed", "paused"]),
    nextRunAt: timestampMsSchema.optional(),
    lastRunAt: timestampMsSchema.optional(),
    runCount: z.number().int().nonnegative(),
    recurring: z.boolean(),
    maxRuns: z.number().int().positive().optional(),
    // 自定义重复规则；缺省时调度回退到解析 cronExpr。会话卡片必须读到本字段才能展示
    // cron 无法表达的真实间隔（如每50小时、每40天，兼容 cronExpr 只是 0 * * * *）。
    scheduleRule: ycodeAutomationScheduleRuleSchema.optional(),
  })
  .strict();
export type YCodeAutomationProtocol = z.infer<typeof ycodeAutomationProtocolSchema>;

export const ycodeAutomationCreateParamsSchema = z
  .object({
    title: z.string().optional(),
    cronExpr: nonEmptyString,
    relativeDelayMinutes: z.number().int().positive().max(525_600).optional(),
    prompt: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    mode: ycodeTaskModeSchema.optional(),
    targetTaskId: nonEmptyString.optional(),
    recurring: z.boolean().optional(),
    maxRuns: z.number().int().positive().optional(),
    // 会话侧自定义重复 carrier：每 N 分钟/小时/天/周/月/年均通过此字段归一化为权威 scheduleRule，
    // cronExpr 仅作合法兼容展示。
    intervalUnit: ycodeAutomationIntervalUnitSchema.optional(),
    interval: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  // intervalUnit 与 interval 必须配对提交（只传一个无法确定真实间隔）。
  .refine((input) => (input.intervalUnit === undefined) === (input.interval === undefined), {
    message: "intervalUnit and interval must be set together",
    path: ["interval"],
  })
  // 周期 carrier 与一次性相对延迟语义冲突，禁止同传。
  .refine((input) => input.intervalUnit === undefined || input.relativeDelayMinutes === undefined, {
    message: "intervalUnit cannot combine with a relative delayMinutes",
    path: ["intervalUnit"],
  })
  .refine((input) => input.intervalUnit === undefined || input.recurring !== false, {
    message: "intervalUnit is a recurring carrier and cannot combine with recurring=false",
    path: ["recurring"],
  })
  .refine((input) => input.intervalUnit === undefined || input.maxRuns === undefined, {
    message: "intervalUnit is a recurring carrier and cannot combine with maxRuns",
    path: ["maxRuns"],
  });
export type YCodeAutomationCreateProtocolParams = z.infer<typeof ycodeAutomationCreateParamsSchema>;

export const ycodeAutomationCreateResultSchema = z
  .object({ automation: ycodeAutomationProtocolSchema })
  .strict();
export type YCodeAutomationCreateProtocolResult = z.infer<typeof ycodeAutomationCreateResultSchema>;

export const ycodeAutomationUpdateParamsSchema = z
  .object({
    automationId: nonEmptyString,
    title: nonEmptyString.optional(),
    cronExpr: nonEmptyString.optional(),
    prompt: nonEmptyString.optional(),
    recurring: z.boolean().optional(),
    maxRuns: z.number().int().positive().nullable().optional(),
    // 会话侧自定义重复 carrier（同 create 侧语义）。
    intervalUnit: ycodeAutomationIntervalUnitSchema.optional(),
    interval: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.cronExpr !== undefined ||
      input.prompt !== undefined ||
      input.recurring !== undefined ||
      input.maxRuns !== undefined ||
      input.intervalUnit !== undefined,
    { message: "automation update requires at least one field" },
  )
  .refine((input) => input.maxRuns !== null || input.recurring === true, {
    message: "clearing maxRuns requires recurring=true",
    path: ["maxRuns"],
  })
  .refine((input) => input.recurring !== true || typeof input.maxRuns !== "number", {
    message: "recurring=true cannot be combined with a numeric maxRuns",
    path: ["maxRuns"],
  })
  // intervalUnit 与 interval 必须配对提交（同 create 侧语义）。
  .refine((input) => (input.intervalUnit === undefined) === (input.interval === undefined), {
    message: "intervalUnit and interval must be set together",
    path: ["interval"],
  })
  .refine((input) => input.intervalUnit === undefined || input.recurring !== false, {
    message: "intervalUnit is a recurring carrier and cannot combine with recurring=false",
    path: ["recurring"],
  })
  .refine(
    (input) =>
      input.intervalUnit === undefined ||
      input.maxRuns === undefined ||
      (input.maxRuns === null && input.recurring === true),
    {
      message:
        "intervalUnit is a recurring carrier and only allows maxRuns=null with recurring=true",
      path: ["maxRuns"],
    },
  );
export type YCodeAutomationUpdateProtocolParams = z.infer<typeof ycodeAutomationUpdateParamsSchema>;
export const ycodeAutomationUpdateResultSchema = z
  .object({ automation: ycodeAutomationProtocolSchema })
  .strict();
export type YCodeAutomationUpdateProtocolResult = z.infer<typeof ycodeAutomationUpdateResultSchema>;

export const ycodeAutomationListParamsSchema = z.object({}).strict();
export type YCodeAutomationListProtocolParams = z.infer<typeof ycodeAutomationListParamsSchema>;
export const ycodeAutomationListResultSchema = z
  .object({ automations: z.array(ycodeAutomationProtocolSchema) })
  .strict();
export type YCodeAutomationListProtocolResult = z.infer<typeof ycodeAutomationListResultSchema>;

export const ycodeAutomationCheckTaskBindingParamsSchema = z
  .object({ targetTaskId: nonEmptyString })
  .strict();
export type YCodeAutomationCheckTaskBindingProtocolParams = z.infer<
  typeof ycodeAutomationCheckTaskBindingParamsSchema
>;
export const ycodeAutomationCheckTaskBindingResultSchema = z
  .object({ bound: z.boolean() })
  .strict();
export type YCodeAutomationCheckTaskBindingProtocolResult = z.infer<
  typeof ycodeAutomationCheckTaskBindingResultSchema
>;

export const ycodeAutomationDeleteParamsSchema = z
  .object({ automationId: nonEmptyString })
  .strict();
export type YCodeAutomationDeleteProtocolParams = z.infer<typeof ycodeAutomationDeleteParamsSchema>;
export const ycodeAutomationDeleteResultSchema = z.object({ deleted: z.boolean() }).strict();
export type YCodeAutomationDeleteProtocolResult = z.infer<typeof ycodeAutomationDeleteResultSchema>;

export const ycodeProtocolMethods = {
  runtimeCapabilities: "runtime/capabilities",
  computerUseOperationEvent: "computer-use/operation-event",
  sessionCreate: "session/create",
  sessionResume: "session/resume",
  sessionList: "session/list",
  sessionSubagents: "session/subagents",
  sessionRequestRuntimePreferences: "session/requestRuntimePreferences",
  sessionRead: "session/read",
  sessionMessages: "session/messages",
  sessionEvents: "session/events",
  sessionDebug: "session/debug",
  sessionSubscribe: "session/subscribe",
  // @deprecated（部分）：send 主路径已收敛 v4 sendText；仅剩 adapter 附件
  // 回退分支消费（v4 attachmentRef 上传/寄存命令面未建模），待附件命令面落地后移除。
  sessionSend: "session/send",
  // @deprecated：host 客户端方法已删（stop 已收敛 v4 stop 命令）。
  // wire case 留兼容（transport bypass 名单仍引用），随旧词整体删除时一并移除。
  sessionStop: "session/stop",
  // @deprecated：host 客户端方法已删（已收敛 v4 cancelBackgroundWork 命令）。
  // wire case 留兼容，随旧词整体删除时一并移除。
  sessionCancelBackgroundTask: "session/cancelBackgroundTask",
  // @deprecated：host 客户端方法已删（v4 forkAssistant 原生 handler 经
  // forkSessionAtMessage 钩子直调 server-operations.forkSession op）。wire case 与
  // fork params/result schema 保留＝op 存活面；fork record 归 v4 原生重写。
  sessionFork: "session/fork",
  sessionCompact: "session/compact",
  sessionGoal: "session/goal",
  sessionClose: "session/close",
  // setModel 仍被 ycodeSessionService 的 desktop 旧链路消费；replayable
  // switchModelConfig 已直接由目标 Environment Registry 解析 Selection。
  sessionSetModel: "session/setModel",
  // replayable facade 的思考深度/模式已收敛 v4 switchModelConfig/
  // switchCollaborationMode；剩余消费 = ycodeSessionService（desktop 旧链路，随
  // 桌面 v4 UI 收口清零）与 setMode 的 auto 值残留（v4 值域刻意排除 auto）。
  sessionSetThoughtLevel: "session/setThoughtLevel",
  sessionSetMode: "session/setMode",
  workspaceReadPresentation: "workspace/readPresentation",
  workspaceHookTrustGrant: "workspace/hooks/trustGrant",
  // 进程级 Account Provider Config 与 workspace 运行目录分离。
  providerUpdateAccountConfig: "provider/updateAccountConfig",
  workspaceUpdateInteractionPreferences: "workspace/updateInteractionPreferences",
  workspaceUpdateModelIoPreferences: "workspace/updateModelIoPreferences",
  // 动态工作流灰度门禁：workspace 级事实，由 host 在 agent 就绪时同步；旧 CLI method-not-found → host 降级忽略。
  workspaceUpdateDynamicWorkflowPolicy: "workspace/updateDynamicWorkflowPolicy",
  // LLM 执行面在 CLI，直连不可行；消费仅 services 内部
  // （commit message），待 v4 workspace 查询/命令面覆盖后移除。
  workspaceGenerateText: "workspace/generateText",
  workspaceCancelGenerateText: "workspace/cancelGenerateText",
  providerTestModelConnectivity: "provider/testModelConnectivity",
  mcpList: "mcp/list",
  // MCP Apps 宿主 RPC（prepare / 工具 / 资源 / 实例信箱）。归属 = workspace + sessionId；
  // renderer 不接触 HTML 与 MCP client，只拿登记载荷与实例凭证。
  mcpUi: "mcp/ui",
  pluginsList: "plugins/list",
  pluginsReferenceCatalog: "plugins/referenceCatalog",
  pluginsReferenceCatalogWithCategory: "plugins/referenceCatalogWithCategory",
  skillsReferenceCatalog: "skills/referenceCatalog",
  // 已保存工作流的 GUI 中枢：workspace 级、无会话。
  workflowsList: "workflows/list",
  workflowsGet: "workflows/get",
  workflowsUpdateMeta: "workflows/updateMeta",
  workflowsDelete: "workflows/delete",
  workflowsRuns: "workflows/runs",
  // 在项目档 / 全局档之间移动同名文件。
  workflowsMove: "workflows/move",
  pluginsResolveSuggestedReference: "plugins/resolveSuggestedReference",
  pluginsSetEnabled: "plugins/setEnabled",
  pluginsOverview: "plugins/overview",
  pluginsMarketplaceAdd: "plugins/marketplace/add",
  pluginsMarketplaceRemove: "plugins/marketplace/remove",
  pluginsMarketplaceUpdate: "plugins/marketplace/update",
  pluginsInstall: "plugins/install",
  pluginsCancelOperation: "plugins/cancelOperation",
  pluginsUninstall: "plugins/uninstall",
  pluginsUpdate: "plugins/update",
  pluginsRestoreBuiltin: "plugins/restoreBuiltin",
  pluginsConfigure: "plugins/configure",
  pluginsResetConfig: "plugins/resetConfig",
  pluginsValidate: "plugins/validate",
  pluginsDescribe: "plugins/describe",
  automationCreate: "automation/create",
  automationUpdate: "automation/update",
  automationCheckTaskBinding: "automation/checkTaskBinding",
  automationList: "automation/list",
  automationDelete: "automation/delete",
  // @deprecated：host 消费已清零（ycodeAgentService 改走 v4/usage/stats）。
  // 仅剩 CLI server 的 wire 兼容 case；随旧词整体删除时一并移除。
  usageStats: "usage/stats",
  // YCode Protocol 对 agent 只暴露 session-first 方法；task 是 UI 投影概念，不能泄露进协议方法名。
  // @deprecated：host 已改走 v4/conversation/usage；后续与 usage/stats 一并移除。
  sessionUsage: "session/usage",
  // 资源管理器：CLI 回报其 MCP 子进程 pid 与插件归属（纯内存，无 I/O），采样在 Host 侧完成。
  processChildProcesses: "process/childProcesses",
  interactionRequestPermission: "interaction/requestPermission",
  interactionRequestUserInput: "interaction/requestUserInput",
  interactionRequestProviderRuntimeHeaders: "interaction/requestProviderRuntimeHeaders",
  // browser-use 反向请求由 agent 发起，host 转给 main 中的 CDP executor。
  interactionBrowserList: "interaction/browserList",
  interactionBrowserExecute: "interaction/browserExecute",
} as const;

export type YCodeProtocolMethod = (typeof ycodeProtocolMethods)[keyof typeof ycodeProtocolMethods];

export const ycodeProtocolEmptyResultSchema = z.object({}).strict();

// 最新 V4 主链已不再依赖旧版全量方法表；这里仅保留仍被兼容测试和 browser broker
// 消费的最小契约集合，避免重新引入已移除的 legacy 方法。
export const ycodeProtocolSessionMethodContracts = {
  [ycodeProtocolMethods.workspaceHookTrustGrant]: {
    params: ycodeWorkspaceHookTrustGrantParamsSchema,
    result: ycodeWorkspaceHookTrustGrantResultSchema,
  },
  [ycodeProtocolMethods.mcpList]: {
    params: ycodeMcpListParamsSchema,
    result: ycodeMcpListResultSchema,
  },
  [ycodeProtocolMethods.interactionBrowserList]: {
    params: ycodeBrowserListParamsSchema,
    result: ycodeBrowserListResultSchema,
  },
  [ycodeProtocolMethods.interactionBrowserExecute]: {
    params: ycodeBrowserExecuteParamsSchema,
    result: ycodeBrowserExecuteResultSchema,
  },
} as const satisfies Partial<
  Record<YCodeProtocolMethod, { params: z.ZodTypeAny; result: z.ZodTypeAny }>
>;

export type YCodeProtocolSessionMethodContract =
  (typeof ycodeProtocolSessionMethodContracts)[keyof typeof ycodeProtocolSessionMethodContracts];

/** 仅存储准备子进程的私有控制帧，原始路径不进入业务事件或遥测。 */
export const ycodeStoragePreparationFrameSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("startup/storagePath"),
      params: z.object({ path: z.string().min(1).max(32768) }).strict(),
    })
    .strict(),
  z
    .object({ method: z.literal("startup/storagePrepared"), params: z.object({}).strict() })
    .strict(),
  z
    .object({ method: z.literal("startup/storageState"), params: ycodeStorageStartupStateSchema })
    .strict(),
]);
export const ycodeStoragePathReadySchema = z
  .object({ method: z.literal("startup/storagePathReady"), reuse: z.boolean().optional() })
  .strict();
export * from "../ycode-protocol-v4/session-storage.js";
