import { TOOL_SEARCH_BETA, type ToolSearchCapability } from "@ycode/contracts";

/**
 * Anthropic Messages 是当前唯一支持 advanced-tool-use 的协议；本仓库不做 vendor/account
 * 灰度，Anthropic 兼容端点即视为支持，其余协议只允许 Local。
 */
export function resolveToolSearchCapability(
  apiType: string,
  _access: { type: string; mode?: string },
): ToolSearchCapability {
  const protocolSupported = apiType === "anthropic-messages";
  return Object.freeze({ protocolSupported, defaultEnabled: protocolSupported });
}

export function toolSearchHeaders(headers: Record<string, string> | undefined, enabled?: boolean) {
  if (!enabled) return headers;
  const result = { ...headers };
  const key =
    Object.keys(result).find((name) => name.toLowerCase() === "anthropic-beta") ?? "anthropic-beta";
  result[key] = [
    ...new Set([
      ...(result[key]
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? []),
      TOOL_SEARCH_BETA,
    ]),
  ].join(",");
  return result;
}
