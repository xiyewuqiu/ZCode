import { randomUUID } from "node:crypto";
import type { McpAppProvidedToolDefinition, McpAppProvidedToolExecutor } from "@ycode/core";
import {
  MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE,
  MCP_APPS_APP_TOOL_ARGUMENTS_MAX_BYTES,
  MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS,
  MCP_APPS_APP_TOOL_CLAIM_TIMEOUT_MS,
  MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS,
  MCP_APPS_APP_TOOL_RESULT_MAX_BYTES,
  type McpAppInstance,
  type McpAppsAppToolCallRequest,
  type McpAppsAppToolCallResult,
  type McpAppsAppToolDescriptor,
} from "@ycode/shared/mcp-apps";
import type { PluginUiAppToolMailboxEvent, PluginUiAppToolMailboxHandler } from "@ycode/shared/mcp-apps";
import {
  buildMcpUiAppToolDefinitions,
  type McpUiAppToolRetainExecution,
} from "./appToolsDefinitions.js";

/**
 * App-Provided Tools 的实例信箱：页面登记工具后，模型调用按 (scopeId, generation) 投递给唯一实例；
 * 渲染端 claim 后让页面执行 `tools/call`，再经 resolve 回传。只在内存，会话关闭清空。
 * 认领超时 = 页面未运行（不重发）；认领后执行超时 = 页面未回传。
 */

interface InstanceRecord {
  lease: McpAppInstance;
  scopeId: string;
  generation: number;
  serverName: string;
  pluginId: string;
  sessionId: string;
  seq: number;
  tools: McpAppsAppToolDescriptor[];
}

interface PendingCall {
  instance: InstanceRecord;
  toolName: string;
  claimed: boolean;
  settle(outcome: { result: McpAppsAppToolCallResult } | { error: Error }): void;
  cancelTimer: () => void;
}

interface SessionState {
  instances: Map<string, InstanceRecord>;
  pending: Map<string, PendingCall>;
  nextSeq: number;
}

export interface McpUiAppToolMailboxOptions {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => () => void;
  createCallId?: () => string;
  /**
   * 把本会话暴露给模型的 app 工具整体同步到 runtime；返回实际登记的名字。
   * `null` = 会话已不存在（调用方随后清空本会话登记）。
   */
  applyTools?: (
    sessionId: string,
    definitions: readonly McpAppProvidedToolDefinition[],
    execute: McpAppProvidedToolExecutor,
  ) => string[] | null;
  /**
   * 模型侧条目在审批前登记实例生命周期。返回的 signal 随实例撤销 abort，
   * release 幂等；实例已不存在时抛出。
   */
  retainExecution?: McpUiAppToolRetainExecution;
  logger?: {
    info?: (message: string, fields?: Record<string, unknown>) => void;
    warn?: (message: string, fields?: Record<string, unknown>) => void;
    debug?: (message: string, fields?: Record<string, unknown>) => void;
  };
}

const instanceKey = (scopeId: string, generation: number) => `${scopeId}|${generation}`;
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");

export class McpUiAppToolMailbox {
  private readonly sessions = new Map<string, SessionState>();
  private readonly subscribers = new Set<PluginUiAppToolMailboxHandler>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => () => void;
  private readonly createCallId: () => string;
  private readonly applyTools: McpUiAppToolMailboxOptions["applyTools"];
  private readonly retainExecution: McpUiAppToolMailboxOptions["retainExecution"];
  private readonly logger: McpUiAppToolMailboxOptions["logger"];

  constructor(options: McpUiAppToolMailboxOptions = {}) {
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      });
    this.createCallId = options.createCallId ?? randomUUID;
    this.applyTools = options.applyTools;
    this.retainExecution = options.retainExecution;
    this.logger = options.logger;
  }

  subscribe(handler: PluginUiAppToolMailboxHandler): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  register(input: {
    sessionId: string;
    scopeId: string;
    generation: number;
    instance: McpAppInstance;
    serverName: string;
    pluginId: string;
    tools: readonly McpAppsAppToolDescriptor[];
  }): { accepted: number; skipped: number } {
    const session = this.sessionOf(input.sessionId);
    const key = instanceKey(input.scopeId, input.generation);
    // 同一作用域的新代际替换旧代际；旧实例的待执行调用以明确错误结束。
    for (const [existingKey, record] of Array.from(session.instances)) {
      if (existingKey !== key && record.scopeId === input.scopeId) {
        this.dropInstance(session, existingKey, "App page was reloaded");
      }
    }
    const seen = new Set<string>();
    const accepted: McpAppsAppToolDescriptor[] = [];
    let skipped = 0;
    for (const tool of input.tools) {
      if (accepted.length >= MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE) {
        skipped += 1;
        continue;
      }
      if (seen.has(tool.name)) {
        skipped += 1;
        continue;
      }
      seen.add(tool.name);
      accepted.push(tool);
    }
    const existing = session.instances.get(key);
    session.instances.set(key, {
      lease: input.instance,
      scopeId: input.scopeId,
      generation: input.generation,
      serverName: input.serverName,
      pluginId: input.pluginId,
      sessionId: input.sessionId,
      seq: existing?.seq ?? session.nextSeq++,
      tools: accepted,
    });
    this.logger?.info?.("MCP UI app tools registered", {
      event: "mcp.ui.app_tools.registered",
      sessionId: input.sessionId,
      scopeId: input.scopeId,
      toolCount: accepted.length,
      skipped,
    });
    // 页面登记变化立即同步到模型工具表；会话已消失时 sync 会清空本会话登记。
    this.sync(input.sessionId, session);
    return { accepted: accepted.length, skipped };
  }

  unregister(input: {
    sessionId: string;
    scopeId: string;
    generation: number;
    instance: McpAppInstance;
  }): number {
    const session = this.sessions.get(input.sessionId);
    const key = instanceKey(input.scopeId, input.generation);
    const record = session?.instances.get(key);
    if (!session || !record || record.lease.token !== input.instance.token) return 0;
    this.dropInstance(session, key, "App page was closed");
    this.sync(input.sessionId, session);
    return record.tools.length;
  }

  /**
   * 模型侧执行器：把一次调用投递给唯一实例，等待 claim + resolve / 超时 / 取消。
   * 结果只在此处校验大小；页面侧不直接接触模型。
   */
  execute(input: {
    sessionId: string;
    scopeId: string;
    /** 定义所属实例代际；提供时精确匹配，避免投递给同作用域的新页面。 */
    generation?: number;
    toolName: string;
    arguments?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<McpAppsAppToolCallResult> {
    const session = this.sessions.get(input.sessionId);
    const instance = session
      ? input.generation !== undefined
        ? session.instances.get(instanceKey(input.scopeId, input.generation))
        : this.latestForScope(session, input.scopeId)
      : undefined;
    if (!session || !instance) {
      return Promise.reject(new Error("The app page is not running"));
    }
    if (!instance.tools.some((tool) => tool.name === input.toolName)) {
      return Promise.reject(new Error(`App tool ${input.toolName} is not registered`));
    }
    if (jsonBytes(input.arguments ?? {}) > MCP_APPS_APP_TOOL_ARGUMENTS_MAX_BYTES) {
      return Promise.reject(new Error("App tool arguments are too large"));
    }
    if (input.signal?.aborted) {
      return Promise.reject(new Error("App tool call was cancelled"));
    }
    return new Promise<McpAppsAppToolCallResult>((resolve, reject) => {
      const callId = this.createCallId();
      let settled = false;
      const publish = (call: McpAppsAppToolCallRequest) => {
        this.publish({ scopeId: input.scopeId, instance: instance.lease, call });
      };
      const settle = (outcome: { result: McpAppsAppToolCallResult } | { error: Error }) => {
        if (settled) return;
        settled = true;
        pending.cancelTimer();
        input.signal?.removeEventListener("abort", onAbort);
        session.pending.delete(callId);
        if ("result" in outcome) resolve(outcome.result);
        else {
          publish({
            callId,
            toolName: input.toolName,
            arguments: {},
            cancelled: true,
          });
          reject(outcome.error);
        }
      };
      const onAbort = () => settle({ error: new Error("App tool call was cancelled") });
      const pending: PendingCall = {
        instance,
        toolName: input.toolName,
        claimed: false,
        settle,
        // 认领期限：没有渲染端认领视为页面未运行（信箱不重发），结束调用并注销该实例。
        cancelTimer: this.setTimer(() => {
          settle({ error: new Error(`The ${instance.serverName} app page is not running`) });
          const key = instanceKey(instance.scopeId, instance.generation);
          if (session.instances.has(key)) {
            this.dropInstance(session, key, "App page is not running");
            this.sync(input.sessionId, session);
          }
        }, MCP_APPS_APP_TOOL_CLAIM_TIMEOUT_MS),
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      session.pending.set(callId, pending);
      publish({
        callId,
        toolName: input.toolName,
        arguments: input.arguments ?? {},
      });
    });
  }

  claim(input: {
    sessionId: string;
    scopeId: string;
    generation: number;
    callId: string;
  }): { accepted: boolean } {
    const session = this.sessions.get(input.sessionId);
    const pending = session?.pending.get(input.callId);
    if (!session || !pending) return { accepted: false };
    if (
      pending.instance.scopeId !== input.scopeId ||
      pending.instance.generation !== input.generation
    ) {
      return { accepted: false };
    }
    // callId 幂等：同一实例重放认领仍回 true，不重置执行计时。
    if (pending.claimed) return { accepted: true };
    pending.cancelTimer();
    pending.claimed = true;
    pending.cancelTimer = this.setTimer(
      () =>
        pending.settle({
          error: new Error(
            `App tool ${pending.toolName} timed out after ${MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS} ms`,
          ),
        }),
      MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS,
    );
    return { accepted: true };
  }

  resolve(input: {
    sessionId: string;
    scopeId: string;
    generation: number;
    callId: string;
    result?: McpAppsAppToolCallResult;
    error?: { message: string };
  }): { accepted: boolean } {
    const session = this.sessions.get(input.sessionId);
    const pending = session?.pending.get(input.callId);
    if (
      !session ||
      !pending ||
      !pending.claimed ||
      pending.instance.scopeId !== input.scopeId ||
      pending.instance.generation !== input.generation
    ) {
      return { accepted: false };
    }
    if (input.error) {
      const message =
        input.error.message.slice(0, MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS) || "App tool failed";
      pending.settle({ error: new Error(message) });
      return { accepted: true };
    }
    if (!input.result) return { accepted: false };
    if (jsonBytes(input.result) > MCP_APPS_APP_TOOL_RESULT_MAX_BYTES) {
      pending.settle({
        error: new Error(`App tool result exceeds ${MCP_APPS_APP_TOOL_RESULT_MAX_BYTES} bytes`),
      });
      return { accepted: true };
    }
    pending.settle({ result: input.result });
    return { accepted: true };
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    for (const pending of Array.from(session.pending.values())) {
      pending.settle({ error: new Error("Session was closed") });
    }
  }

  clear(): void {
    for (const sessionId of Array.from(this.sessions.keys())) this.closeSession(sessionId);
    this.subscribers.clear();
  }

  size(): number {
    let count = 0;
    for (const session of this.sessions.values()) count += session.instances.size;
    return count;
  }

  private executorFor(sessionId: string): McpAppProvidedToolExecutor {
    return (call, options) =>
      this.execute({
        sessionId,
        scopeId: call.definition.scopeId,
        generation: call.definition.generation,
        toolName: call.definition.toolName,
        arguments: call.arguments,
        signal: options.signal,
      });
  }

  /**
   * 计算暴露集合（同 server 只暴露最近登记的实例）并整体同步到模型工具表。
   * 返回实际被 runtime 接受的工具定义；会话已消失时清空登记。
   */
  private sync(
    sessionId: string,
    session: SessionState,
  ): McpAppProvidedToolDefinition[] {
    const definitions = buildMcpUiAppToolDefinitions(
      session.instances.values(),
      this.retainExecution,
    );
    const applied = this.applyTools
      ? this.applyTools(sessionId, definitions, this.executorFor(sessionId))
      : definitions.map((definition) => definition.modelName);
    if (applied === null) {
      this.closeSession(sessionId);
      return [];
    }
    const appliedNames = new Set(applied);
    return definitions.filter((definition) => appliedNames.has(definition.modelName));
  }

  private sessionOf(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { instances: new Map(), pending: new Map(), nextSeq: 1 };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private latestForScope(session: SessionState, scopeId: string): InstanceRecord | undefined {
    let latest: InstanceRecord | undefined;
    for (const record of session.instances.values()) {
      if (record.scopeId !== scopeId) continue;
      if (!latest || record.seq > latest.seq) latest = record;
    }
    return latest;
  }

  private dropInstance(session: SessionState, key: string, reason: string): void {
    const record = session.instances.get(key);
    session.instances.delete(key);
    for (const pending of Array.from(session.pending.values())) {
      if (pending.instance === record) pending.settle({ error: new Error(reason) });
    }
    this.logger?.debug?.("MCP UI app tool instance dropped", { reason });
  }

  private publish(event: PluginUiAppToolMailboxEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        this.logger?.warn?.("MCP UI app tool mailbox subscriber failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
