import { mkdirSync, appendFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { formatTimestamp } from "@zcode/shared";
import { cleanupExpiredLogFiles, LOG_RETENTION_DAYS } from "./logRetention.js";
import { getAppConfigDir, maybeThrowInjectedFsFault } from "@zcode/services/node";

function getLogDir() {
  const e2eLogDir =
    process.env.ZCODE_ENV === "test" ? process.env.ZCODE_E2E_RUNTIME_LOG_DIR?.trim() : undefined;
  if (e2eLogDir) {
    return e2eLogDir;
  }
  return join(getAppConfigDir(), "logs");
}

// 目录在模块加载时确定并创建一次；写入热路径不再每次重算目录/重建目录。
const LOG_DIR = getLogDir();
mkdirSync(LOG_DIR, { recursive: true });

const logRetentionResult = cleanupExpiredLogFiles(LOG_DIR);
if (logRetentionResult.failedFiles.length > 0) {
  safeConsoleWrite(
    "warn",
    `[log-retention] failed to delete expired logs from ${LOG_DIR}:`,
    logRetentionResult.failedFiles,
    `retentionDays=${LOG_RETENTION_DAYS}`,
  );
}

type LogLevel = "debug" | "info" | "warn" | "error";

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EPIPE"
  );
}

function ignoreBrokenPipeStreamError(error: Error): void {
  // WDIO / dev runner 结束后可能先关闭 stdout/stderr 管道，随后主进程日志还在刷新。
  // stream error 是异步事件，try/catch 包 console.log 不一定兜得住；这里统一吞掉 EPIPE。
  if (!isBrokenPipeError(error)) {
    throw error;
  }
}

process.stdout.on("error", ignoreBrokenPipeStreamError);
process.stderr.on("error", ignoreBrokenPipeStreamError);

function safeConsoleWrite(level: LogLevel, ...args: unknown[]): void {
  const consoleFn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  try {
    consoleFn(...args);
  } catch (error) {
    // dev 脚本或父终端退出后，Electron main 的 stdout/stderr 管道可能已关闭。
    // 这时 console.* 会抛 EPIPE，不能让日志输出反过来杀掉主进程；文件日志仍会继续写入。
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---- 异步写盘队列 ----
// 之前 write() 每条日志都 mkdirSync + appendFileSync 同步落盘；hostLogRelay 把 Host/CLI
// 子进程每行 stdout 都转成 logger 调用，消息转发关键路径上因此出现同步 IO，renderer 日志
// 转发（fromRenderer）同样受影响。现在改为：日志先进内存队列，由串行 flush 链用
// fs.promises.appendFile 批量落盘（16ms 合并窗口，单批超过 64KB 立即落盘）；console 输出
// 保持同步，dev 观感与日志顺序不变。正常退出走 index.ts 的 before-quit 屏障（秒级预算，
// 异步 flush 有充足时间完成）；崩溃/强杀场景由下方 process.on("exit") 同步 flush 兜底。
const LOG_FLUSH_INTERVAL_MS = 16;
// 阈值按 UTF-16 长度近似估算字节量，仅作提前落盘触发，不要求精确。
const LOG_FLUSH_BYTES_THRESHOLD = 64 * 1024;

interface PendingLogEntry {
  filePath: string;
  line: string;
}

let pendingEntries: PendingLogEntry[] = [];
let pendingEntriesLength = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushChain: Promise<void> = Promise.resolve();

// 文件路径按日期缓存：只在跨天时重算并重建目录（目录可能被用户/清理脚本删除后自愈）。
let currentLogDateKey = formatDate(new Date());
let currentLogFilePath = join(LOG_DIR, `${currentLogDateKey}.log`);

function resolveLogFilePath(now: Date): string {
  const dateKey = formatDate(now);
  if (dateKey !== currentLogDateKey) {
    currentLogDateKey = dateKey;
    currentLogFilePath = join(LOG_DIR, `${dateKey}.log`);
    try {
      mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      // 目录重建失败交给 appendFile 的统一失败兜底
    }
  }
  return currentLogFilePath;
}

function flushPendingEntriesSync(): void {
  if (pendingEntries.length === 0) {
    return;
  }
  const entries = pendingEntries;
  pendingEntries = [];
  pendingEntriesLength = 0;
  // exit 回调只能同步 IO；按文件聚合后一次性补写，避免队列内日志随进程丢失。
  const chunksByFile = new Map<string, string>();
  for (const entry of entries) {
    chunksByFile.set(entry.filePath, (chunksByFile.get(entry.filePath) ?? "") + entry.line);
  }
  for (const [filePath, chunk] of chunksByFile) {
    try {
      appendFileSync(filePath, chunk);
    } catch {
      // 退出路径上的兜底失败无法恢复，静默
    }
  }
}

// 崩溃 / 强杀场景下 async flush 来不及执行，exit 回调同步补写是最后屏障。
process.on("exit", flushPendingEntriesSync);

async function runFlush(entries: PendingLogEntry[]): Promise<void> {
  // 同一批次内按文件分组（日常全部命中同一文件），每组一次 appendFile 减少系统调用。
  let index = 0;
  while (index < entries.length) {
    const filePath = entries[index].filePath;
    let groupEnd = index;
    while (groupEnd < entries.length && entries[groupEnd].filePath === filePath) {
      groupEnd += 1;
    }
    const chunk = entries
      .slice(index, groupEnd)
      .map((entry) => entry.line)
      .join("");
    index = groupEnd;
    try {
      maybeThrowInjectedFsFault({ operation: "appendFile", path: filePath });
      await appendFile(filePath, chunk);
    } catch {
      // 日志写入失败不应影响应用运行
    }
  }
}

function flushQueueAsync(): Promise<void> {
  if (pendingEntries.length === 0) {
    return flushChain;
  }
  const entries = pendingEntries;
  pendingEntries = [];
  pendingEntriesLength = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // 串行链保证落盘顺序与入队顺序一致；上一轮失败不阻断后续批次。
  const chained = flushChain.then(
    () => runFlush(entries),
    () => runFlush(entries),
  );
  flushChain = chained.catch(() => {});
  return chained;
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueueAsync();
  }, LOG_FLUSH_INTERVAL_MS);
  // unref：日志 flush 不阻止进程自然退出；退出兜底见 exit 监听。
  flushTimer.unref?.();
}

function write(level: LogLevel, source: string, ...args: unknown[]) {
  const now = new Date();
  const ts = formatTimestamp(now);
  const pid = process.pid;
  const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  const line = `[${ts}] [${level}] [pid:${pid}] [${source}] ${message}\n`;
  const filePath = resolveLogFilePath(now);

  // 同时保留 console 输出，方便开发调试；console 也加时间戳和 PID，与文件格式对齐
  safeConsoleWrite(level, `[${ts}] [pid:${pid}] [${source}]`, ...args);

  pendingEntries.push({ filePath, line });
  pendingEntriesLength += line.length;
  if (pendingEntriesLength >= LOG_FLUSH_BYTES_THRESHOLD) {
    void flushQueueAsync();
    return;
  }
  scheduleFlush();
}

/**
 * main 进程日志，默认写入 ~/.zcode/v2/logs/YYYY-MM-DD.log；E2E 测试使用 worker 专属目录。
 * 同时保留 console 输出方便开发调试；文件写入经内存队列异步批量落盘（见上方队列注释）。
 */
export const logger = {
  // 高频 browser/CDP 等协议细节只在本地开发记录，避免生产日志量与命令流同数量级。
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      write("debug", "main", ...args);
    }
  },
  info: (...args: unknown[]) => write("info", "main", ...args),
  warn: (...args: unknown[]) => write("warn", "main", ...args),
  error: (...args: unknown[]) => write("error", "main", ...args),

  /** renderer 日志通过 IPC 传入后调用此方法写入同一文件 */
  fromRenderer: (level: LogLevel, args: unknown[]) => write(level, "renderer", ...args),
};
