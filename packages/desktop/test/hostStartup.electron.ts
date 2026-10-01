import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, type MessagePortMain } from "electron";
import { spawnHostProcess } from "../src/main/desktopHostProcess.js";
import { BroadcastHub } from "../src/main/broadcastHub.js";
import { HostMessageTypes, hostResponseMessageSchema } from "@zcode/shared";

async function main() {
  const profile = process.env.ZCODE_WINDOW_SMOKE_PROFILE;
  assert.ok(profile, "Use the isolated runner");
  app.setPath("userData", profile);
  await app.whenReady();
  const window = new BrowserWindow({ show: false });
  const configPath = join(profile, "builtin-provider.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      config: {
        providerConfigRules: { templateRules: [], providerRules: [] },
        modelConfigRules: {},
      },
    }),
  );
  const began = performance.now();
  let heldPort: MessagePortMain | undefined;
  const child = spawnHostProcess(
    window,
    "isolated-host-smoke",
    {
      type: HostMessageTypes.InitLocal,
      agentSpawnFallbackCwd: profile,
      zcodeBuiltinProviderConfigFilePath: configPath,
    },
    {
      hostProcessLocalEnv: { ZCODE_DATA_BASE_DIR: profile, ZCODE_BASE_URL: "http://127.0.0.1:9" },
      logger: { info() {}, warn: (...args) => console.warn(...args) },
      broadcastHub: new BroadcastHub(),
      windowHostProcessMap: new Map(),
      hostRunningTaskCountMap: new Map(),
    },
    {
      onPortReady: (port) => {
        heldPort = port;
      },
      registerBroadcast: false,
    },
  );
  assert.ok(heldPort, "onPortReady must receive the real Host service port before renderer load");
  const phases: string[] = [];
  const failures: unknown[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Host startup timeout: ${phases.join(",")}`));
      }, 20000);
      const exited = (code: number) => {
        cleanup();
        reject(new Error(`Host exited during startup: ${code}`));
      };
      const message = (payload: unknown) => {
        const result = hostResponseMessageSchema.safeParse(payload);
        if (!result.success || result.data.type !== "database-startup-state") return;
        phases.push(result.data.state.phase);
        if (result.data.state.phase === "ready") {
          cleanup();
          resolve();
        }
        if (result.data.state.phase === "failed") {
          cleanup();
          reject(new Error(JSON.stringify(result.data.state)));
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off("message", message);
        child.off("exit", exited);
      };
      child.on("message", message);
      child.on("exit", exited);
    });
    console.log(
      JSON.stringify({
        realHostStartupMs: Math.round(performance.now() - began),
        phases,
        heldServicePort: true,
        agentModelExecution: false,
      }),
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    heldPort.close();
    const exited = once(child, "exit", { signal: AbortSignal.timeout(5000) });
    child.postMessage({ type: HostMessageTypes.Dispose });
    try {
      await exited;
    } catch (error) {
      const killed = once(child, "exit", { signal: AbortSignal.timeout(5000) });
      child.kill();
      await killed;
      throw new Error("Host did not dispose within the shutdown budget", { cause: error });
    }
  } catch (error) {
    failures.push(error);
  } finally {
    window.destroy();
  }
  // 启动失败与退出失败都保留，不能让 finally 中的异常覆盖首个诊断。
  if (failures.length) throw new AggregateError(failures, "Isolated Host smoke failed");
}
void main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
