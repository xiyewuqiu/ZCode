import type { YCodeStreamingToolInputState } from "./streaming-tool-input-preview.js";

export interface YCodeToolProjectionMemory {
  completeToolInputById?: Map<string, unknown>;
  streamingToolInputById?: Map<string, YCodeStreamingToolInputState>;
  toolNameById?: Map<string, string>;
}

export interface YCodeToolProjectionMetadata {
  hasInput: boolean;
  input?: unknown;
  toolName?: string;
}

export function createYCodeToolProjectionMemory(): YCodeToolProjectionMemory {
  return {
    completeToolInputById: new Map<string, unknown>(),
    streamingToolInputById: new Map<string, YCodeStreamingToolInputState>(),
    toolNameById: new Map<string, string>(),
  };
}

export function ensureYCodeToolProjectionMemory(
  memory: YCodeToolProjectionMemory,
): YCodeToolProjectionMemory {
  memory.completeToolInputById ??= new Map<string, unknown>();
  memory.streamingToolInputById ??= new Map<string, YCodeStreamingToolInputState>();
  memory.toolNameById ??= new Map<string, string>();
  return memory;
}

export function resolveYCodeToolProjectionMetadata(
  payload: Record<string, unknown>,
  toolId: string,
  memory: YCodeToolProjectionMemory,
): YCodeToolProjectionMetadata {
  const toolName = readNonEmptyString(payload.toolName) ?? memory.toolNameById?.get(toolId);
  if (toolName) {
    memory.toolNameById?.set(toolId, toolName);
  }

  if ("input" in payload) {
    return {
      hasInput: payload.input !== undefined,
      input: payload.input,
      toolName,
    };
  }

  if (memory.completeToolInputById?.has(toolId)) {
    return {
      hasInput: true,
      input: memory.completeToolInputById.get(toolId),
      toolName,
    };
  }

  return {
    hasInput: false,
    toolName,
  };
}

export function finalizeYCodeToolProjectionInput(
  toolId: string,
  input: unknown,
  memory: YCodeToolProjectionMemory,
): void {
  memory.completeToolInputById ??= new Map<string, unknown>();
  memory.completeToolInputById.set(toolId, input);
  const streamingState = memory.streamingToolInputById?.get(toolId);
  if (streamingState) {
    streamingState.lastPreviewRawInputLength = streamingState.rawInput.length;
    streamingState.rawInput = "";
  }
}

export function forgetYCodeToolProjectionMetadata(
  toolId: string,
  memory: YCodeToolProjectionMemory,
): void {
  memory.completeToolInputById?.delete(toolId);
  memory.streamingToolInputById?.delete(toolId);
  memory.toolNameById?.delete(toolId);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
