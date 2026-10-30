/**
 * 用户操作 Trace 已随遥测体系移除；这里保留最小的类型面，供远端连接流程记录生命周期。
 *
 * 本仓库不再向宿主上报 renderer action trace，因此句柄只提供空实现，
 * 不改变连接/取消/失败的业务语义。
 */

export interface UserActionResult {
  resultSource?: string;
  result?: string;
}

export interface UserActionFailure {
  failureStage?: string;
  reasonCode?: string;
}

export interface UserActionHandle {
  complete(result?: UserActionResult): void;
  fail(failure: UserActionFailure): void;
  reject(result?: UserActionResult): void;
  cancel(): void;
  noop(): void;
}

export interface StartUserActionInput {
  featureId: string;
  action: string;
  trigger?: string;
  workspaceKind?: string;
  remoteKind?: string;
}

export function startUserAction(_input: StartUserActionInput): UserActionHandle {
  return {
    complete() {},
    fail() {},
    reject() {},
    cancel() {},
    noop() {},
  };
}
