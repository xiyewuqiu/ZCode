import type { ApiClient } from "@zcode/shared";
import { readApiJson } from "#src/providers/api/apiJson.js";

const BIGMODEL_TEAM_PLAN_API_KEY_NAME = "zcode-team-api-key";
const BIGMODEL_TEAM_PLAN_API_KEY_TYPE = 2;

export interface BigModelTeamPlanBizContext {
  organizationId: string;
  projectId: string;
}

/** Team 项目级 API Key 的条目形状；只在本模块内消费，不作为跨模块类型契约导出。 */
interface BigModelTeamPlanApiKeySummary {
  apiKey?: string | null;
  keyType?: number | null;
  name?: string | null;
}

interface BigModelTeamPlanApiKeySecret {
  secretKey?: string | null;
}

interface BigModelBizEnvelope<T> {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: T | null;
}

export function createBigModelBizHeaders(
  authorization: string,
  teamContext?: BigModelTeamPlanBizContext | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": "application/json",
  };
  if (teamContext) {
    headers["bigmodel-organization"] = teamContext.organizationId;
    headers["bigmodel-project"] = teamContext.projectId;
  }
  return headers;
}

function createBigModelTeamPlanApiKeyPayload(): {
  keyType: typeof BIGMODEL_TEAM_PLAN_API_KEY_TYPE;
  name: typeof BIGMODEL_TEAM_PLAN_API_KEY_NAME;
} {
  return {
    name: BIGMODEL_TEAM_PLAN_API_KEY_NAME,
    keyType: BIGMODEL_TEAM_PLAN_API_KEY_TYPE,
  };
}

function isUsableBigModelTeamPlanApiKey(item: BigModelTeamPlanApiKeySummary): boolean {
  return (
    item.name === BIGMODEL_TEAM_PLAN_API_KEY_NAME &&
    item.keyType === BIGMODEL_TEAM_PLAN_API_KEY_TYPE &&
    Boolean(item.apiKey?.trim())
  );
}

/**
 * 取得（或补建）当前 Team 项目可用的 project API Key。
 *
 * 列表命中就复用；否则按 `keyType=2` 建一把。**只返回 API Key 本身**：调用方
 * （accountProviderTeamPlanRequestKey）只需要 key，诊断细节没有消费方，不再沿路透传。
 */
export async function ensureBigModelTeamPlanProjectApiKey(params: {
  apiClient: ApiClient;
  authorization: string;
  host: string;
  teamContext: BigModelTeamPlanBizContext;
  timeoutMs: number;
}): Promise<BigModelTeamPlanApiKeySummary | null> {
  const listUrl = buildBigModelTeamPlanApiKeysUrl(params.host, params.teamContext);
  const listPayload = await readApiJson<BigModelBizEnvelope<BigModelTeamPlanApiKeySummary[]>>(
    params.apiClient,
    listUrl,
    {
      method: "GET",
      timeoutMs: params.timeoutMs,
      headers: createBigModelBizHeaders(params.authorization, params.teamContext),
    },
  );
  const apiKeys = isSuccessfulBigModelBizEnvelope(listPayload) ? (listPayload.data ?? []) : [];
  const existingApiKey = apiKeys.find(isUsableBigModelTeamPlanApiKey) ?? null;
  if (existingApiKey) {
    return existingApiKey;
  }

  // 一个账号可能有多个 Team Plan 项目，每个项目都需要自己的 keyType=2
  // 项目级 API Key；只给当前选中团队创建会导致切换到其他团队后 runtime 无法投影。
  const createPayload = await readApiJson<BigModelBizEnvelope<BigModelTeamPlanApiKeySummary>>(
    params.apiClient,
    listUrl,
    {
      method: "POST",
      timeoutMs: params.timeoutMs,
      headers: createBigModelBizHeaders(params.authorization, params.teamContext),
      body: JSON.stringify(createBigModelTeamPlanApiKeyPayload()),
    },
  );
  const createData = isSuccessfulBigModelBizEnvelope(createPayload)
    ? (createPayload.data ?? null)
    : null;
  return createData && isUsableBigModelTeamPlanApiKey(createData) ? createData : null;
}

export async function copyBigModelTeamPlanProjectApiKeySecret(params: {
  apiClient: ApiClient;
  authorization: string;
  apiKey: string;
  host: string;
  teamContext: BigModelTeamPlanBizContext;
  timeoutMs: number;
}): Promise<string | null> {
  const copyPayload = await readApiJson<BigModelBizEnvelope<BigModelTeamPlanApiKeySecret>>(
    params.apiClient,
    `${buildBigModelTeamPlanApiKeysUrl(params.host, params.teamContext)}/copy/${encodeURIComponent(
      params.apiKey,
    )}`,
    {
      method: "GET",
      timeoutMs: params.timeoutMs,
      headers: createBigModelBizHeaders(params.authorization, params.teamContext),
    },
  );
  const secretKey = isSuccessfulBigModelBizEnvelope(copyPayload)
    ? (copyPayload.data?.secretKey?.trim() ?? "")
    : "";
  return secretKey || null;
}

function buildBigModelTeamPlanApiKeysUrl(
  host: string,
  teamContext: BigModelTeamPlanBizContext,
): string {
  return (
    `${host}/api/biz/v1/organization/${encodeURIComponent(teamContext.organizationId)}` +
    `/projects/${encodeURIComponent(teamContext.projectId)}/api_keys`
  );
}

function isSuccessfulBigModelBizEnvelope(envelope: BigModelBizEnvelope<unknown>): boolean {
  if (envelope.success === false) {
    return false;
  }
  if (typeof envelope.code === "number") {
    return envelope.code === 0 || envelope.code === 200;
  }
  return envelope.success === true || envelope.data !== undefined;
}
