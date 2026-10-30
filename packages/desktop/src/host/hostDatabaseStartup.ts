import {
  getTasksIndexDatabasePath,
  markTasksStoragePrepared,
  resolveYCodeAgentSpawnCwd,
} from "@ycode/services/storage-startup";
import { createSettingService } from "@ycode/services/node";
import type { DatabaseStartupState } from "@ycode/shared";
import { DatabaseStartupCoordinator } from "./databaseStartupCoordinator.js";
import { prepareHostStorage, prepareSessionStorage } from "./storagePreparationProcesses.js";

export function createHostDatabaseStartup(options: {
  startupId?: string;
  cwd: string;
  workingDirectories?: string[];
  env?: Record<string, string>;
  /** 持库 Host 身份；桌面本地 Host 缺省为 local。 */
  projectStorageHostId?: string;
  publish: (state: DatabaseStartupState) => void;
  initializeServices: () => Promise<void>;
  onFailure: (error: unknown) => void;
}) {
  const abort = new AbortController();
  const coordinator = new DatabaseStartupCoordinator({
    startupId: options.startupId,
    publish: options.publish,
    prepare: async (report) => {
      const preparedPaths = new Set<string>();
      try {
        // 1. 任务索引极速同进程就绪（< 3ms），彻底消除多线程 Worker 启动与跨进程通信开销
        const tasksPath = getTasksIndexDatabasePath();
        // 项目迁移与任务库共用同一启动屏障；必须携带旧 settings 才能完成首次项目导入。
        const settings = await createSettingService().get();
        await prepareHostStorage(
          tasksPath,
          (phase, migration) =>
            report("preparing_host_storage", phase, { databaseId: "tasks-index", migration }),
          abort.signal,
          {
            lastWorkspaceSession: settings.lastWorkspaceSession,
            recentProjects: settings.recentProjects,
            sourceServers: settings.sourceServers,
            connectionProfiles: settings.connectionProfiles,
          },
          options.projectStorageHostId,
        );
        markTasksStoragePrepared(tasksPath);

        // 2. 核心服务立即初始化，不再在关键路径上串行阻塞等待 CLI 进程握手
        await options.initializeServices();

        // 3. 后台静默预热工作区会话存储（非阻塞，不拖累窗口秒开）
        const candidates = options.workingDirectories?.length
          ? options.workingDirectories
          : [options.cwd];
        void (async () => {
          try {
            const directories = new Set<string>();
            for (const candidate of candidates) {
              const { cwd } = await resolveYCodeAgentSpawnCwd({
                requestedCwd: candidate,
                workspacePath: candidate,
                spawnFallbackCwd: options.cwd,
              });
              directories.add(cwd);
            }
            for (const cwd of directories) {
              if (abort.signal.aborted) break;
              await prepareSessionStorage({
                cwd,
                env: options.env,
                signal: abort.signal,
                preparedPaths,
                report: () => {},
                observePath: async () => {},
              }).catch(() => {});
            }
          } catch {
            /* 诊断与预热失败不影响主应用 */
          }
        })();
      } catch (error) {
        try {
          options.onFailure(error);
        } catch {
          /* 诊断失败不覆盖原始错误。 */
        }
        throw error;
      }
    },
  });
  return {
    coordinator,
    dispose: () => {
      abort.abort();
    },
  };
}
