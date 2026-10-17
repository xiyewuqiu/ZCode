export type YCodeEnv = "test" | "production";
/** 安装包身份：决定应用名、app id、Electron 数据目录与更新策略；与后端环境 `YCodeEnv` 是两个轴。 */
export type YCodeProductFlavor = "production" | "preview";

// 非构建环境（如 e2e 测试的 mocha）下 define 不存在，用 typeof 检查 + fallback 避免 ReferenceError
declare const __YCODE_ENV__: string;
declare const __YCODE_PRODUCT_FLAVOR__: string;

export function normalizeYCodeEnv(value: string | undefined): YCodeEnv {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export const YCODE_ENV = normalizeYCodeEnv(
  typeof __YCODE_ENV__ !== "undefined" ? __YCODE_ENV__ : undefined,
);

/**
 * 身份缺省跟随后端环境（test → preview，production → production）。
 * 桌面构建通过 `YCODE_PREVIEW_IDENTITY=1` 显式注入 preview，得到连接生产后端的 Preview 包；
 * 未注入 define 的 bundle（web、CLI、测试）沿用旧的单轴语义。
 */
export function normalizeYCodeProductFlavor(
  _value: string | undefined,
  _ycodeEnv: YCodeEnv,
): YCodeProductFlavor {
  return "production";
}

export const YCODE_PRODUCT_FLAVOR = "production";
export const YCODE_APP_VERSION_ENV = "YCODE_APP_VERSION" as const;
export const YCODE_BUILD_COMMIT_ID_ENV = "YCODE_BUILD_COMMIT_ID" as const;

// ── 运行时环境变量（不经过编译打包，启动时从 process.env 读取） ──
// 启用调试模式，值为 inspect-brk 的端口号，如 YCODE_DEBUG=9230
export const RUNTIME_YCODE_DEBUG =
  typeof process !== "undefined" ? process.env.YCODE_DEBUG : undefined;

// 遥测开关、上报端点与 ARMS 环境映射已随上报链路一并移除：开源运行时不保留任何上报配置。
