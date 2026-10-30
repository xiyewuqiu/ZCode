import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 独立桌面 Dev 实例会覆盖自己的 home；settings 必须与 Electron 使用同一 home，
 * 否则启动迁移和外观写入会污染其他实例。
 */
export function resolveUserHomeDir(): string {
  const envHome =
    process.env.YCODE_DESKTOP_HOME_DIR?.trim() ||
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

export function getSettingsDir(): string {
  return join(resolveUserHomeDir(), ".ycode", "v2");
}

export function getSettingsFile(): string {
  return join(getSettingsDir(), "setting.json");
}
