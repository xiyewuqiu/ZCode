import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  collectTelemetryRendererContext,
  sanitizeTelemetryEventDetail,
  type IPlatformService,
} from "@zcode/shared";
import { logger } from "@/logger.js";

/**
 * 登录 provider id → 上报用的低基数标签。
 *
 * 只认 OAuth provider id（账号家族身份）。内置 `account:*` 套餐 Provider 已不再由任何配置或
 * 注册表产出，因此不再参与映射；已发布旧事件的 `builtin:*` 身份归一由
 * providerTelemetryIdentity.legacyTelemetryProviderId 负责。
 */
export function resolveProviderTelemetryLabel(providerId: string): string {
  if (providerId === ZAI_PROVIDER_ID) {
    return "z.ai";
  }

  if (providerId === BIGMODEL_PROVIDER_ID) {
    return "bigmodel";
  }

  return providerId;
}

type ReportTelemetryPlatform = Pick<IPlatformService, "reportTelemetryEvent">;

export async function reportAppTelemetryEvent(
  platform: ReportTelemetryPlatform,
  payload: {
    elementName: string;
    eventRegion: string;
    eventType: string;
    eventText?: string;
    eventExtraDetail: Record<string, string>;
    userId?: string;
    talkId?: string;
    messageId?: string;
  },
  scope: string,
): Promise<void> {
  try {
    const reportPayload = {
      context: collectTelemetryRendererContext(),
      ...payload,
      eventExtraDetail: sanitizeTelemetryEventDetail(payload.elementName, payload.eventExtraDetail),
    };

    // 修复原因：只在 Core 清洗会让原文先经过 IPC/本地日志；此处只记录清洗后的副本。
    // step 与消息同量级，调试输出使用 debug，不产生 info 落盘副本。
    if (payload.elementName === "message_completion" || payload.elementName === "agent_step") {
      logger.debug(`[${scope}] ${payload.elementName} payload:`, reportPayload);
    }

    await platform.reportTelemetryEvent(reportPayload);
  } catch {
    // 最终失败由 Desktop Main 的 TelemetryCore 统一记录脱敏告警；UI 只维持业务隔离，
    // 避免同一失败重复记录，或把 IPC 原始错误带入生产日志。
  }
}
