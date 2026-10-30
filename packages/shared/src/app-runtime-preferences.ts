import { z } from "zod";

/** ToolSearch 模式：Native 仅对支持 advanced-tool-use 的 Anthropic 兼容模型生效。 */
export const appToolSearchModeSchema = z.enum(["auto", "native", "local", "off"]);
export type AppToolSearchMode = z.infer<typeof appToolSearchModeSchema>;

export const APP_RUNTIME_PREFERENCES_CHANGED_BROADCAST_CHANNEL = "settings:app-runtime-preferences";
export const ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV = "YCODE_E2E_ASK_USER_QUESTION_CLOCK_SCALE";

export const appRuntimePreferencesChangedBroadcastPayloadSchema = z
  .object({
    askUserQuestionAutoResolutionEnabled: z.boolean(),
    modelIoFullRetentionEnabled: z.boolean().default(false),
    toolSearchMode: appToolSearchModeSchema.default("off"),
  })
  .strict();

export type AppRuntimePreferencesChangedBroadcastPayload = z.infer<
  typeof appRuntimePreferencesChangedBroadcastPayloadSchema
>;
