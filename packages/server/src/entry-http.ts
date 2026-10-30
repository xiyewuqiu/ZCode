import { createServerHostServices, getAppConfigDir } from "@ycode/services/node";
import { hostname } from "node:os";
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
  const serverId = process.env["YCODE_SERVER_ID"]?.trim() || hostname() || "ycode-server";
  // 独立 Server 必须先用设备身份固化持库 Host 与 canonical alias，再暴露 RPC；
  // 不能沿用桌面 local owner，否则远端项目会写进本机项目库。
  const { services, workspaceIdentityMapper } = await createServerHostServices({
    sourceServerId: serverId,
    ycodeBuiltinProviderConfigFilePath,
  });

  createHttpServer(services, port, {
    serverId,
    workspaceIdentityMapper,
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[ycode-server:http] startup failed", error);
  process.exitCode = 1;
});
