import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { YCodeStdioTapDevState } from "@ycode/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface YCodeStdioTapStateFile {
  enabled?: boolean;
}

function isYCodeStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

function getYCodeStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getYCodeStdioTapDevLogDir(): string {
  return join(getYCodeStdioTapDevDir(), "stdio-traffic");
}

function getYCodeStdioTapDevStatePath(): string {
  return join(getYCodeStdioTapDevDir(), "ycode-stdio-tap.json");
}

function readStateFile(path: string): YCodeStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as YCodeStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readYCodeStdioTapDevState(): YCodeStdioTapDevState {
  const visible = isYCodeStdioTapDevVisible();
  const statePath = getYCodeStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getYCodeStdioTapDevLogDir(),
    statePath,
  };
}

export function setYCodeStdioTapDevEnabled(enabled: boolean): YCodeStdioTapDevState {
  const visible = isYCodeStdioTapDevVisible();
  const statePath = getYCodeStdioTapDevStatePath();
  mkdirSync(getYCodeStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readYCodeStdioTapDevState();
}
