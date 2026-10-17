// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListYCodeSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunYCodeProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  YCodeApp,
  YCodeAppOptions,
  YCodeModelOption,
} from "./app/types.js";
export {
  inspectYCodeCustomCommand,
  listYCodeCustomCommands,
  loadYCodeCustomCommand,
} from "./custom-commands.js";
export type {
  InspectYCodeCustomCommandOptions,
  ListYCodeCustomCommandsOptions,
  YCodeCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addYCodePluginMarketplace,
  getYCodePluginsOverview,
  installYCodeMarketplacePlugin,
  listYCodePlugins,
  removeYCodePluginMarketplace,
  resolveYCodePlugins,
  setYCodePluginEnabled,
  uninstallYCodeMarketplacePlugin,
  updateYCodeMarketplacePlugin,
  updateYCodePluginMarketplace,
  validateYCodePluginPath,
} from "./plugins.js";
export type {
  AddYCodeMarketplaceOptions,
  InstallYCodeMarketplacePluginOptions,
  ListYCodePluginsOptions,
  RemoveYCodeMarketplaceOptions,
  ResolveYCodePluginsOptions,
  SetYCodePluginEnabledOptions,
  SetYCodePluginEnabledResult,
  UninstallYCodeMarketplacePluginOptions,
  UpdateYCodeMarketplaceOptions,
  UpdateYCodeMarketplacePluginOptions,
  ValidateYCodePluginPathOptions,
  YCodeAvailablePluginData,
  YCodeInstalledPluginData,
  YCodeMarketplaceSummaryData,
  YCodeMarketplaceUpdateData,
  YCodePluginInstallData,
  YCodePluginUpdateData,
  YCodePluginsOverviewData,
} from "./plugins.js";
export { runYCodeProtocolAgent } from "./ycode-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./ycode-protocol/session-mapper.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listYCodeSessions, resolveLatestSession } from "./sessions.js";
export { inspectYCodeSkill, listYCodeSkills } from "./skills.js";
export type {
  InspectYCodeSkillOptions,
  ListYCodeSkillsOptions,
  YCodeSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedYCodeSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
