import {
  connectServerRemoteOverDuplex,
  type ServerRemoteConnection,
  type ServerRemoteDuplexConnectionOptions,
} from "./serverRemoteConnection.js";

/**
 * Desktop 私有初始化跟随物理 Source 连接，每次重连重新建立。
 *
 * 本仓库未移植 bots/topic-resource 反向通道与 dynamic workflow mode 同步（本地无
 * IBotsService 对应协议，且 IYCodeAgentService 未暴露 workflow 方法）；这里只保留
 * 物理连接的建立/释放。接入 UI/API 时若恢复这些能力，应在同一代连接上创建并
 * 在 dispose/onClose 中释放。
 */
export async function connectDesktopSourceServer(
  options: ServerRemoteDuplexConnectionOptions,
  deps: {
    connectServer?: typeof connectServerRemoteOverDuplex;
  } = {},
): Promise<ServerRemoteConnection> {
  return await (deps.connectServer ?? connectServerRemoteOverDuplex)(options);
}
