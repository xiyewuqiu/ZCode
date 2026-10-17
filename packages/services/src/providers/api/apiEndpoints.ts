import { buildRuntimeYCodeApiUrl, resolveZaiBusinessBaseUrl } from "@ycode/shared";

export const YCODE_CLIENT_SCENES_URL = buildRuntimeYCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
