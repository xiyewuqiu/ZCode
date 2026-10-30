import {
  COMPLETED_TOOL_PART_METADATA_SCHEMA_VERSION,
  type CompletedToolPartMetadata,
  type ToolExecutionResult,
} from "../deps.js";
import { PersistedToolSearchContentSchema } from "@ycode/contracts";
import { createMcpToolDisplay } from "../../tool/executor/result-display.js";

export function mcpToolPartMetadata(
  presentation: { serverName: string; toolName: string; description?: string } | undefined,
): CompletedToolPartMetadata | undefined {
  const display = createMcpToolDisplay(presentation);
  return display
    ? { schemaVersion: COMPLETED_TOOL_PART_METADATA_SCHEMA_VERSION, display }
    : undefined;
}

/** Pending/running part 需要同时保存 MCP 展示和 DeferredToolCall 的包装身份。 */
export function toolPartCallMetadata(
  presentation: { serverName: string; toolName: string; description?: string } | undefined,
  modelCallWrapper: "DeferredToolCall" | undefined,
): CompletedToolPartMetadata | undefined {
  const base = mcpToolPartMetadata(presentation);
  if (!modelCallWrapper) return base;
  return {
    schemaVersion: COMPLETED_TOOL_PART_METADATA_SCHEMA_VERSION,
    ...base,
    modelCallWrapper,
  };
}

export function completedToolPartMetadata(result: ToolExecutionResult): CompletedToolPartMetadata {
  const modelContent = PersistedToolSearchContentSchema.safeParse(result.modelContent);
  const serialization = result.serialization
    ? {
        truncated: result.serialization.truncated,
        originalBytes: result.serialization.originalBytes,
        returnedBytes: result.serialization.returnedBytes,
        budgetStrategy: result.serialization.budgetStrategy,
        ...(result.serialization.artifactPath
          ? { artifactPath: result.serialization.artifactPath }
          : {}),
      }
    : undefined;
  return {
    schemaVersion: COMPLETED_TOOL_PART_METADATA_SCHEMA_VERSION,
    ...(modelContent.success ? { modelContent: modelContent.data } : {}),
    ...(result.display ? { display: result.display } : {}),
    ...(serialization ? { serialization } : {}),
    // resume 需要恢复模型当时真实读到的文件快照；只依赖 tool_result 文本
    // 会把主路径绑死在 provider 展示格式上，所以新 session 结构化持久化 read-state。
    ...(result.readFileStateMetadata ? { readFileState: result.readFileStateMetadata } : {}),
  };
}
