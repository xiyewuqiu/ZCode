/**
 * 兼容入口：启动屏障的实际实现已迁移到 project-storage。
 * 保留本文件避免既有调用方和 Worker 构建入口在迁移期间断开。
 */
export {
  prepareTasksIndexStorage,
  type TasksStoragePhase,
} from "#src/project-storage/startup.js";
