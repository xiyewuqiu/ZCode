// 电脑控制（cua-driver）→ ZCode Agent spawn env。
//
// 为什么在这里：开关属于 AppSettings（host 是设置权威），驱动路径属于随包资源解析（desktop host），
// 而真正把这个能力变成模型可见工具的是 CLI bootstrap 的内置 MCP 装配。二者之间只应该有
// 「事实」而不应该有「实现」：host 下发驱动路径 + 权限模式，CLI 负责组装 MCP server 配置
// （常量与权限映射见 @zcode/shared 的 mcp.ts，三处共用避免字面量漂移）。
//
// 时序（与设置页代理 env 同一套语义：spawn 时读取，改动后下次启动 agent 生效）：
//
//   设置页开启 computerControl
//     → 下一次 agent spawn（新 workspace / agent 重启 / mcp 状态查询进程）
//     → resolveSpawnEnv 读设置 + 解析驱动路径
//     → spawn env: ZCODE_CUA_DRIVER_BINARY / ZCODE_CUA_DRIVER_PERMISSION_MODE
//     → CLI bootstrap 组装内置 MCP server（驱动缺失则不注册）
//     → 会话运行时出现 mcp__cua-driver__* 工具

import {
  ZCODE_CUA_DRIVER_BINARY_ENV,
  ZCODE_CUA_DRIVER_PERMISSION_MODE_ENV,
  type ZCodeComputerControlPermissionMode,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

const logger = createServiceLogger("computer-control");

export type ComputerControlSettingsSnapshot = {
  enabled: boolean;
  permissionMode: ZCodeComputerControlPermissionMode;
};

export function resolveComputerControlAgentSpawnEnv(input: {
  /** AppSettings.computerControl；老配置缺失时按「未开启」处理，不注册。 */
  computerControl: ComputerControlSettingsSnapshot | undefined;
  /** desktop host 解析出的随包驱动路径；没有驱动时为 undefined（enabled 也照样不注册）。 */
  driverBinaryPath: string | undefined;
}): Record<string, string> {
  if (input.computerControl?.enabled !== true) {
    return disabledComputerControlEnv();
  }

  const driverBinaryPath = input.driverBinaryPath?.trim();
  if (!driverBinaryPath) {
    // 开着开关却没有驱动：不注册 MCP（fail-closed）。
    // 这里只记一条 warn —— 用户可见事实由设置页的驱动状态卡（missing）承载，不在这里重复造状态。
    logger.warn(undefined, "[computer-control] 已启用但随包驱动缺失，本次不注册内置 MCP", {
      permissionMode: input.computerControl.permissionMode,
    });
    return disabledComputerControlEnv();
  }

  return {
    [ZCODE_CUA_DRIVER_BINARY_ENV]: driverBinaryPath,
    // 模式只透传，不在 host 侧翻译成驱动 env：MCP server 的 env 必须落在驱动子进程上，
    // 放进 agent 进程 env 会让驱动授权变量泄漏给 Bash/其它 MCP 子进程（见 shared/mcp.ts）。
    [ZCODE_CUA_DRIVER_PERMISSION_MODE_ENV]: input.computerControl.permissionMode,
  };
}

/**
 * 「不注册」也要显式写空值：agent spawn env 是「继承 process.env + patch」的合并，
 * 缺键盖不住外部残留的同名值（dev 的 .env 加载、手工 export、或某个宿主误设），
 * 那会让设置页关掉后 agent 仍注册驱动。host 是这里唯一的决策者，关闭态必须把键清成空
 * （CLI 侧把空值当缺省，见 built-in-computer-control.ts）。
 */
function disabledComputerControlEnv(): Record<string, string> {
  return {
    [ZCODE_CUA_DRIVER_BINARY_ENV]: "",
    [ZCODE_CUA_DRIVER_PERMISSION_MODE_ENV]: "",
  };
}
