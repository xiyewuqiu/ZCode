import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveredProviderModel } from "@ycode/shared";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import { createServiceLogger, type ServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";

/**
 * models.dev 目录补全层。
 *
 * 目录只用于填补实时发现结果里缺失的名称/上下文/最大输出，不覆盖端点值，也不写 Provider
 * 配置。所有网络与磁盘访问都在 Host 进程完成，Renderer 只消费合并后的结果。
 */
export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";
export const PROVIDER_MODEL_CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CATALOG_FETCH_TIMEOUT_MS = 20_000;
const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
const CATALOG_CACHE_VERSION = 1;
const CATALOG_CACHE_FILE_NAME = "models.dev.json";

export interface ProviderCatalogModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  /** 目录的规范模型 ID（通常是 `vendor/model`），用于判断官方 Provider。 */
  readonly canonicalModelId?: string;
}

export interface ProviderCatalogEntry {
  readonly id: string;
  readonly models: readonly ProviderCatalogModel[];
}

export interface ProviderModelCatalog {
  readonly source: string;
  readonly fetchedAt: number;
  readonly providers: readonly ProviderCatalogEntry[];
}

export interface ProviderModelCatalogOptions {
  readonly cacheFilePath?: string;
  readonly url?: string;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: ServiceLogger;
}

export function getProviderModelCatalogCachePath(): string {
  return join(getAppConfigDir(), "model-catalog", CATALOG_CACHE_FILE_NAME);
}

export function createProviderModelCatalogLoader(options: ProviderModelCatalogOptions = {}): {
  load(): Promise<ProviderModelCatalog | undefined>;
} {
  const url = options.url ?? MODELS_DEV_CATALOG_URL;
  const ttlMs = options.ttlMs ?? PROVIDER_MODEL_CATALOG_TTL_MS;
  const timeoutMs = options.timeoutMs ?? CATALOG_FETCH_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_CATALOG_RESPONSE_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.logger ?? createServiceLogger("provider-model-catalog");
  let cacheFilePath: string | undefined;
  const resolveCacheFilePath = (): string =>
    (cacheFilePath ??= options.cacheFilePath ?? getProviderModelCatalogCachePath());

  let snapshot: ProviderModelCatalog | undefined;
  let cachePromise: Promise<void> | null = null;
  let inflight: Promise<ProviderModelCatalog | undefined> | null = null;

  const loadCacheOnce = (): Promise<void> => {
    if (!cachePromise) {
      cachePromise = readCatalogCache(resolveCacheFilePath(), maxResponseBytes, log)
        .then((cached) => {
          if (cached) snapshot = cached;
        })
        .catch(() => undefined);
    }
    return cachePromise;
  };

  const refresh = async (): Promise<ProviderModelCatalog | undefined> => {
    try {
      const providers = await fetchModelsDevCatalog(fetchImpl, url, timeoutMs, maxResponseBytes);
      const next: ProviderModelCatalog = { source: url, fetchedAt: now(), providers };
      snapshot = next;
      await writeCatalogCache(resolveCacheFilePath(), next, log);
      log.info(undefined, "模型元数据目录已刷新", { providers: providers.length, url });
      return next;
    } catch (error) {
      // 刷新失败不能影响实时发现；有旧快照时继续用它，没有则让调用方返回端点结果。
      log.warn(undefined, "模型元数据目录刷新失败，继续使用实时发现结果或上次成功缓存", {
        url,
        error: messageOf(error),
      });
      return snapshot;
    }
  };

  return {
    async load() {
      await loadCacheOnce();
      if (snapshot && now() - snapshot.fetchedAt < ttlMs) return snapshot;
      if (!inflight) {
        inflight = refresh().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}

/** 解析 models.dev `api.json`；结构不符时返回 undefined。 */
export function parseModelsDevCatalog(body: unknown): readonly ProviderCatalogEntry[] | undefined {
  const providersRecord = asRecord(body);
  if (!providersRecord) return undefined;

  const providers: ProviderCatalogEntry[] = [];
  for (const [providerKey, providerValue] of Object.entries(providersRecord)) {
    const provider = asRecord(providerValue);
    const modelsRecord = asRecord(provider?.models);
    if (!provider || !modelsRecord) continue;

    const providerId = stringValue(provider.id)?.trim() || providerKey;
    const models: ProviderCatalogModel[] = [];
    for (const [modelKey, modelValue] of Object.entries(modelsRecord)) {
      const model = asRecord(modelValue);
      const type = stringValue(model?.type)?.trim().toLowerCase();
      // 视频/图像/嵌入模型的 limit 不能用来描述聊天模型的上下文。
      if (!model || (type && type !== "text")) continue;

      const id = stringValue(model.id)?.trim() || modelKey;
      const limit = asRecord(model.limit);
      const name = stringValue(model.name)?.trim();
      const contextWindow = positiveInteger(limit?.context);
      const maxOutputTokens = positiveInteger(limit?.output);
      if (!name && contextWindow === undefined && maxOutputTokens === undefined) continue;

      const canonicalModelId = stringValue(model.canonical_model_id)?.trim();
      models.push({
        id,
        ...(name ? { name } : {}),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        ...(canonicalModelId ? { canonicalModelId } : {}),
      });
    }
    if (models.length > 0) providers.push({ id: providerId, models });
  }
  return providers.length > 0 ? providers : undefined;
}

/**
 * 只补缺失字段：端点未提供上下文/最大输出，或名称仍为 ID 占位时，才使用目录值。
 * 返回新数组；没有可补字段的模型保留原对象。
 */
export function enrichModelsWithCatalog(
  models: readonly DiscoveredProviderModel[],
  providers: readonly ProviderCatalogEntry[],
): readonly DiscoveredProviderModel[] {
  if (models.length === 0 || providers.length === 0) return models;
  const index = buildCatalogIndex(providers);
  return models.map((model) => {
    const hit = findCatalogHit(index, model.id);
    if (!hit) return model;
    const name = isPlaceholderName(model) ? (hit.model.name ?? model.name) : model.name;
    const contextWindow = model.contextWindow ?? hit.model.contextWindow;
    const maxOutputTokens = model.maxOutputTokens ?? hit.model.maxOutputTokens;
    if (
      name === model.name &&
      contextWindow === model.contextWindow &&
      maxOutputTokens === model.maxOutputTokens
    ) {
      return model;
    }
    return {
      id: model.id,
      ...(name ? { name } : {}),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
  });
}
interface CatalogHit {
  readonly model: ProviderCatalogModel;
  readonly providerId: string;
  readonly providerOrder: number;
  readonly modelOrder: number;
}
interface CatalogIndex {
  readonly exact: Map<string, CatalogHit[]>;
  readonly lower: Map<string, CatalogHit[]>;
  readonly segment: Map<string, CatalogHit[]>;
}
function buildCatalogIndex(providers: readonly ProviderCatalogEntry[]): CatalogIndex {
  const exact = new Map<string, CatalogHit[]>();
  const lower = new Map<string, CatalogHit[]>();
  const segment = new Map<string, CatalogHit[]>();
  providers.forEach((provider, providerOrder) => {
    provider.models.forEach((model, modelOrder) => {
      const hit: CatalogHit = { model, providerId: provider.id, providerOrder, modelOrder };
      const add = (map: Map<string, CatalogHit[]>, key: string): void => {
        const existing = map.get(key);
        if (existing) existing.push(hit);
        else map.set(key, [hit]);
      };
      add(exact, model.id);
      add(lower, model.id.toLowerCase());
      add(segment, lastPathSegment(model.id).toLowerCase());
    });
  });
  return { exact, lower, segment };
}
function findCatalogHit(index: CatalogIndex, modelId: string): CatalogHit | undefined {
  const exact = index.exact.get(modelId);
  if (exact?.length) return pickCatalogHit(exact);
  const lower = index.lower.get(modelId.toLowerCase());
  if (lower?.length) return pickCatalogHit(lower);
  const segment = index.segment.get(lastPathSegment(modelId).toLowerCase());
  if (!segment?.length) return undefined;
  // 两个裸 ID 仅末段相同时不匹配；至少一方带 vendor 前缀才允许末段回退。
  const livePrefixed = modelId.includes("/");
  const candidates = livePrefixed ? segment : segment.filter((hit) => hit.model.id.includes("/"));
  return candidates.length > 0 ? pickCatalogHit(candidates) : undefined;
}
function pickCatalogHit(candidates: readonly CatalogHit[]): CatalogHit {
  return candidates.reduce((best, candidate) =>
    compareCatalogHits(candidate, best) < 0 ? candidate : best,
  );
}
function compareCatalogHits(left: CatalogHit, right: CatalogHit): number {
  const official = officialProviderRank(left) - officialProviderRank(right);
  if (official !== 0) return official;
  if (left.providerOrder !== right.providerOrder) return left.providerOrder - right.providerOrder;
  if (left.modelOrder !== right.modelOrder) return left.modelOrder - right.modelOrder;
  const byModelId = left.model.id.localeCompare(right.model.id);
  return byModelId !== 0 ? byModelId : left.providerId.localeCompare(right.providerId);
}
function officialProviderRank(hit: CatalogHit): number {
  const providerId = hit.providerId.trim().toLowerCase();
  const vendors = [vendorPrefix(hit.model.canonicalModelId), vendorPrefix(hit.model.id)];
  return vendors.some((vendor) => vendor === providerId) ? 0 : 1;
}
function vendorPrefix(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return value.slice(0, slash).toLowerCase();
}
function lastPathSegment(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}
function isPlaceholderName(model: DiscoveredProviderModel): boolean {
  const name = model.name?.trim();
  return !name || name === model.id;
}
async function fetchModelsDevCatalog(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<readonly ProviderCatalogEntry[]> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`目录端点返回 HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new Error(`目录响应超过 ${maxResponseBytes} 字节上限`);
  }
  const text = await readBoundedText(response, maxResponseBytes);
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error("目录响应不是合法 JSON");
  }
  const providers = parseModelsDevCatalog(body);
  if (!providers) throw new Error("目录响应缺少 Provider/模型结构");
  return providers;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`目录响应超过 ${maxBytes} 字节上限`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function readCatalogCache(
  cacheFilePath: string,
  maxBytes: number,
  log: ServiceLogger,
): Promise<ProviderModelCatalog | undefined> {
  let text: string;
  try {
    text = await readFile(cacheFilePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      log.warn(undefined, "模型元数据缓存读取失败，将尝试刷新目录", {
        cacheFilePath,
        error: messageOf(error),
      });
    }
    return undefined;
  }
  if (Buffer.byteLength(text, "utf-8") > maxBytes) {
    log.warn(undefined, "模型元数据缓存超过大小上限，已忽略", { cacheFilePath });
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    log.warn(undefined, "模型元数据缓存不是合法 JSON，已忽略", { cacheFilePath });
    return undefined;
  }
  const cached = parseCatalogCache(parsed);
  if (!cached) {
    log.warn(undefined, "模型元数据缓存结构无效，已忽略", { cacheFilePath });
    return undefined;
  }
  return cached;
}

function parseCatalogCache(value: unknown): ProviderModelCatalog | undefined {
  const record = asRecord(value);
  if (!record || record.version !== CATALOG_CACHE_VERSION) return undefined;
  const fetchedAt = record.fetchedAt;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return undefined;
  }
  const providersRaw = record.providers;
  if (!Array.isArray(providersRaw)) return undefined;

  const providers: ProviderCatalogEntry[] = [];
  for (const rawProvider of providersRaw) {
    const provider = asRecord(rawProvider);
    const providerId = stringValue(provider?.id)?.trim();
    const modelsRaw = provider?.models;
    if (!providerId || !Array.isArray(modelsRaw)) continue;

    const models: ProviderCatalogModel[] = [];
    for (const rawModel of modelsRaw) {
      const model = asRecord(rawModel);
      const id = stringValue(model?.id)?.trim();
      if (!model || !id) continue;
      const name = stringValue(model.name)?.trim();
      const contextWindow = positiveInteger(model.contextWindow);
      const maxOutputTokens = positiveInteger(model.maxOutputTokens);
      const canonicalModelId = stringValue(model.canonicalModelId)?.trim();
      if (!name && contextWindow === undefined && maxOutputTokens === undefined) continue;
      models.push({
        id,
        ...(name ? { name } : {}),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        ...(canonicalModelId ? { canonicalModelId } : {}),
      });
    }
    if (models.length > 0) providers.push({ id: providerId, models });
  }
  if (providers.length === 0) return undefined;

  return {
    source: stringValue(record.source)?.trim() || MODELS_DEV_CATALOG_URL,
    fetchedAt,
    providers,
  };
}

async function writeCatalogCache(
  cacheFilePath: string,
  snapshot: ProviderModelCatalog,
  log: ServiceLogger,
): Promise<void> {
  try {
    await atomicWriteText(
      cacheFilePath,
      JSON.stringify({
        version: CATALOG_CACHE_VERSION,
        source: snapshot.source,
        fetchedAt: snapshot.fetchedAt,
        providers: snapshot.providers,
      }),
    );
  } catch (error) {
    // 缓存写入失败不影响本次补全；下次仍可重新拉取。
    log.warn(undefined, "模型元数据缓存写入失败", {
      cacheFilePath,
      error: messageOf(error),
    });
  }
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
