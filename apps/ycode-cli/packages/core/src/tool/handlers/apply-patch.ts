// ============================================================
// ApplyPatch Tool Handler
// ============================================================
//
// 与上游 ApplyPatch 一致的两阶段执行：
//   1. 预检：解析整份补丁，逐 section 读取现状并计算目标内容；
//   2. 落盘：只有全部 section 预检通过后才开始写，单个文件通过
//      FileSystemPort.writeTextFile({ atomic: true }) 原子替换。
//
// 与上游的差异（本地安全基线要求）：
//   - 每个补丁路径在 resolveWorkspacePath 之后再做工作区包含校验，拒绝
//     `../` 或绝对路径逃逸到 workspaceRoot 之外；
//   - 落盘阶段记录已完成文件，中途失败时抛出带 appliedFiles/failedFile
//     的 IO_ERROR，明确区分「完全未写入」与「已部分写入」。

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolEntry, ToolHandler } from "../types.js";
import {
  ApplyPatchErrorCode,
  ApplyPatchInputJsonSchema,
  ApplyPatchInputSchema,
  ApplyPatchOutputJsonSchema,
  ApplyPatchOutputSchema,
  CoreErrorType,
  createCoreError,
  isFileSystemPortError,
  type ApplyPatchFileChange,
  type ApplyPatchInput,
  type ApplyPatchOutput,
  type FileSystemTextEncoding,
  type TraceContext,
} from "@ycode/contracts";
import { countPatchLines, createStructuredPatch } from "../diff.js";
import { derivePatchedContent } from "../patch-apply.js";
import { parseStructuredPatch, type ParsedPatch } from "../patch-parser.js";
import { resolveWorkspacePath } from "../path-policy.js";

const APPLY_PATCH_MODEL_INSTRUCTIONS = [
  "Use ApplyPatch for structured, reviewable edits that are easier to express as local diff hunks than exact old_string replacements.",
  "The patch must start with `*** Begin Patch` and end with `*** End Patch`.",
  "Use `*** Update File: <path>` with `@@` hunks for existing files. Prefix context lines with a space, removed lines with `-`, and added lines with `+`.",
  "Use `*** Add File: <path>` for new files and prefix every content line with `+`.",
  "Use `*** Delete File: <path>` only when deleting the file is intentional.",
  "Patch hunks are logical Unicode text, just like Read output. Updates preserve each existing file's detected original text encoding and line endings when possible, including GB2312, GBK, and GB18030.",
  "If verification fails, re-read the relevant range and provide more exact context; do not switch to Python or shell replacement scripts.",
];

interface VerifiedPatchChange {
  filePath: string;
  type: ApplyPatchFileChange["type"];
  movePath?: string;
  oldContent: string;
  newContent: string;
  encoding?: FileSystemTextEncoding;
  lineEndings?: "LF" | "CRLF";
  revision?: { id: string; mtimeMs?: number; sizeBytes?: number; hash?: string };
}

function formatApplyPatchModelContent(output: unknown): string {
  const parsed = ApplyPatchOutputSchema.safeParse(output);
  if (!parsed.success) return "Patch applied successfully.";
  return `Patch applied successfully.\n${parsed.data.summary}`;
}

export const applyPatchHandler: ToolHandler = async (input, context) => {
  const { patch_text } = ApplyPatchInputSchema.parse(input) as ApplyPatchInput;
  const fileSystemPort = context.fileSystemPort;

  if (!fileSystemPort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "FileSystemPort is not configured for ApplyPatch tool",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "ApplyPatch",
        },
        recoverable: false,
      },
    );
  }

  const sections = parsePatchOrThrow(patch_text, context.toolCallId);
  if (sections.length === 0) {
    throw createPatchError("patch rejected: empty patch", ApplyPatchErrorCode.EMPTY_PATCH, {
      toolCallId: context.toolCallId,
    });
  }

  const trace = traceFor(context);
  const changes: VerifiedPatchChange[] = [];
  for (const section of sections) {
    changes.push(await verifySection(section, context, trace));
  }

  const appliedFiles: string[] = [];
  let pendingFilePath: string | undefined;
  try {
    for (const change of changes) {
      const targetPath = change.type === "delete" ? change.filePath : (change.movePath ?? change.filePath);
      pendingFilePath = targetPath;

      if (change.type === "delete") {
        await fileSystemPort.removeFile(
          { path: change.filePath, trace },
          { signal: context.abortSignal },
        );
        appliedFiles.push(change.filePath);
        continue;
      }

      await fileSystemPort.writeTextFile(
        {
          path: targetPath,
          content: change.newContent,
          encoding: change.encoding,
          lineEndings: change.lineEndings,
          createParents: true,
          atomic: true,
          expectedRevision: change.type === "update" ? change.revision : undefined,
          trace,
        },
        { signal: context.abortSignal },
      );

      // 写入成功即算该目标已应用；move 的源删除失败时单独把失败点指向源文件，
      // 避免把“目标已写入、源未删掉”误报成目标写入失败。
      appliedFiles.push(targetPath);
      if (change.type === "move") {
        pendingFilePath = change.filePath;
        await fileSystemPort.removeFile(
          { path: change.filePath, trace },
          { signal: context.abortSignal },
        );
      }
    }
  } catch (error) {
    // 取消不是业务失败：保留 FileSystemPort 的 cancelled 语义，交给 executor 收口。
    if (context.abortSignal.aborted) throw error;

    const message = error instanceof Error ? error.message : String(error);
    const prefix =
      appliedFiles.length === 0
        ? "ApplyPatch failed before any file change was applied"
        : `ApplyPatch partially applied ${appliedFiles.length} of ${changes.length} file change(s)`;
    throw createPatchError(
      `${prefix}; failed at ${pendingFilePath ?? "<unknown>"}: ${message}`,
      ApplyPatchErrorCode.IO_ERROR,
      {
        appliedFiles,
        failedFile: pendingFilePath,
        toolCallId: context.toolCallId,
      },
      error,
    );
  }

  const files = changes.map(toOutputFileChange);
  return {
    files,
    structuredPatch: files.flatMap((file) => file.structuredPatch),
    summary: files.map(formatSummaryLine).join("\n"),
  } satisfies ApplyPatchOutput;
};

async function verifySection(
  section: ParsedPatch,
  context: Parameters<typeof applyPatchHandler>[1],
  trace: TraceContext,
): Promise<VerifiedPatchChange> {
  switch (section.type) {
    case "add":
      return verifyAdd(section, context, trace);
    case "delete":
      return verifyDelete(section, context, trace);
    case "update":
      return verifyUpdate(section, context, trace);
  }
}

async function verifyAdd(
  section: Extract<ParsedPatch, { type: "add" }>,
  context: Parameters<typeof applyPatchHandler>[1],
  trace: TraceContext,
): Promise<VerifiedPatchChange> {
  const filePath = resolvePatchPath(section.path, context);
  try {
    await context.fileSystemPort!.stat({ path: filePath, trace }, { signal: context.abortSignal });
    throw createPatchError(`File already exists: ${filePath}`, ApplyPatchErrorCode.FILE_EXISTS, {
      filePath,
      toolCallId: context.toolCallId,
    });
  } catch (error) {
    if (!isFileSystemPortError(error) || error.code !== "not_found") throw error;
  }
  return {
    filePath,
    type: "add",
    oldContent: "",
    newContent: section.contents,
  };
}

async function verifyDelete(
  section: Extract<ParsedPatch, { type: "delete" }>,
  context: Parameters<typeof applyPatchHandler>[1],
  trace: TraceContext,
): Promise<VerifiedPatchChange> {
  const filePath = resolvePatchPath(section.path, context);
  const read = await readExisting(filePath, context, trace);
  return {
    filePath,
    type: "delete",
    oldContent: read.content,
    newContent: "",
    encoding: read.encoding,
    lineEndings: read.lineEndings,
    revision: read.revision,
  };
}

async function verifyUpdate(
  section: Extract<ParsedPatch, { type: "update" }>,
  context: Parameters<typeof applyPatchHandler>[1],
  trace: TraceContext,
): Promise<VerifiedPatchChange> {
  if (section.chunks.length === 0) {
    throw createPatchError("Update file section has no hunks", ApplyPatchErrorCode.INVALID_PATCH, {
      filePath: section.path,
      toolCallId: context.toolCallId,
    });
  }

  const filePath = resolvePatchPath(section.path, context);
  const read = await readExisting(filePath, context, trace);
  let patched: string;
  try {
    patched = derivePatchedContent(read.content, section.chunks).content;
  } catch (error) {
    throw createPatchError(
      error instanceof Error ? error.message : String(error),
      ApplyPatchErrorCode.HUNK_NOT_FOUND,
      {
        filePath,
        toolCallId: context.toolCallId,
      },
      error,
    );
  }

  const movePath = section.movePath ? resolvePatchPath(section.movePath, context) : undefined;
  return {
    filePath,
    type: movePath ? "move" : "update",
    movePath,
    oldContent: read.content,
    newContent: patched,
    encoding: read.encoding,
    lineEndings: read.lineEndings,
    revision: read.revision,
  };
}

async function readExisting(
  filePath: string,
  context: Parameters<typeof applyPatchHandler>[1],
  trace: TraceContext,
) {
  try {
    return await context.fileSystemPort!.readTextFile(
      { path: filePath, trace },
      { signal: context.abortSignal },
    );
  } catch (error) {
    if (isFileSystemPortError(error) && error.code === "not_found") {
      throw createPatchError(`File not found: ${filePath}`, ApplyPatchErrorCode.FILE_NOT_EXIST, {
        filePath,
        toolCallId: context.toolCallId,
      });
    }
    throw error;
  }
}

function toOutputFileChange(change: VerifiedPatchChange): ApplyPatchFileChange {
  const structuredPatch = createStructuredPatch({
    filePath: change.movePath ?? change.filePath,
    oldContent: change.oldContent,
    newContent: change.newContent,
  });
  const { additions, deletions } = countPatchLines(structuredPatch);
  return {
    filePath: change.filePath,
    type: change.type,
    movePath: change.movePath,
    structuredPatch,
    additions,
    deletions,
  };
}

function formatSummaryLine(change: ApplyPatchFileChange): string {
  const marker = change.type === "add" ? "A" : change.type === "delete" ? "D" : "M";
  return `${marker} ${change.movePath ?? change.filePath}`;
}

function parsePatchOrThrow(patchText: string, toolCallId: string): ParsedPatch[] {
  try {
    return parseStructuredPatch(patchText);
  } catch (error) {
    throw createPatchError(
      error instanceof Error ? error.message : String(error),
      ApplyPatchErrorCode.INVALID_PATCH,
      { toolCallId },
      error,
    );
  }
}

function resolvePatchPath(
  inputPath: string,
  context: Parameters<typeof applyPatchHandler>[1],
): string {
  const resolvedPath = resolveWorkspacePath({
    inputPath,
    operation: "write",
    workingDirectory: context.workingDirectory,
    workspaceRoot: context.workspaceRoot,
  });
  assertPatchPathInsideWorkspace(inputPath, resolvedPath, context);
  return resolvedPath;
}

/**
 * 补丁路径必须落在 workspaceRoot 内。resolveWorkspacePath 是共享路径策略，
 * 当前版本刻意不硬拦外部路径；ApplyPatch 一次可写多个文件，权限确认窗里
 * 无法逐条展示目标，因此在工具侧额外收口，拒绝 `../` 与跨盘符绝对路径。
 *
 * 只做词法包含判断，不 realpath：符号链接逃逸由 FileSystemPort/宿主权限层负责。
 */
function assertPatchPathInsideWorkspace(
  inputPath: string,
  resolvedPath: string,
  context: Parameters<typeof applyPatchHandler>[1],
): void {
  const workspaceRoot = resolve(context.workspaceRoot);
  const relativePath = relative(workspaceRoot, resolvedPath);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw createPatchError(
      `Patch path escapes workspace root: ${inputPath}`,
      ApplyPatchErrorCode.INVALID_PATCH,
      {
        filePath: inputPath,
        toolCallId: context.toolCallId,
      },
    );
  }
}

function createPatchError(
  message: string,
  code: (typeof ApplyPatchErrorCode)[keyof typeof ApplyPatchErrorCode],
  extra: Record<string, unknown>,
  cause?: unknown,
) {
  return createCoreError(CoreErrorType.ToolExecutionFailed, message, {
    cause: cause instanceof Error ? cause : undefined,
    context: {
      code,
      toolName: "ApplyPatch",
      ...extra,
    },
    recoverable: true,
  });
}

function traceFor(context: Parameters<typeof applyPatchHandler>[1]): TraceContext {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
    sessionId: context.sessionId,
    turnId: context.turnId,
  } as unknown as TraceContext;
}

export const applyPatchToolEntry: ToolEntry = {
  capability: "Apply a structured patch through the file-system adapter",
  metadata: {
    name: "ApplyPatch",
    description: "Apply structured file patches with verification before writing.",
    modelInstructions: APPLY_PATCH_MODEL_INSTRUCTIONS,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: 30000,
    maxOutputBytes: 1_000_000,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: applyPatchHandler,
  formatModelContent: formatApplyPatchModelContent,
  inputSchema: ApplyPatchInputJsonSchema,
  outputSchema: ApplyPatchOutputJsonSchema,
  runtimeInputSchema: ApplyPatchInputSchema,
  runtimeOutputSchema: ApplyPatchOutputSchema,
  permission: {
    permission: "edit",
    reason: "ApplyPatch modifies file contents through the file-system adapter",
    riskLevel: "medium",
    sideEffectScope: "workspace",
    needsApproval: true,
    patternSources: ["input"],
    alwaysAllowPatternSources: ["input"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: 1_000_000,
    maxModelBytes: 100_000,
    strategy: "truncate",
    preview: {
      maxBytes: 100_000,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: 30000,
    maxMs: 30000,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "ApplyPatch was cancelled before file changes completed",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
