/**
 * 插件页面 widgetState 的唯一 owner：renderer 内存，不持久化。
 * 键由 workspace + session + plugin + server + resource + scopeId 组成；页面 `ui/set-widget-state`
 * 写这里，重挂载时经 hostContext 的扩展键下发初值。业务数据仍应由插件自己的服务端保存。
 */
const states = new Map<string, unknown>();

export function buildPluginUiWidgetStateKey(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  pluginId: string;
  serverName: string;
  resourceUri: string;
  scopeId: string;
}): string {
  return JSON.stringify([
    input.workspaceIdentity?.trim() || input.workspacePath,
    input.sessionId,
    input.pluginId,
    input.serverName,
    input.resourceUri,
    input.scopeId,
  ]);
}

/** 未写入过返回 undefined；页面写入的 null 原样保留（区分「未加载」与「已清空」）。 */
export function getPluginUiWidgetState(key: string): unknown {
  return states.get(key);
}

export function setPluginUiWidgetState(key: string, widgetState: unknown): void {
  states.set(key, widgetState);
}

export function clearPluginUiWidgetState(key: string): void {
  states.delete(key);
}

export function resetPluginUiWidgetStateForTest(): void {
  states.clear();
}
