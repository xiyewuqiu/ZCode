# 本轮验证记录

2026-10-01，Windows。修改保留在当前工作区，未发布。

## 已落地

- `ConversationWorkWindow` 将长单轮工作记录限制为视口、6 项 overscan 与交互保留项；继续共享 Timeline 的唯一滚动容器。
- 模型查找可以命中离屏内容；折叠历史临时展开，按实际 ResizeObserver 布局变化校正查找位置，用户输入立即收回滚动权。清空查找或卸载释放监听。整轮复制读取完整模型。
- `useConversationProjection` 在文档隐藏期间跳过 React 通知，store 持续接收全部更新；显示时一次通知最新快照。没有暂停 Agent 或改动 owner/lease、Desktop continuous、Web replayable 协议。
- 修正 Host 启动的第六参误传，`onPortReady` 进入唯一 options；补全桌面工程覆盖、公共 preload 声明、当前 Electron / Node API 类型、传输信封类型与已有协议的对应关系。根 `typecheck` 现在检查 Main、Preload、Renderer 和原有 Host；清理与当前 production 身份不符的不可达 Preview 分支。
- 托盘图标路径允许宿主注入，隔离测试可调用实际托盘模块；原有调用维持默认资源路径。

## 实测

| 场景                                                                     | 结果                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 5,000 段 Markdown + 200 个压缩标记 + 100 轮，总计 5,797 行               | 5,201 个当前轮工作项仅挂载 17 项（两个视口均通过）                |
| 桌面 1258×622，20Hz 更新 + 164 帧采样                                    | 中位数 18ms、P95 38ms、最大 56.9ms、1 帧超过 50ms                 |
| 手机尺寸 390×844，同规模同采样                                           | 中位数 14.1ms、P95 28.4ms、最大 51.4ms、1 帧超过 50ms             |
| 每个视口各切换会话 10 次                                                 | 离开时卸载长列表，返回时保留完整历史与后台新增 token；通过        |
| 选择/清除选择、远处搜索、展开/折叠、输入、回到底部、完成态迁移、整轮复制 | 两个视口均通过；复制包含未挂载的早期工作正文                      |
| 隐藏时 1,000 次 store 更新                                               | 模型更新保留，隐藏期间不通知 UI，恢复时读取第 1,001 次状态；通过  |
| 真实 Window Host / 数据库 / 预热 MessagePort                             | 隔离目录启动就绪，最终复测约 503ms；正常 dispose                  |
| Windows Electron 原生窗控                                                | zoom -3/0/5、最大化/还原、隐藏、实际托盘 click 回调恢复、关闭通过 |
| 当前显示器 DPI                                                           | 一块显示器，scaleFactor 1.5；renderer DPR 匹配                    |

浏览器使用本机 Edge headless 和 Vite 开发构建。帧耗时受同机编译、采样负载影响；同规模其他采样 P95 曾为桌面 31.2ms / 手机 20.2ms，不选择最低值冒充稳定性能。截图位于 `.tmp/desktop-iteration/`。

## 检查

- 根 `typecheck` 通过（包含新加入的全部 Desktop target）；单独 UI/桌面测试工程类型检查通过。
- 根 `lint` 为 0 错误、63 条既有警告；测试脚本新增的清理异常告警已修复。
- `architecture:check --changed` 通过：baseline 0、new 0、violations 0。变更涉及 ui、shared、client、desktop，状态所有者与事件顺序见本轮 spec。
- 对 104 个实际变更文件执行格式化，最终定向格式检查与 `git diff --check` 通过；未格式化全仓。
- 累计未提交生产源码新增 1,673 行、删除 895 行，净增 778 行（仅 `packages/*/src` 下源码，含前几轮修改，不含测试、文档、配置与脚本）；没有新增依赖。
- 24 项受影响单测通过；批量归约、历史缓存、摘要、隐藏通知和既有 Agent 退役边界均保留。
- Windows 测试退出时出现 Chromium `GPU state invalid after WaitForGetOffsetInRange` 诊断；功能断言与进程退出码为成功，未据此宣称无 GPU 问题。

## 仍未覆盖

- 真实 Agent 模型持续执行与完整 SessionPane/Host/Agent 联合压力；本次 Host 证据是启动与端口交接，浏览器消息为合成数据。
- Windows Snap 浮层的实际鼠标交互、异构 DPI 多屏切换；当前仅有一块 150% 缩放显示器。
- 无限长度、单条超大 Markdown 内部虚拟化、整个产品全部页面。当前帧数据仍有超过 50ms 的样本，不能称为全场景恒定 60 FPS。
