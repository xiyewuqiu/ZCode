import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { build } from "tsup";

assert.equal(process.platform, "win32", "Native window smoke requires Windows");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = join(root, "node_modules/.cache/zcode-window-smoke");
const hostSmoke = process.argv.includes("--host");
const testName = hostSmoke ? "hostStartup" : "windowChrome";
await build({
  entry: {
    [`main/${testName}.electron`]: fileURLToPath(
      new URL(`./${testName}.electron.ts`, import.meta.url),
    ).replaceAll("\\", "/"),
  },
  outDir: output,
  format: [hostSmoke ? "esm" : "cjs"],
  target: "node24",
  external: ["electron", "node-pty", "ssh2", "undici", "yaml", "node-forge", "yauzl", "yazl"],
  noExternal: [/^@zcode\//],
  dts: false,
  config: false,
});
if (hostSmoke)
  await build({
    entry: {
      "host/index": join(root, "packages/desktop/src/host/index.ts"),
      "host/tasksStorageWorker": join(root, "packages/desktop/src/host/tasksStorageWorker.ts"),
    },
    outDir: output,
    format: ["esm"],
    target: "node24",
    config: false,
    dts: false,
    external: ["electron", "node-pty", "ssh2", "undici", "yaml", "node-forge", "yauzl", "yazl"],
    noExternal: [/^@zcode\//],
  });
const tempRoot = await realpath(tmpdir());
const profile = await mkdtemp(join(tempRoot, "zcode-window-smoke-"));
try {
  const environment = {
    ...process.env,
    ZCODE_WINDOW_SMOKE_PROFILE: profile,
    ZCODE_WINDOW_SMOKE_ICON: join(root, "packages/desktop/build/icon.ico"),
    ZCODE_DATA_BASE_DIR: profile,
    ZCODE_BASE_URL: "http://127.0.0.1:9",
    ZCODE_DESKTOP_APPLICATION_NAME: "ZCode isolated smoke",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(
      electronPath,
      [join(output, `main/${testName}.electron.${hostSmoke ? "js" : "cjs"}`)],
      {
        cwd: root,
        env: environment,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 40000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error("Isolated Electron smoke timed out"));
      else resolveExit(exitCode ?? 1);
    });
  });
  process.exitCode = code;
} finally {
  // 只删除本次创建的临时 profile；Electron 退出后再清理，避免锁文件残留。
  const target = await realpath(profile);
  assert.equal(dirname(target).toLowerCase(), resolve(tempRoot).toLowerCase());
  assert.ok(basename(target).startsWith("zcode-window-smoke-"));
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
