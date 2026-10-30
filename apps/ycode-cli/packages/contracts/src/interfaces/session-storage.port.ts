import type {
  SessionDatabaseOptimizeParams,
  SessionDatabaseOptimizeResult,
  SessionDatabaseStats,
  SessionStorageTarget,
  SessionStoragePreview,
  SessionPurgeParams,
  SessionPurgeResult,
} from "@ycode/shared/ycode-protocol-v4";

/** Agent 侧持久存储所有者；预检只读，永久删除是 CAS、可重试的独立操作。 */
export interface SessionStorageMaintenancePort {
  previewSessionStorage(target: SessionStorageTarget): Promise<SessionStoragePreview>;
  purgeSessionStorage(params: SessionPurgeParams): Promise<SessionPurgeResult>;
}

/**
 * 共享会话库维护端口。SQLite 文件归当前 Agent 进程所有；调用方只描述
 * “读取统计/确认整理”，不接触数据库路径、连接或文件系统。
 */
export interface SessionDatabaseMaintenancePort {
  getSessionDatabaseStats(): Promise<SessionDatabaseStats>;
  /**
   * 显式整理：checkpoint、PRAGMA optimize，并仅在阈值满足时 VACUUM。
   * 锁冲突或空间不足时返回 refused + reason，不抛出业务失败。
   */
  optimizeSessionDatabase(
    params: SessionDatabaseOptimizeParams,
  ): Promise<SessionDatabaseOptimizeResult>;
}
