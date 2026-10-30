import { createHash, randomUUID } from "node:crypto";
import type { McpAppInstance } from "@ycode/shared/mcp-apps";

/**
 * 实例凭证登记表：agent 签发的内存凭证与沙箱归属的唯一 owner。
 * 撤销先从登记表移除再 abort；迟到的 UI 请求拿不到记录，无法重新获得执行权。
 * 不持久化：进程重启后页面必须重新握手，宿主重新 prepare。
 */
export interface McpUiInstanceBinding {
  /** 身份 key：`workspaceIdentity?.trim() || workspacePath`。 */
  workspace: string;
  accountContext?: string;
  sessionId: string;
  pluginId: string;
  serverName: string;
  scopeId: string;
  resourceUri: string;
  ownerWebContentsId: number;
}

export interface McpUiInstanceSource {
  identity: string;
  generation: number;
}

export interface McpUiInstanceRecord {
  lease: McpAppInstance;
  binding: McpUiInstanceBinding;
  source: McpUiInstanceSource | null;
  cancel: AbortController;
  pins: Set<string>;
  /** 滑动过期时间：每次成功 validate / retain 顺延；到点即撤销。 */
  expiresAt: number;
}

/** 凭证空闲有效期缺省 30 分钟：卡片重挂载会重新 validate，长会话不会因绝对 TTL 断流。 */
export const MCP_UI_INSTANCE_IDLE_TTL_MS = 30 * 60_000;

export interface McpUiInstancesOptions {
  ttlMs?: number;
  now?: () => number;
}

const logicalKey = (binding: McpUiInstanceBinding) =>
  JSON.stringify([
    binding.workspace,
    binding.sessionId,
    binding.pluginId,
    binding.serverName,
    binding.scopeId,
    binding.resourceUri,
    binding.ownerWebContentsId,
  ]);

/**
 * 单一凭证 owner。`open` 对同一逻辑作用域 + 同一连接代际幂等；页面重载 / server 重连后换代。
 * `validate` 同时校验 workspace 身份、session、plugin、server 与连接快照（缺省不撤销）。
 */
export class McpUiInstances {
  private readonly runtimeId = randomUUID();
  private generation = 0;
  private readonly records = new Map<string, McpUiInstanceRecord>();
  private readonly logical = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: McpUiInstancesOptions = {}) {
    this.ttlMs = options.ttlMs ?? MCP_UI_INSTANCE_IDLE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  open(
    binding: McpUiInstanceBinding,
    source: McpUiInstanceSource | null,
    now: { createToken?: () => string } = {},
  ): McpAppInstance {
    const key = logicalKey(binding);
    const previous = this.records.get(this.logical.get(key) ?? "");
    if (
      previous &&
      sameSource(previous.source, source) &&
      previous.binding.accountContext === binding.accountContext &&
      previous.expiresAt > this.now()
    ) {
      return previous.lease;
    }
    if (previous) this.close(previous.lease);
    const lease: McpAppInstance = {
      runtimeId: this.runtimeId,
      generation: ++this.generation,
      token: now.createToken?.() ?? randomUUID(),
      appIdentity: createHash("sha256")
        .update(
          JSON.stringify([
            binding.workspace,
            binding.serverName,
            source?.identity ?? "",
            binding.accountContext ?? "",
          ]),
        )
        .digest("hex"),
    };
    this.records.set(lease.token, {
      lease,
      binding,
      source,
      cancel: new AbortController(),
      pins: new Set(),
      expiresAt: this.now() + this.ttlMs,
    });
    this.logical.set(key, lease.token);
    return lease;
  }

  validate(
    lease: McpAppInstance,
    scope: {
      sessionId: string;
      pluginId: string;
      serverName: string;
      workspace?: { workspaceIdentity?: string; workspacePath: string };
    },
    source: McpUiInstanceSource | null | undefined,
  ): McpUiInstanceRecord {
    const record = this.records.get(lease.token);
    if (!record) throw new Error("MCP App instance is no longer authorized");
    // 过期凭证等同于已撤销：先移除再抛错，迟到的请求不可能再拿到执行权。
    if (record.expiresAt <= this.now()) {
      this.close(record.lease);
      throw new Error("MCP App instance is no longer authorized");
    }
    if (
      record.lease.runtimeId !== lease.runtimeId ||
      record.lease.generation !== lease.generation ||
      record.lease.appIdentity !== lease.appIdentity ||
      (scope.workspace &&
        record.binding.workspace !==
          (scope.workspace.workspaceIdentity?.trim() || scope.workspace.workspacePath)) ||
      record.binding.sessionId !== scope.sessionId ||
      record.binding.pluginId !== scope.pluginId ||
      record.binding.serverName !== scope.serverName
    ) {
      throw new Error("MCP App instance is no longer authorized");
    }
    // 连接快照缺失表示宿主未实现撤销；已知快照必须与签发时一致。
    if (
      source !== undefined &&
      source !== null &&
      (!record.source ||
        record.source.identity !== source.identity ||
        record.source.generation !== source.generation)
    ) {
      this.close(record.lease);
      throw new Error("MCP App instance is no longer authorized");
    }
    // 校验通过即顺延空闲期（滑动过期）：长会话不会因绝对 TTL 断流。
    record.expiresAt = this.now() + this.ttlMs;
    return record;
  }

  /** 工具调用期间 pin 住实例，dispose 时能等到调用结束；返回的信号随凭证一起 abort。 */
  retain(token: string, callId: string): { signal: AbortSignal; release: () => void } {    const record = this.records.get(token);
    if (!record) throw new Error("MCP App instance is no longer authorized");
    if (record.expiresAt <= this.now()) {
      this.close(record.lease);
      throw new Error("MCP App instance is no longer authorized");
    }
    // 活跃调用顺延空闲期：只有真正闲置的凭证才会过期。
    record.expiresAt = this.now() + this.ttlMs;
    const pin = `${callId}:${randomUUID()}`;
    record.pins.add(pin);
    return {
      signal: record.cancel.signal,
      release: () => record.pins.delete(pin),
    };
  }

  /**
   * 按沙箱作用域 + 代际 pin 实例。模型侧 App 工具定义只携带 (scopeId, generation)，
   * 不带凭证 token；实例不存在（已换代 / 已撤销）时抛出，调用方按不可用处理。
   */
  retainByScope(
    scopeId: string,
    generation: number,
    callId: string,
  ): { signal: AbortSignal; release: () => void } {
    for (const record of this.records.values()) {
      if (record.binding.scopeId === scopeId && record.lease.generation === generation) {
        return this.retain(record.lease.token, callId);
      }
    }
    throw new Error("MCP App instance is no longer authorized");
  }

  isBusy(lease: McpAppInstance): boolean {
    return (this.records.get(lease.token)?.pins.size ?? 0) > 0;
  }

  close(lease: McpAppInstance): boolean {
    const record = this.records.get(lease.token);
    if (
      !record ||
      record.lease.runtimeId !== lease.runtimeId ||
      record.lease.generation !== lease.generation ||
      record.lease.appIdentity !== lease.appIdentity
    ) {
      return false;
    }
    this.records.delete(lease.token);
    const key = logicalKey(record.binding);
    if (this.logical.get(key) === lease.token) this.logical.delete(key);
    record.cancel.abort();
    return true;
  }

  closeSession(sessionId: string): void {
    for (const record of this.records.values()) {
      if (record.binding.sessionId === sessionId) this.close(record.lease);
    }
  }

  size(): number {
    return this.records.size;
  }

  clear(): void {
    for (const record of this.records.values()) this.close(record.lease);
  }
}

function sameSource(
  left: McpUiInstanceSource | null,
  right: McpUiInstanceSource | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.identity === right.identity && left.generation === right.generation;
}
