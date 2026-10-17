import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@ycode/tui";
import type { UiLocale } from "@ycode/i18n";
import type { Logger } from "@ycode/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@ycode/adapters/browser";
import type {
  createModelAdapter,
  createYCodeApp,
  CreateModelAdapterOptions,
  inspectYCodeSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectYCodeCustomCommand,
  InspectYCodeCustomCommandOptions,
  InspectYCodeSkillOptions,
  listYCodeCustomCommands,
  ListYCodeCustomCommandsOptions,
  loadYCodeCustomCommand,
  listYCodeSessions,
  listYCodeSkills,
  ListYCodeSessionsOptions,
  ListYCodeSkillsOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunYCodeProtocolAgentOptions,
  startProcessProviderRegistryRuntime,
  YCodeAppOptions,
} from "@ycode/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@ycode/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunYCodeProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createYCodeApp?: (
    options?: YCodeAppOptions,
  ) => Awaited<ReturnType<typeof createYCodeApp>> | ReturnType<typeof createYCodeApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createYCodeApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectYCodeSkillOptions) => ReturnType<typeof inspectYCodeSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectYCodeCustomCommandOptions,
  ) => ReturnType<typeof inspectYCodeCustomCommand>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  projectConfigPath?: string;
  listSessions?: (options: ListYCodeSessionsOptions) => ReturnType<typeof listYCodeSessions>;
  listCustomCommands?: (
    options: ListYCodeCustomCommandsOptions,
  ) => ReturnType<typeof listYCodeCustomCommands>;
  loadCustomCommand?: (
    options: InspectYCodeCustomCommandOptions,
  ) => ReturnType<typeof loadYCodeCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedYCodeSlashCommandName"];
  listSkills?: (options: ListYCodeSkillsOptions) => ReturnType<typeof listYCodeSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  runYCodeProtocolAgent?: (options?: RunYCodeProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@ycode/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createYCodeApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
