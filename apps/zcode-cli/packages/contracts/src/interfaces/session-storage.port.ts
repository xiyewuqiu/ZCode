import type {
  SessionStorageTarget,
  SessionStoragePreview,
  SessionPurgeParams,
  SessionPurgeResult,
} from "@zcode/shared/zcode-protocol-v4";

/** Agent 侧持久存储所有者；预检只读，永久删除是 CAS、可重试的独立操作。 */
export interface SessionStorageMaintenancePort {
  previewSessionStorage(target: SessionStorageTarget): Promise<SessionStoragePreview>;
  purgeSessionStorage(params: SessionPurgeParams): Promise<SessionPurgeResult>;
}
