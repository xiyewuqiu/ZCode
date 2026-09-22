#!/usr/bin/env node
// 构建 vendored 的 cua-driver（trycua/cua 的 cua-driver Rust workspace）。
//
// 用法：
//   node scripts/build-cua-driver.mjs                 构建 release 二进制并落到 bundled-tools
//   node scripts/build-cua-driver.mjs --check         只校验落盘产物存在且能输出版本
//   node scripts/build-cua-driver.mjs --skip-deps     跳过 rustup 工具链预检（假定已就绪）
//   node scripts/build-cua-driver.mjs --target=<triple>  显式指定 target triple
//   node scripts/build-cua-driver.mjs --jobs=N        传给 cargo -j
//
// 约定：
// - 源码与工具链版本以 third-party/cua-driver/ 为准（含 rust-toolchain.toml 与 Cargo.lock）。
//   本脚本不修改 vendor 源码；工具链装不上时直接失败并给出可执行提示，不静默换版本。
// - 产物落 packages/desktop/bundled-tools/<platformKey>/cua-driver/，与 ripgrep 等内置工具
//   一致；electron-builder 的 extraResources 再把它映射成安装包内的 resources/tools/cua-driver。
// - 该目录已在 .gitignore（packages/desktop/bundled-tools/），二进制不入库。
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");

const TOOL_ID = "cua-driver";
const WORKSPACE_DIR = join(repoRoot, "third-party/cua-driver");
const LICENSE_PATH = join(WORKSPACE_DIR, "LICENSE");
const VERSION_PATTERN = /^cua-driver\s+(\S+)\s*$/u;

// platformKey 与 scripts/native-search-tools-config.mjs 一致：`<process.platform>-<arch>`。
const TARGETS = new Map([
  ["win32-x64", { triple: "x86_64-pc-windows-msvc", executable: "cua-driver.exe" }],
  ["win32-arm64", { triple: "aarch64-pc-windows-msvc", executable: "cua-driver.exe" }],
  ["darwin-arm64", { triple: "aarch64-apple-darwin", executable: "cua-driver" }],
  ["darwin-x64", { triple: "x86_64-apple-darwin", executable: "cua-driver" }],
  ["linux-x64", { triple: "x86_64-unknown-linux-gnu", executable: "cua-driver" }],
  ["linux-arm64", { triple: "aarch64-unknown-linux-gnu", executable: "cua-driver" }],
]);

function readOption(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function platformKeyForTriple(triple) {
  for (const [platformKey, entry] of TARGETS) if (entry.triple === triple) return platformKey;
  throw new Error(`cua-driver 未登记的 target triple：${triple}`);
}

function resolveTarget() {
  const hostKey = `${process.platform}-${process.arch}`;
  const host = TARGETS.get(hostKey);
  if (!host) throw new Error(`cua-driver 未登记的平台：${hostKey}`);
  const requested = readOption("target");
  if (requested === undefined) return { ...host, platformKey: hostKey, explicit: false };
  // 显式 cross target 时按 triple 反查输出目录，避免把产物落到宿主平台的 key 下。
  const platformKey = platformKeyForTriple(requested);
  return {
    triple: requested,
    executable: TARGETS.get(platformKey).executable,
    platformKey,
    explicit: true,
  };
}

function outputDirectory(platformKey) {
  return join(repoRoot, "packages/desktop/bundled-tools", platformKey, TOOL_ID);
}

async function readPinnedToolchain() {
  const text = await readFile(join(WORKSPACE_DIR, "rust-toolchain.toml"), "utf8");
  const match = text.match(/^\s*channel\s*=\s*"([^"]+)"/mu);
  if (!match) throw new Error("third-party/cua-driver/rust-toolchain.toml 缺少 channel");
  return match[1];
}

async function ensureToolchain() {
  const channel = await readPinnedToolchain();
  try {
    const { stdout } = await execFileAsync("rustup", ["toolchain", "list"], {
      maxBuffer: 1024 * 1024,
    });
    if (stdout.split(/\r?\n/u).some((line) => line.startsWith(`${channel}-`))) {
      console.log(`[cua-driver] toolchain ${channel} 已就绪（rust-toolchain.toml 锁定）`);
      return channel;
    }
  } catch (error) {
    throw new Error(
      `找不到 rustup，无法准备锁定的工具链 ${channel}：${error.message}\n` +
        "请安装 rustup（https://rustup.rs）后重试，或加 --skip-deps 复用已配置的 cargo。",
    );
  }
  console.log(`[cua-driver] 安装锁定工具链 ${channel}（上游 rust-toolchain.toml）…`);
  await run("rustup", ["toolchain", "install", channel, "--profile", "minimal"], repoRoot);
  return channel;
}

function run(command, args, cwd) {
  return new Promise((settle, reject) => {
    const child = execFile(command, args, { cwd, stdio: "inherit" }, (error) => {
      if (error) reject(new Error(`${command} ${args.join(" ")} 失败：${error.message}`));
      else settle();
    });
    child.on("error", reject);
  });
}

async function cargoBuild({ target, jobs }) {
  const args = ["build", "--release", "--bin", TOOL_ID];
  if (target.explicit) args.push("--target", target.triple);
  if (jobs !== undefined) args.push("--jobs", jobs);
  console.log(`[cua-driver] cargo ${args.join(" ")}（cwd=${WORKSPACE_DIR}）`);
  await run("cargo", args, WORKSPACE_DIR);
  return join(
    WORKSPACE_DIR,
    "target",
    ...(target.explicit ? [target.triple] : []),
    "release",
    target.executable,
  );
}

async function readBinaryVersion(binaryPath) {
  const { stdout } = await execFileAsync(binaryPath, ["--version"], { maxBuffer: 1024 * 1024 });
  const match = stdout.trim().match(VERSION_PATTERN);
  if (!match) throw new Error(`无法解析版本输出：${JSON.stringify(stdout.trim())}`);
  return match[1];
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function stage(builtBinary, target) {
  const directory = outputDirectory(target.platformKey);
  await mkdir(directory, { recursive: true });
  const binary = join(directory, target.executable);
  await copyFile(builtBinary, binary);
  await copyFile(LICENSE_PATH, join(directory, "LICENSE"));
  const version = await readBinaryVersion(binary);
  const revision = (await readFile(join(WORKSPACE_DIR, "UPSTREAM-REVISION"), "utf8")).trim();
  await writeFile(
    join(directory, "SOURCES.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        toolId: TOOL_ID,
        version,
        origin: "vendored-source-build",
        source: "https://github.com/trycua/cua",
        sourcePath: "libs/cua-driver/rust",
        upstreamRevision: revision,
        target: target.triple,
        license: "MIT",
        telemetry: "removed (PostHog reporting stripped; see third-party/cua-driver/README.md)",
        binary: {
          file: target.executable,
          sha256: await sha256(binary),
        },
      },
      null,
      2,
    )}\n`,
  );
  const size = (await stat(binary)).size;
  console.log(
    `[cua-driver] 已落盘 ${binary}（${(size / 1024 / 1024).toFixed(1)} MiB, v${version}）`,
  );
  return { binary, version };
}

async function checkStaged(target) {
  const binary = join(outputDirectory(target.platformKey), target.executable);
  try {
    await stat(binary);
  } catch {
    throw new Error(`未找到已落盘产物 ${binary}；先运行 node scripts/build-cua-driver.mjs`);
  }
  const version = await readBinaryVersion(binary);
  console.log(`[cua-driver] --check 通过：${binary} -> cua-driver ${version}`);
  return { binary, version };
}

async function main() {
  const target = resolveTarget();
  if (hasFlag("check")) {
    await checkStaged(target);
    return;
  }
  await stat(join(WORKSPACE_DIR, "Cargo.toml")).catch(() => {
    throw new Error(`缺少 vendored workspace：${WORKSPACE_DIR}`);
  });
  if (!hasFlag("skip-deps")) await ensureToolchain();
  const built = await cargoBuild({ target, jobs: readOption("jobs") });
  await stage(built, target);
}

try {
  await main();
} catch (error) {
  console.error(`[cua-driver] ${error.message}`);
  process.exitCode = 1;
}
