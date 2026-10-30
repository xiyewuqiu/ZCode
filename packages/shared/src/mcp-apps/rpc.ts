import { z } from "zod";
import { ycodeWorkspaceRefSchema } from "../ycode-protocol-legacy-types.js";
import { mcpAppsAppToolCallResultSchema, mcpAppsAppToolDescriptorSchema } from "./appTools.js";
import {
  MCP_APPS_HTML_MAX_BYTES,
  MCP_APPS_RESOURCE_PERMISSIONS,
  MCP_APPS_RESOURCE_URI_MAX_CHARS,
} from "./contract.js";
import type { PluginSandboxRegisterInput } from "./contract.js";
import { mcpAppInstanceSchema } from "./instance.js";
import {
  mcpAppCspRelaxationsSchema,
  mcpAppsDisplayModeSchema,
  mcpAppsSurfaceIdSchema,
  mcpToolUiCspSchema,
} from "./schemas.js";

/**
 * MCP Apps 宿主 RPC：renderer 只通过 `IPlatformService` + agent service 访问，绝不直连 MCP client。
 * CLI 侧是实例凭证 / 资源校验 / app-tools 信箱的唯一 owner；main 侧只负责沙箱登记。
 *
 * 归属路由贯穿 `workspace`（identity 优先）+ `sessionId`；实例凭证再绑定
 * （session, server, plugin, scopeId, resourceUri, ownerWebContentsId）。任一层不匹配都 fail closed。
 */

/** 协议方法名。与旧 `session/*`、`v4/*` 并存，属当前(V4)协议面。 */
export const MCP_UI_METHOD = "mcp/ui";

/** 一次工具调用的归属范围（不含实例凭证）。 */
export const mcpUiHostScopeSchema = z
  .object({
    /** CLI 用它校验会话归属；`workspaceIdentity` 优先于路径。 */
    workspace: ycodeWorkspaceRefSchema,
    sessionId: z.string().min(1),
    /** 展示 / 日志用；归属真相是 serverName + sessionId。 */
    pluginId: z.string().min(1).max(256),
    serverName: z.string().min(1).max(512),
    /** `buildPluginSandboxScopeId` 的结果：`tool:<id>` / `surface:<id>`。 */
    scopeId: z.string().min(1).max(512),
  })
  .strict();
export type McpUiHostScope = z.infer<typeof mcpUiHostScopeSchema>;

/** 已签发实例凭证后的归属范围。 */
export const mcpUiInstanceScopeSchema = mcpUiHostScopeSchema
  .extend({ instance: mcpAppInstanceSchema })
  .strict();
export type McpUiInstanceScope = z.infer<typeof mcpUiInstanceScopeSchema>;

export const mcpUiPrepareParamsSchema = mcpUiHostScopeSchema
  .extend({
    op: z.literal("prepare"),
    resourceUri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
    toolName: z.string().min(1).max(512),
    /** 发起请求的宿主窗口 webContents id；main 在 IPC 侧仍会用真实 sender 覆盖。 */
    ownerWebContentsId: z.number().int().nonnegative(),
    csp: mcpToolUiCspSchema.optional(),
    cspRelaxations: mcpAppCspRelaxationsSchema.optional(),
    prefersBorder: z.boolean().optional(),
    preferredDisplayMode: mcpAppsDisplayModeSchema.optional(),
    surface: mcpAppsSurfaceIdSchema.optional(),
  })
  .strict();
export type McpUiPrepareParams = z.infer<typeof mcpUiPrepareParamsSchema>;

export const mcpUiCallToolParamsSchema = mcpUiInstanceScopeSchema
  .extend({
    op: z.literal("callTool"),
    toolName: z.string().min(1).max(512),
    arguments: z.record(z.string(), z.unknown()).optional(),
    /** 宿主生成；同一实例内去重。 */
    callId: z.string().min(1).max(128),
  })
  .strict();
export type McpUiCallToolParams = z.infer<typeof mcpUiCallToolParamsSchema>;

export const mcpUiCancelToolCallParamsSchema = mcpUiInstanceScopeSchema
  .extend({ op: z.literal("cancelToolCall"), callId: z.string().min(1).max(128) })
  .strict();

export const mcpUiValidateParamsSchema = mcpUiInstanceScopeSchema
  .extend({ op: z.literal("validate") })
  .strict();

export const mcpUiCloseParamsSchema = mcpUiInstanceScopeSchema
  .extend({ op: z.literal("close") })
  .strict();

export const mcpUiReadResourceParamsSchema = mcpUiInstanceScopeSchema
  .extend({
    op: z.literal("readResource"),
    uri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
  })
  .strict();

export const mcpUiRegisterAppToolsParamsSchema = mcpUiInstanceScopeSchema
  .extend({
    op: z.literal("registerAppTools"),
    tools: z.array(mcpAppsAppToolDescriptorSchema).max(50),
  })
  .strict();

export const mcpUiUnregisterAppToolsParamsSchema = mcpUiInstanceScopeSchema
  .extend({ op: z.literal("unregisterAppTools") })
  .strict();

export const mcpUiAppToolCallParamsSchema = mcpUiInstanceScopeSchema
  .extend({
    op: z.enum(["claimAppToolCall", "resolveAppToolCall"]),
    callId: z.string().min(1).max(128),
    result: mcpAppsAppToolCallResultSchema.optional(),
    error: z.object({ message: z.string().max(4096) }).strict().optional(),
  })
  .strict();
export type McpUiAppToolCallParams = z.infer<typeof mcpUiAppToolCallParamsSchema>;

/** renderer → CLI 的完整请求面。 */
export const mcpUiHostRequestSchema = z.discriminatedUnion("op", [
  mcpUiPrepareParamsSchema,
  mcpUiValidateParamsSchema,
  mcpUiCloseParamsSchema,
  mcpUiCallToolParamsSchema,
  mcpUiCancelToolCallParamsSchema,
  mcpUiReadResourceParamsSchema,
  mcpUiRegisterAppToolsParamsSchema,
  mcpUiUnregisterAppToolsParamsSchema,
  mcpUiAppToolCallParamsSchema,
]);
export type McpUiHostRequest = z.infer<typeof mcpUiHostRequestSchema>;
export type McpUiHostRequestOp = McpUiHostRequest["op"];

/**
 * renderer / services 侧使用的请求体：`workspace` 由 services 按目标连接补齐
 * （identity 优先、保留本地路径 fallback），UI 不手写 workspaceKey / 远程身份。
 */
type WithoutWorkspace<T> = T extends unknown ? Omit<T, "workspace"> : never;
export type McpUiHostRequestBody = WithoutWorkspace<McpUiHostRequest>;

/**
 * 准备结果里的沙箱登记载荷：CLI 已完成资源读取 / mime / 16 MiB / 权限 / CSP 合并，
 * renderer 只把它交给 `IPlatformService.pluginSandbox.registerSandbox`。
 */
export const mcpUiSandboxRegisterSchema = z
  .object({
    instance: mcpAppInstanceSchema,
    workspacePath: z.string().min(1).optional(),
    workspaceIdentity: z.string().min(1).optional(),
    ownerWebContentsId: z.number().int().nonnegative(),
    sessionId: z.string().min(1),
    pluginId: z.string().min(1).optional(),
    serverName: z.string().min(1).max(512).optional(),
    scopeId: z.string().min(1).max(512),
    html: z.string().min(1).max(MCP_APPS_HTML_MAX_BYTES),
    csp: mcpToolUiCspSchema.optional(),
    cspRelaxations: mcpAppCspRelaxationsSchema.optional(),
    permissions: z.enum(MCP_APPS_RESOURCE_PERMISSIONS).array().optional(),
    prefersBorder: z.boolean().optional(),
    heightHint: z.number().int().nonnegative().optional(),
    minFrameHeight: z.number().int().nonnegative().optional(),
    showInline: z.boolean().optional(),
  })
  .strict();
type AssertAssignable<T extends U, U> = T;
/** 编译期校验：RPC 载荷必须与 main / preload 的登记输入同形。 */
export type McpUiSandboxRegister = AssertAssignable<
  z.infer<typeof mcpUiSandboxRegisterSchema>,
  PluginSandboxRegisterInput
>;

export const mcpUiResourceContentSchema = z
  .object({
    uri: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
  })
  .strict();

/** 结果面：每个结果都回显 `op`，供两端做严格配对校验。 */
export const mcpUiPrepareResultSchema = z
  .object({
    op: z.literal("prepare"),
    instance: mcpAppInstanceSchema,
    register: mcpUiSandboxRegisterSchema,
  })
  .strict();
export type McpUiPrepareResult = z.infer<typeof mcpUiPrepareResultSchema>;

export const mcpUiCallToolResultSchema = z
  .object({ op: z.literal("callTool"), result: mcpAppsAppToolCallResultSchema })
  .strict();

export const mcpUiReadResourceResultSchema = z
  .object({
    op: z.literal("readResource"),
    result: z.object({ contents: z.array(mcpUiResourceContentSchema) }).strict(),
  })
  .strict();

export const mcpUiCancelToolCallResultSchema = z
  .object({ op: z.literal("cancelToolCall"), cancelled: z.boolean() })
  .strict();

export const mcpUiSideEffectResultSchema = z
  .object({ op: z.enum(["validate", "close", "registerAppTools", "unregisterAppTools"]), ok: z.literal(true) })
  .strict();

export const mcpUiAppToolCallResultAckSchema = z
  .object({
    op: z.enum(["claimAppToolCall", "resolveAppToolCall"]),
    accepted: z.boolean(),
  })
  .strict();

export const mcpUiHostResponseSchema = z.discriminatedUnion("op", [
  mcpUiPrepareResultSchema,
  mcpUiCallToolResultSchema,
  mcpUiReadResourceResultSchema,
  mcpUiCancelToolCallResultSchema,
  mcpUiSideEffectResultSchema,
  mcpUiAppToolCallResultAckSchema,
]);
export type McpUiHostResponse = z.infer<typeof mcpUiHostResponseSchema>;

/**
 * CLI → host 的 app-tools 投递通知：模型调用进入信箱后立即下发，renderer 按
 * (sessionId, scopeId, instance.token) 过滤，只让唯一页面实例 claim。
 */
export const MCP_UI_APP_TOOL_CALL_NOTIFICATION = "mcp/ui/appToolCall";
export const mcpUiAppToolCallNotificationSchema = z
  .object({
    sessionId: z.string().min(1),
    scopeId: z.string().min(1).max(512),
    instance: mcpAppInstanceSchema,
    call: z
      .object({
        activity: z.boolean().optional(),
        cancelled: z.boolean().optional(),
        callId: z.string().min(1).max(128),
        toolName: z.string().min(1).max(128),
        arguments: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type McpUiAppToolCallNotification = z.infer<typeof mcpUiAppToolCallNotificationSchema>;
