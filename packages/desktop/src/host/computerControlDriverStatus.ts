// 电脑控制（cua-driver）驱动状态探测 —— desktop host 侧实现。
//
// 为什么放在 host：驱动是随包分发的本机可执行文件，探测需要读安装目录/开发态
// bundled-tools 目录并起一个短命子进程读 `--version`，这些能力只属于桌面宿主进程。
//
// 路径解析与 services 侧 runtimeToolResolver / main 侧 resolveBundledRuntimeToolBinaryPath 保持一致：
// - 打包态：`<resources>/tools/cua-driver/cua-driver(.exe)`（electron-builder extraResources 映射）；
// - 开发态：仓库内 `bundled-tools/<platformKey>/cua-driver/`，兼容不同启动 cwd。
//
// 结果口径（与 UI 契约一致）：
// - missing：两个位置都没有驱动文件；
// - ready：能起进程并解析出版本号（version 一并返回）；
// - unknown：文件在但探测失败（spawn 失败、超时、输出无法解析）——这属于「读不到」，
//   不能报成 missing，否则用户会以为要重新安装驱动。

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

import type { ComputerControlDriverStatus } from "@zcode/services";

/** 与 packages/desktop/bundled-tools/<platformKey> 的 key 口径一致（`<platform>-<arch>`）。 */
const PLATFORM_KEY = `${process.platform}-${process.arch}`;

/** 驱动目录与可执行文件名；与 scripts/build-cua-driver.mjs 的落盘约定一致。 */
const DRIVER_DIRECTORY = "cua-driver";
const DRIVER_BINARY_NAME = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";

/**
 * `--version` 的超时。驱动是本地静态链接二进制，正常在几十毫秒内退出；
 * 5 秒仍未返回说明二进制损坏或被安全软件拦截，按 unknown 上报，不阻塞设置页。
 */
const VERSION_TIMEOUT_MS = 5_000;

/** `cua-driver 0.28.2` → `0.28.2`。版本行可能夹在其它输出里，所以按行匹配。 */
const VERSION_PATTERN = /^\s*cua-driver\s+(\S+)\s*$/mu;

function readResourcesPath(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === "string" ? resourcesPath.trim() || undefined : undefined;
}

function resolveDriverCandidates(): string[] {
  const resourcesPath = readResourcesPath();
  // 参考 services/runtime-tools/runtimeToolResolver.ts 的开发态候选集会：
  // desktop dev 的启动 cwd 可能是仓库根，也可能是 packages/desktop，两条都要试。
  const developmentRoots = [
    join(process.cwd(), "bundled-tools", PLATFORM_KEY),
    join(process.cwd(), "packages", "desktop", "bundled-tools", PLATFORM_KEY),
    // host bundle 产物位于 packages/desktop/out/host 时，../../ 即 packages/desktop。
    join(import.meta.dirname, "..", "..", "bundled-tools", PLATFORM_KEY),
  ];
  return [
    ...(resourcesPath ? [join(resourcesPath, "tools", DRIVER_DIRECTORY)] : []),
    ...developmentRoots.map((root) => resolvePath(root, DRIVER_DIRECTORY)),
  ].map((directory) => join(directory, DRIVER_BINARY_NAME));
}

export function resolveComputerControlDriverBinaryPath(): string | undefined {
  return resolveDriverCandidates().find((candidate) => existsSync(candidate));
}

function readDriverVersion(binaryPath: string): Promise<string | undefined> {
  return new Promise((settle) => {
    execFile(
      binaryPath,
      ["--version"],
      // windowsHide：host 是后台进程，不能为一次状态探测闪出控制台窗口。
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          settle(undefined);
          return;
        }
        const match = `${stdout}\n${stderr}`.match(VERSION_PATTERN);
        settle(match?.[1]);
      },
    );
  });
}

/**
 * 探测一次驱动状态；不会抛出——所有失败都收敛成 `unknown`。
 *
 * `execFile` 在 Windows 上遇到非 PE 文件、或在 POSIX 上遇到不可执行文件时会在 spawn 阶段
 * **同步抛错**（`spawn UNKNOWN` / `EACCES`），根本不会进 callback；文件也可能在 existsSync
 * 与 spawn 之间被删掉（`ENOENT`）。这类情况必须在这里收敛，否则一次状态查询会把设置页的
 * 探测 promise 变成 rejection（UI 只能落到「未知」且日志里带一个没上下文的异常）。
 */
export async function readComputerControlDriverStatus(): Promise<ComputerControlDriverStatus> {
  try {
    const binaryPath = resolveComputerControlDriverBinaryPath();
    if (!binaryPath) {
      return { state: "missing" };
    }

    const version = await readDriverVersion(binaryPath);
    return version ? { state: "ready", version } : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}
