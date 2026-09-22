// 电脑控制（cua-driver）内置 MCP server —— CLI bootstrap 侧的装配点。
//
// 与 built-in-node-repl.ts 同类：驱动不是用户配置的 MCP，也不来自插件 manifest，而是宿主
// 内建能力。唯一的门控事实由 desktop host 在 agent spawn env 里下发：
//
//   ZCODE_CUA_DRIVER_BINARY          随包驱动的绝对路径（设置页开启且有驱动时才有）
//   ZCODE_CUA_DRIVER_PERMISSION_MODE standard | bounded | unrestricted
//
// 为什么由 env 门控而不是读配置文件：驱动开关是 desktop 的 AppSettings（`computerControl`），
// CLI 侧没有（也不该有）该文件的读取权；host 按 spawn 时读设置，语义与代理 env 一致
// （改动后下次启动 agent 生效）。
//
// fail-closed：没有路径 / 路径已不存在 → 不注册。绝不在驱动缺失时注册一个必然连不上的
// MCP server，那会让每次会话都多一条连接失败与一堆假工具。

import { statSync } from "node:fs";
import type { McpServerConfig } from "@zcode/contracts";
import {
  CUA_DRIVER_MCP_ARGS,
  ZCODE_CUA_DRIVER_BINARY_ENV,
  ZCODE_CUA_DRIVER_MCP_SERVER_NAME,
  ZCODE_CUA_DRIVER_PERMISSION_MODE_ENV,
  isZCodeComputerControlPermissionMode,
  resolveCuaDriverMcpEnv,
} from "@zcode/shared";

/**
 * 工具调用超时取长预算：桌面自动化的合法动作（等窗口、拖拽、批量输入、截图）可能远超
 * 默认 60s，而超时是按工具调用计的——给短了会把「慢但在跑」的驱动动作误判成失败。
 * 与内置 node_repl 的宿主工具保持同一量级。
 */
const COMPUTER_CONTROL_MCP_TIMEOUT_MS = 600_000;

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function resolveBuiltInComputerControlMcpServers(input: {
  env?: NodeJS.ProcessEnv;
}): Record<string, McpServerConfig> {
  const env = input.env ?? process.env;
  const binaryPath = env[ZCODE_CUA_DRIVER_BINARY_ENV]?.trim();
  if (!binaryPath || !isExistingFile(binaryPath)) {
    return {};
  }

  const rawPermissionMode = env[ZCODE_CUA_DRIVER_PERMISSION_MODE_ENV]?.trim();
  // 取值非法（旧 host、被手工改过的 env）时回落 standard：驱动默认档就是 standard，
  // 而「非法值 → 假设 unrestricted」会把用户的桌面完全敞开。
  const permissionMode = isZCodeComputerControlPermissionMode(rawPermissionMode)
    ? rawPermissionMode
    : "standard";

  return {
    [ZCODE_CUA_DRIVER_MCP_SERVER_NAME]: {
      type: "stdio",
      command: binaryPath,
      // MCP 子命令只有一个子命令参数（`cua-driver mcp-config` 给出的形态）；
      // 权限档位是 serve-only CLI 参数，`cua-driver mcp` 收到会直接 exit 64，只能走 env。
      args: [...CUA_DRIVER_MCP_ARGS],
      env: resolveCuaDriverMcpEnv(permissionMode),
      // 一个 workspace 共享一个驱动进程：驱动自带会话/光标/录制状态，按 session 复制进程
      // 会让同一台桌面上出现多个运行时互相抢前台焦点。
      isolation: "workspace",
      timeoutMs: COMPUTER_CONTROL_MCP_TIMEOUT_MS,
    },
  };
}
