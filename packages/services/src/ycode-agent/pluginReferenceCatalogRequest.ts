import {
  ycodeProtocolMethods,
  ycodePluginsReferenceCatalogResultSchema,
  type YCodePluginsReferenceCatalogParams,
} from "@ycode/shared";
import type { YCodeProtocolClient } from "#src/ycode-agent/ycodeProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<YCodeProtocolClient, "request">,
  params: YCodePluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      ycodeProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      ycodePluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      ycodeProtocolMethods.pluginsReferenceCatalog,
      params,
      ycodePluginsReferenceCatalogResultSchema,
    );
  }
}
