import type {
  DiscoveredProviderModel,
  ProviderModelDiscoveryErrorCode,
  ProviderModelDiscoveryInput,
  ProviderModelDiscoveryResult,
} from "@ycode/shared";
import {
  createProviderModelCatalogLoader,
  enrichModelsWithCatalog,
  type ProviderModelCatalog,
  type ProviderModelCatalogOptions,
} from "./providerModelCatalog.js";
import type { ProviderModelDiscoverer } from "./providerFacadeServices.js";

const DISCOVERY_TIMEOUT_MS = 15_000;
// 目录冷启动可能下载数 MiB；实时结果不能陪它等满 20s。等不到就先用端点结果，
// 目录刷新在后台继续，下一次发现自然命中缓存。
const CATALOG_ENRICHMENT_WAIT_MS = 1_500;
const MAX_DISCOVERY_RESPONSE_BYTES = 4 * 1024 * 1024;
const ANTHROPIC_VERSION = "2023-06-01";

export interface ProviderModelDiscovererOptions {
  /** 传 false 可关闭目录补全（测试或完全离线环境）。 */
  readonly catalog?: ProviderModelCatalogOptions | false;
}

/**
 * 从 Provider 的只读模型目录端点拉取候选模型，并用 models.dev 目录补全缺失元数据。
 *
 * 只在 Host 进程执行：API Key 和自定义 Header 不会进入 Renderer。目录补全只填空字段，
 * 不覆盖端点值，也不写配置；用户确认后由设置页通过 Provider 配置事务一次性添加。
 */
export function createProviderModelDiscoverer(
  options: ProviderModelDiscovererOptions = {},
): ProviderModelDiscoverer {
  const catalog =
    options.catalog === false ? undefined : createProviderModelCatalogLoader(options.catalog);
  return async (input) => {
    // 目录读取/刷新与实时发现并发；目录失败不能拖垮或改写实时结果。
    const catalogPromise = catalog?.load().catch(() => undefined);
    const live = await discoverProviderModels(input);
    if (!live.ok || !catalogPromise) return live;
    const snapshot = await awaitCatalogWithinBudget(catalogPromise, CATALOG_ENRICHMENT_WAIT_MS);
    if (!snapshot) return live;
    return { ok: true, models: enrichModelsWithCatalog(live.models, snapshot.providers) };
  };
}

async function awaitCatalogWithinBudget(
  promise: Promise<ProviderModelCatalog | undefined>,
  budgetMs: number,
): Promise<ProviderModelCatalog | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverProviderModels(
  input: ProviderModelDiscoveryInput,
): Promise<ProviderModelDiscoveryResult> {
  const baseURL = input.baseURL?.trim();
  if (!baseURL) {
    return failure("unsupported", "Set the provider Base URL before fetching models.");
  }
  const apiFormat = input.apiFormat ?? "openai-chat-completions";
  const url = modelsURL(baseURL, apiFormat);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: buildHeaders(apiFormat, input),
      redirect: "error",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    return failure("network", `Could not reach the model directory: ${messageOf(error)}`);
  }

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "auth" : "protocol";
    const hint =
      code === "auth"
        ? " Authentication was rejected; check the API key."
        : ` The endpoint returned HTTP ${response.status}.`;
    return failure(code, `Model discovery failed.${hint}`);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return failure("network", `Could not read the model directory: ${messageOf(error)}`);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_DISCOVERY_RESPONSE_BYTES) {
    return failure("protocol", "The model directory response is too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return failure("protocol", "The model directory did not return valid JSON.");
  }

  const models = readModels(body);
  if (models.length === 0) {
    return failure("empty", "No models were returned by this provider.");
  }
  return { ok: true, models };
}

function modelsURL(baseURL: string, apiFormat: string): string {
  const trimmed = baseURL.replace(/\/+$/, "");
  if (apiFormat === "anthropic-messages") {
    // Anthropic 的 Base URL 常带 /v1；列表端点只在根上拼一次。
    const root = trimmed.replace(/\/v1$/, "");
    return `${root}/v1/models?limit=1000`;
  }
  return `${trimmed}/models`;
}

function buildHeaders(
  apiFormat: string,
  input: ProviderModelDiscoveryInput,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.headers) Object.assign(headers, input.headers);
  if (apiFormat === "anthropic-messages") {
    if (input.apiKey && !hasHeader(headers, "x-api-key")) headers["x-api-key"] = input.apiKey;
    if (!hasHeader(headers, "anthropic-version")) headers["anthropic-version"] = ANTHROPIC_VERSION;
    return headers;
  }
  if (input.apiKey && !hasHeader(headers, "authorization")) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }
  return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function readModels(body: unknown): DiscoveredProviderModel[] {
  const record = asRecord(body);
  const data = Array.isArray(record?.data) ? record.data : undefined;
  const entries = data ?? modelMapEntries(record?.models);
  const byId = new Map<string, DiscoveredProviderModel>();

  for (const entry of entries) {
    const item = asRecord(entry);
    if (!item) continue;
    const id = stringValue(item.id)?.trim();
    if (!id || byId.has(id)) continue;
    const name =
      stringValue(item.name) ??
      stringValue(item.display_name) ??
      stringValue(item.displayName) ??
      id;
    const contextWindow = positiveInteger(
      item.contextWindow,
      item.context_window,
      item.context_length,
      item.max_input_tokens,
      asRecord(item.limit)?.context,
    );
    const maxOutputTokens = positiveInteger(
      item.maxOutputTokens,
      item.max_output_tokens,
      item.maxTokens,
      item.max_tokens,
      asRecord(item.limit)?.output,
      asRecord(item.top_provider)?.max_completion_tokens,
    );
    byId.set(id, {
      id,
      name,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    });
  }
  return [...byId.values()];
}

function modelMapEntries(value: unknown): unknown[] {
  const record = asRecord(value);
  if (!record) return [];
  // map 的键才是请求 id；嵌套 id 只作为展示/兼容字段，不能覆盖路由键。
  return Object.entries(record).map(([id, item]) => Object.assign({}, asRecord(item), { id }));
}

function positiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
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

function failure(
  code: ProviderModelDiscoveryErrorCode,
  message: string,
): ProviderModelDiscoveryResult {
  return { ok: false, error: { code, message } };
}
