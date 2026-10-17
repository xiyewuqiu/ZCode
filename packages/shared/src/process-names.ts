const YCODE_PROCESS_PREFIX = "ycode";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinYCodeProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [YCODE_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatYCodeMainProcessName(): string {
  return joinYCodeProcessName("main");
}

export function formatYCodeGpuProcessName(): string {
  return joinYCodeProcessName("gpu");
}

export function formatYCodeHostProcessName(label?: string): string {
  return joinYCodeProcessName("host", label);
}

export function formatYCodeRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "YCode") {
    return joinYCodeProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinYCodeProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "YCode - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinYCodeProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinYCodeProcessName("renderer", normalizedTitle);
}

export function formatYCodeAgentProcessName(provider: string, workspacePath?: string): string {
  return joinYCodeProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatYCodeUtilityProcessName(name?: string, type = "utility"): string {
  return joinYCodeProcessName(type, name);
}
