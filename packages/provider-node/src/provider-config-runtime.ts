import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@ycode/provider";
import { NodeYCodeBuiltinProviderConfigSource } from "./ycode-builtin-provider-config-source.js";
import {
  EndpointScopedYCodeBuiltinSource,
  type EndpointScopedYCodeBuiltinSourceOptions,
} from "./endpoint-scoped-ycode-builtin-source.js";
import {
  YCodeBuiltinRemoteSynchronizer,
  type YCodeBuiltinRemoteSynchronizerOptions,
  type YCodeBuiltinRefreshResult,
} from "./ycode-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly ycodeBuiltinFilePath: string;
  readonly ycodeBuiltinActiveFilePath?: string;
  readonly ycodeBuiltinRemote?: Omit<YCodeBuiltinRemoteSynchronizerOptions, "source">;
  readonly ycodeBuiltinEnvironment?: Omit<
    EndpointScopedYCodeBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onYCodeBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    ycodeBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 YCode Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #ycodeBuiltinSource:
    | NodeYCodeBuiltinProviderConfigSource
    | EndpointScopedYCodeBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: YCodeBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#ycodeBuiltinSource = options.ycodeBuiltinEnvironment
      ? new EndpointScopedYCodeBuiltinSource({
          bundledFilePath: options.ycodeBuiltinFilePath,
          ...options.ycodeBuiltinEnvironment,
        })
      : new NodeYCodeBuiltinProviderConfigSource({
          bundledFilePath: options.ycodeBuiltinFilePath,
          activeFilePath: options.ycodeBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.ycodeBuiltinRemote &&
      this.#ycodeBuiltinSource instanceof NodeYCodeBuiltinProviderConfigSource
        ? new YCodeBuiltinRemoteSynchronizer({
            source: this.#ycodeBuiltinSource,
            ...options.ycodeBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onYCodeBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#ycodeBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      ycodeBuiltinSource: this.#ycodeBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveYCodeBuiltinActiveFilePath(): Promise<string> {
    return this.#ycodeBuiltinSource instanceof NodeYCodeBuiltinProviderConfigSource
      ? Promise.resolve(this.#ycodeBuiltinSource.activeFilePath)
      : this.#ycodeBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@ycode/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckYCodeBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#remoteSynchronizer ||
        this.#ycodeBuiltinSource instanceof EndpointScopedYCodeBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshYCodeBuiltin(options?: { readonly force?: boolean }): Promise<YCodeBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#ycodeBuiltinSource instanceof EndpointScopedYCodeBuiltinSource) {
      return this.#ycodeBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshYCodeBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#ycodeBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
