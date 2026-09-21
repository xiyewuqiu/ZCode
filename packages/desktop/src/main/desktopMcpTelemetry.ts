/* oxlint-disable eslint(no-unused-vars) */
import armsRum from "@arms/rum-electron";
import type { ZCodeMcpTelemetryEvent } from "@zcode/shared";

interface DesktopMcpTelemetryContext {
  appVersion: string;
  armsEnv: string;
  deviceMid: string;
}

let context: DesktopMcpTelemetryContext | undefined;

export function configureDesktopMcpTelemetry(next: DesktopMcpTelemetryContext): void {
  context = next;
}

export function reportMcpTelemetryToArms(
  _event: ZCodeMcpTelemetryEvent,
  _runtimeSurface: "local" | "remote",
): void {
  // 个人纯净开发环境：彻底禁用 MCP 事件的遥测上报
  return;
}

function mapMcpTelemetryEvent(event: Exclude<ZCodeMcpTelemetryEvent, { kind: "memory" }>): {
  group: "resource" | "stability";
  name: string;
  properties: Record<string, string | number | boolean | undefined | null>;
  value: number;
} {
  switch (event.kind) {
    case "process_start":
      return {
        group: "stability",
        name: "perf_mcp_process_start",
        properties: processProperties(event),
        value: 1,
      };
    case "process_crash":
      return {
        group: "stability",
        name: "perf_mcp_process_crash",
        properties: {
          ...processProperties(event),
          affected_session_count: event.affectedSessionCount,
          exit_code: event.exitCode,
          signal: event.signal,
          uptime_ms: event.uptimeMs,
        },
        value: 1,
      };
    case "session_startup":
      return {
        group: "stability",
        name: "perf_mcp_session_startup",
        properties: {
          session_id: event.sessionId,
          configured_count: event.configuredCount,
          connected_count: event.connectedCount,
          process_count: event.processCount,
          failed_count: event.failedCount,
        },
        value: event.processCount,
      };
  }
}

function processProperties(
  event: Extract<ZCodeMcpTelemetryEvent, { kind: "process_start" | "process_crash" }>,
): Record<string, string> {
  return {
    mcp_id: event.mcpId,
    mcp_instance_id: event.mcpInstanceId,
    mcp_isolation: event.mcpIsolation,
    mcp_source: event.mcpSource,
  };
}

function stringifyProperties(
  properties: Record<string, string | number | boolean | undefined | null>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function normalizePlatform(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}
