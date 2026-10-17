import { createLocalServices, getAppConfigDir } from "@ycode/services/node";
import {
  materializeBundledYCodeBuiltinProviderConfig,
  readBundledYCodeBuiltinProviderConfig,
} from "./bundledYCodeBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";

async function main(): Promise<void> {
  const ycodeBuiltinProviderConfigFilePath = await materializeBundledYCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledYCodeBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["YCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["YCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["YCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const services = createLocalServices({
    ycodeBuiltinProviderConfigFilePath,
  });

  createHttpServer(services, port, {
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[ycode-server:http] startup failed", error);
  process.exitCode = 1;
});
