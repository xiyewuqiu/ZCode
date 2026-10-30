import type { Event } from "@ycode/rpc";
import type {
  RemoteTarget,
  SourceServerUpdateRequest,
  SourceServerMigrationReport,
  SourceServerManagementSnapshot,
  SourceServerManagementSnapshotRequest,
  SourceServerManagementDirectoryDelta,
  SourceServerManagementStateDelta,
  SourceServerOperationLog,
} from "@ycode/shared";
import { ServiceChannels } from "@ycode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface UpdateConnectionProfileInput {
  profileId: string;
  profileDisplayName: string;
  sourceDisplayName?: string;
  target: Exclude<RemoteTarget, { kind: "server" }>;
  sshAuthMethod?: "password" | "privateKey";
}

export interface AddSourceServerProfileInput {
  /** SSH/WSL/Docker 目标；SSH secret 只在本次调用内使用，由 Directory 转为 credential key。 */
  target: Exclude<RemoteTarget, { kind: "server" }>;
  membershipIntent?: "add" | "retain";
  /** 仅显式确认后允许安装缺失的 Source Server。 */
  allowInstall?: boolean;
  confirmIdentityChange?: boolean;
}

export interface ISourceServerManagementService {
  readonly onDidChangeState: Event<SourceServerManagementStateDelta>;
  readonly onDidChangeDirectory: Event<SourceServerManagementDirectoryDelta>;
  /** Desktop Host 的连接/更新日志变更通知；历史由 Host 内存 owner 保留。 */
  readonly onDidAppendOperationLog?: Event<SourceServerOperationLog>;
  /** 显式进入/刷新页面时请求更新统计；事件刷新只读取已有投影，避免反馈轮询。 */
  getSnapshot(
    options?: SourceServerManagementSnapshotRequest,
  ): Promise<SourceServerManagementSnapshot>;
  getRecentOperationLogs(profileId: string): Promise<SourceServerOperationLog[]>;
  /** 新增连接目标：Directory 复用/创建 Profile，Manager 决定物理连接归属。 */
  addProfile(input: AddSourceServerProfileInput): Promise<SourceServerManagementSnapshot>;
  connectProfile(
    profileId: string,
    options?: { retainedOnly?: boolean },
  ): Promise<SourceServerManagementSnapshot>;
  confirmIdentityChange(profileId: string): Promise<SourceServerManagementSnapshot>;
  disconnectSource(sourceServerId: string): Promise<SourceServerManagementSnapshot>;
  ensureConversationWorkspace(sourceServerId: string): Promise<{
    path: string;
    created: boolean;
    workspacePurpose: "conversation";
  }>;
  updateSource(input: SourceServerUpdateRequest): Promise<SourceServerManagementSnapshot>;
  renameSource(
    sourceServerId: string,
    displayName: string,
  ): Promise<SourceServerManagementSnapshot>;
  renameProfile(profileId: string, displayName: string): Promise<SourceServerManagementSnapshot>;
  updateProfile(input: UpdateConnectionProfileInput): Promise<SourceServerManagementSnapshot>;
  setPreferredProfile(
    sourceServerId: string,
    profileId: string,
  ): Promise<SourceServerManagementSnapshot>;
  removeProfile(profileId: string): Promise<SourceServerManagementSnapshot>;
  removeSourceServer(sourceServerId: string): Promise<SourceServerManagementSnapshot>;
  getMigrationReport(sourceServerId: string): Promise<SourceServerMigrationReport>;
  exportMigrationReport(sourceServerId: string): Promise<string>;
  abandonWorkspaceMigration(
    sourceServerId: string,
    workspacePath: string,
    migrationId: string,
  ): Promise<SourceServerMigrationReport>;
  retryWorkspaceMigration(
    sourceServerId: string,
    workspacePath: string,
    migrationId: string,
  ): Promise<SourceServerMigrationReport>;
}

export const ISourceServerManagementService =
  createServiceDescriptor<ISourceServerManagementService>(ServiceChannels.SourceServerManagement);
