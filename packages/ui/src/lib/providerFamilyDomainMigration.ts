import type { IServiceAccessor } from "@zcode/services";
import { logger } from "@/logger.js";

/**
 * 兼容旧配置的 provider family 迁移收尾。
 *
 * YCode 已移除内置官方供应商（Z.ai / BigModel），不再存在可推断的 provider family：
 * 这里只负责在模型选择视图恢复后落地迁移标记，让后续启动不再重复检查。
 */
export async function ensureProviderFamilyDomainMigration(
  services: Pick<IServiceAccessor, "settingService" | "modelSelectionService">,
): Promise<void> {
  const settings = await services.settingService.get();
  if (settings.providerFamilyDomain || settings.providerFamilyDomainMigrated) {
    return;
  }

  let selectableProviders: readonly { readonly providerId: string }[] | null = null;
  try {
    selectableProviders = (await services.modelSelectionService.getView()).providers;
  } catch (error) {
    logger.warn("[providerFamilyDomainMigration] 读取模型选择视图失败", {
      error,
    });
  }

  if (selectableProviders?.length === 0) {
    // 启动早期 Registry 可能还没恢复。此时把“空结果”标记为已迁移，
    // 会让后续草稿预热在 selectedKey 为空时吃到旧的 Start Plan 偏好。
    logger.info("[providerFamilyDomainMigration] provider family domain 迁移等待模型选择视图恢复");
    return;
  }

  await services.settingService.update({
    providerFamilyDomainUpdatedAt: Date.now(),
    providerFamilyDomainMigrated: true,
  });

  logger.info("[providerFamilyDomainMigration] provider family 已移除，仅落地迁移标记");
}
