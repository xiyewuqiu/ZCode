import { realpath } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { Worker } from "node:worker_threads";
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  classifyDatabaseStartupError,
  databaseStartupErrorCodeSchema,
  databaseMigrationFactsSchema,
  type DatabaseMigrationFacts,
  databaseStartupErrorDetailsSchema,
  zcodeStoragePreparationFrameSchema,
  type DatabaseStartupState,
} from "@zcode/shared";
import {
  prepareTasksIndexStorage,
  resolveDefaultZCodeAgentCommand,
} from "@zcode/services/storage-startup";

type Phase = NonNullable<DatabaseStartupState["databasePhase"]>;
const statusError = (
  kind: string,
  details?: {
    sqliteCode?: number;
    systemCode?: string;
    migrationId?: string;
    migration?: DatabaseMigrationFacts;
  },
  databaseId?: string,
) =>
  Object.assign(new Error(`Storage preparation failed: ${kind}`), {
    kind,
    errcode: details?.sqliteCode,
    code: details?.systemCode,
    migrationId: details?.migrationId,
    migrationUpdate:
      databaseId && details?.migration ? { databaseId, migration: details.migration } : undefined,
  });

export async function prepareHostStorage(
  path: string,
  report: (phase: Phase, migration?: DatabaseMigrationFacts) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw statusError("transport_closed");
  try {
    await prepareTasksIndexStorage(path, (phase, migration) => {
      if (signal.aborted) throw statusError("transport_closed");
      report(phase, migration);
    });
  } catch (error) {
    const migration = databaseMigrationFactsSchema.safeParse(
      error && typeof error === "object"
        ? (error as { startupMigration?: unknown }).startupMigration
        : undefined,
    );
    throw statusError(
      classifyDatabaseStartupError(error),
      {
        sqliteCode: (error as { errcode?: number })?.errcode,
        systemCode: (error as { code?: string })?.code,
        migrationId: (error as { migrationId?: string })?.migrationId,
        migration: migration.success ? migration.data : undefined,
      },
      "tasks-index",
    );
  }
}

/** 在 Host 所属 Worker 运行同一 CLI bundle 的存储入口；Host 退出不会留下持锁孤儿进程。 */
export async function prepareSessionStorage(options: {
  cwd: string;
  env?: Record<string, string>;
  signal: AbortSignal;
  report: (
    phase: Phase,
    details?: { databaseId: string; migration?: DatabaseMigrationFacts },
  ) => void;
  preparedPaths?: Set<string>;
  observePath: (path: string) => Promise<void>;
}): Promise<void> {
  const command = resolveDefaultZCodeAgentCommand({
    workspacePath: options.cwd,
    workspaceKey: options.cwd,
    presentationSurface: "desktop",
  });
  if (!command?.supportsStorageStartup || !command.storagePreparationEntry)
    throw statusError("unsupported_runtime");
  const entry = command.storagePreparationEntry;
  await new Promise<void>((resolve, reject) => {
    const child = new Worker(entry, {
      argv: ["app-server", "--stdio", "--prepare-storage", "--cwd", command.cwd ?? options.cwd],
      env: { ...process.env, ...options.env, ...command.env },
      stdin: true,
      stdout: true,
      stderr: true,
    });
    const input = child.stdin!;
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    let prepared = false;
    let pathReceived = false;
    let preparedPath: string | undefined;
    let failure: unknown;
    const terminate = () => {
      void child.terminate();
    };
    const abort = () => {
      failure ??= statusError("transport_closed");
      terminate();
    };
    const firstStateTimer = setTimeout(() => {
      failure = statusError("startup_status_timeout");
      terminate();
    }, 30_000);
    options.signal.addEventListener("abort", abort, { once: true });
    // stdout 只有有界控制帧，stderr 排空但不把可能含本地路径的原始文本上报。
    child.stderr.resume();
    input.on("error", (error) => {
      failure ??= error;
      terminate();
    });
    lines.on("line", (line) => {
      try {
        if (line.length > 65536) throw statusError("transport_closed");
        const frame = zcodeStoragePreparationFrameSchema.parse(JSON.parse(line));
        clearTimeout(firstStateTimer);
        if (frame.method === "startup/storagePath") {
          if (pathReceived) throw statusError("transport_closed");
          pathReceived = true;
          void (async () => {
            // 仅复用同一次准备中已成功关闭的真实库，不能按不同 cwd 误判为不同数据库。
            preparedPath = await realpath(frame.params.path).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return resolvePath(frame.params.path);
                throw error;
              },
            );
            if (settled || failure || options.signal.aborted) return;
            const reuse = options.preparedPaths?.has(preparedPath) ?? false;
            if (!reuse) await options.observePath(frame.params.path);
            if (!settled && !failure && !options.signal.aborted)
              input.write(`${JSON.stringify({ method: "startup/storagePathReady", reuse })}\n`);
          })().catch((error) => {
            failure ??= error;
            terminate();
          });
        } else if (frame.method === "startup/storagePrepared") {
          prepared = pathReceived;
          input.end();
        } else if (frame.params.phase === "failed")
          failure ??= statusError(
            frame.params.errorCode ?? "sql_failed",
            frame.params,
            frame.params.databaseId,
          );
        else
          options.report(frame.params.phase, {
            databaseId: frame.params.databaseId,
            migration: frame.params.migration,
          });
      } catch (error) {
        failure ??= error;
        terminate();
      }
    });
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("exit", (code) => {
      settled = true;
      clearTimeout(firstStateTimer);
      options.signal.removeEventListener("abort", abort);
      lines.close();
      if (code === 0 && prepared && !failure) {
        if (preparedPath) options.preparedPaths?.add(preparedPath);
        resolve();
      } else reject(failure ?? statusError("transport_closed"));
    });
    if (options.signal.aborted) abort();
  });
}
