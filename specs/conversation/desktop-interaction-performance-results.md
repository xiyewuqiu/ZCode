# 桌面交互迭代验证记录

> 这是前一阶段记录。后续已修复桌面类型诊断、将全部 Desktop target 纳入根检查、实现工作项虚拟化，并验证托盘恢复和真实 Host 启动。当前结果见 [最新验证记录](desktop-performance-iteration-results.md)；下文保留当时的证据与限制。

验证日期：2026-10-01。沿用上一轮长会话缓存、批量 delta 和离屏排版优化，本轮补齐完整 SessionPane 内的分享派生计算与桌面交互。

当前累计源码差异：新增 476 行、删除 176 行，净增 300 行（不含测试与文档）。没有新增运行时依赖。

## 已实现

- SessionPane 通过 useConversationShareModel 按需生成分享候选和一次性行索引。普通聊天不读取分享历史，退出分享释放缓存。workspace identity / remote session / session / logEpoch 隔离；选择和预检保留原有所有者。
- 同一 projection store 的订阅函数稳定；换 store 和卸载准确退订。没有降低流式更新频率，也没有暂停后台任务。
- Windows 原生标题栏按钮；主界面、侧栏、设置、引导统一复用避让区域。preload 同步初态和 Main 几何事件使用相同平台契约。Linux 自绘与 macOS 红绿灯保持原行为。
- Panel 展开/收起读取当前系统动画偏好，侧栏 CSS 也遵循减少动画；普通窗口 resize 仍不挂尺寸 transition。
- 两个设置页入口共用主题一致的懒加载壳，保留返回与窗口操作。

## 实际验证

| 检查                           | 结果                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| 根 `corepack pnpm typecheck`   | 通过；根命令不包含 desktop main/preload                                       |
| 根 `corepack pnpm lint`        | 0 错误、63 条既有警告                                                         |
| `architecture:check --changed` | baseline 0，新增 0；涉及 ui、shared、desktop                                  |
| shared/UI 定向测试             | 19 项通过（4 批量投影、9 长会话与分享、6 现有兼容行为）                       |
| UI 浏览器 fixture 类型检查     | 通过                                                                          |
| desktop preload 类型检查       | 通过；补齐了此前缺失的公共窗控类型导出                                        |
| 原生窗控测试类型检查           | 通过                                                                          |
| Electron 独立窗口              | 原生 overlay 可见，zoom -3/0/5 后标题栏均约 48 CSS px；最大化、恢复、关闭通过 |
| 浏览器 hook/组件交互           | 1258×622 普通动画、390×844 减少动画均通过                                     |

浏览器覆盖实际 SessionPane 使用的两个 hook、实际 Panel 动画 hook、实际窗控和设置加载壳。断言分享关闭和关闭后的流式更新均不读取行内容；20 次 store 更新全部到达且只订阅一次；换 store 与卸载共两次退订；相同 row id 跨 scope 后候选刷新；缩放事件更新避让宽度；面板可收放；加载页可返回且无水平溢出。另检查了 Zai Dark 窄视口加载壳。

本轮重跑算法样本：20,000 行 / 256 delta 从顺序归约 78.2ms 到批处理 2.0ms；1,000 轮 / 50 次尾部更新从完整重建 399.0ms 到缓存 25.6ms。数值是本机合成场景观测，不是所有会话的保证。上一轮滚动测试详见 `long-session-performance-results.md`。

## 未通过与限制

- desktop main 全量独立类型检查仍有 84 条诊断。使用相同编译配置，将本轮修改的 desktop 文件在编译器内替换为 Git HEAD 内容比对，原始实现和当前实现均为 84，新增为 0。错误包括现有 rootDir、browserGuestManager、taskRealtimeBus 等问题；没有将此检查记为通过。
- 未启动含真实 Host/Agent 的完整桌面工作区。浏览器 fixture 使用合成数据和平台适配器，不能替代真实长会话、多窗口和远程重连验收。
- Windows Snap 浮层、任务栏交互、系统 DPI 多屏切换、托盘恢复，以及 macOS/Linux 实机未验证。已验证的是 Electron 原生 overlay 几何和窗口生命周期。
- 单轮工作项仍保留完整 DOM；content-visibility 降低离屏排版成本，但未实现无界历史下恒定内存。分享打开时仍会整理当前候选，不宣称所有派生计算均为常数复杂度。
- 三个早期测试临时 profile 的清理命令被自动审批以策略拦截拒绝，目录仍保留；最终测试运行器自身创建的 profile 已验证正常清理。

## 复现

浏览器命令见 `packages/ui/test/browser/README.md`。Windows 原生测试从仓库根目录运行：

```powershell
node packages/desktop/test/run-window-chrome.mjs
corepack pnpm exec tsc -p packages/desktop/test/tsconfig.window-chrome.json
corepack pnpm exec tsc -p packages/desktop/tsconfig.preload.json --noEmit --composite false --incremental false
```

原生测试自动打包到 node_modules 缓存、创建独立临时 profile，并在 Electron 退出后校验路径后清理，不访问生产用户数据。
