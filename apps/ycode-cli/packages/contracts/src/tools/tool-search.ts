import { z } from "zod";
import type { JsonSchema } from "../model/index.js";
import { toToolJsonSchema } from "./json-schema.js";

export const TOOL_SEARCH_NAME = "ToolSearch";
export const ToolSearchModeSchema = z.enum(["auto", "native", "local", "off"]);
export type ToolSearchMode = z.infer<typeof ToolSearchModeSchema>;
export type ResolvedToolSearchMode = Exclude<ToolSearchMode, "auto">;
export const TOOL_SEARCH_DEFAULT_RESULTS = 5;
export const TOOL_SEARCH_DEFAULT_MAX_RESULTS = TOOL_SEARCH_DEFAULT_RESULTS;
export const TOOL_SEARCH_BETA = "advanced-tool-use-2025-11-20";

export const ToolSearchAnnouncementSchema = z
  .object({
    addedNames: z.array(z.string().min(1)),
    removedNames: z.array(z.string().min(1)),
    readdedNames: z.array(z.string().min(1)),
  })
  .strict()
  .refine((delta) => delta.readdedNames.every((name) => delta.addedNames.includes(name)), {
    message: "Readded tool names must be included in addedNames",
  });
export type ToolSearchAnnouncement = z.infer<typeof ToolSearchAnnouncementSchema>;

export const ToolReferenceContentSchema = z
  .object({
    type: z.literal("tool_reference"),
    toolName: z.string().min(1),
  })
  .strict();

/** Local 模式把 ToolSearch 结果作为真实引用保存在历史里，由请求投影展开为 <functions>。 */
export const PersistedToolSearchContentSchema = z
  .array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }).strict(),
      ToolReferenceContentSchema,
    ]),
  )
  .min(1);

export const ToolSearchInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
    ),
  max_results: z
    .number()
    .optional()
    .default(TOOL_SEARCH_DEFAULT_RESULTS)
    .describe("Maximum number of results to return (default: 5)"),
});
export type ToolSearchInput = z.infer<typeof ToolSearchInputSchema>;

export const ToolSearchOutputSchema = z.object({
  matches: z.array(z.string()),
  query: z.string(),
  total_deferred_tools: z.number(),
});
export type ToolSearchOutput = z.infer<typeof ToolSearchOutputSchema>;

export const ToolSearchInputJsonSchema = {
  ...toToolJsonSchema(ToolSearchInputSchema),
  // 转换器会把带默认值的字段视为可选；模型侧要求显式传入，执行侧仍先补默认值。
  required: ["query", "max_results"],
} satisfies JsonSchema;
export const ToolSearchOutputJsonSchema = toToolJsonSchema(ToolSearchOutputSchema);

export interface ToolSearchCapability {
  readonly protocolSupported: boolean;
  readonly defaultEnabled: boolean;
}

export interface ToolSearchCandidate {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly mcp?: { readonly serverName: string; readonly toolName: string };
  readonly description?: string;
  readonly searchHint?: string;
  readonly deferred: boolean;
}

export interface ToolSearchExecutionContext {
  readonly mode: ResolvedToolSearchMode;
  readonly enabled: boolean;
  readonly catalog: readonly ToolSearchCandidate[];
  readonly discovered: ReadonlySet<string>;
}
