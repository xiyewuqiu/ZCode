// 电脑控制（cua-driver）驱动状态探测服务 —— services 侧 descriptor 注册。
//
// 契约：UI 通过 `IServiceAccessor.getComputerControlDriverStatus()` 读取驱动状态，
// 只有随包分发了 cua-driver 的 host（desktop local host）才注册本频道；其它 host
// （Web/远端环境/测试 double）不注册，调用会 reject，由 UI 回落「未知」。
//
// 探测实现属于宿主能力（需要文件系统与子进程），放在 desktop host 侧，并通过
// createLocalServices 的注入点装配；本文件只持有类型与 descriptor，保持 browser-safe
// （UI/renderer 只从 @zcode/services 根入口引入类型与 channelName）。

import { ServiceChannels } from "@zcode/shared";

import { createServiceDescriptor } from "../descriptors.js";

/**
 * 驱动状态：
 * - `ready`：驱动文件存在且能读到版本号；
 * - `missing`：随包/开发态目录里没有驱动文件；
 * - `unknown`：驱动存在但探测失败（进程起不来、超时、版本输出无法解析）。
 */
export type ComputerControlDriverState = "ready" | "missing" | "unknown";

export interface ComputerControlDriverStatus {
  state: ComputerControlDriverState;
  /** 仅 `state = "ready"` 时提供，形如 `0.28.2`。 */
  version?: string;
}

/** 驱动状态探测服务面；由 desktop host 注入的探测函数实现。 */
export interface IComputerControlDriverStatusService {
  getComputerControlDriverStatus(): Promise<ComputerControlDriverStatus>;
}

/** 注入给 createLocalServices 的探测函数；返回 rejected promise 会被转成 `unknown`。 */
export type ComputerControlDriverStatusProbe = () => Promise<ComputerControlDriverStatus>;

export const IComputerControlDriverStatusService =
  createServiceDescriptor<IComputerControlDriverStatusService>(
    ServiceChannels.ComputerControlDriver,
  );
