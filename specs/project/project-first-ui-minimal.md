# 项目优先 UI 最小切片（已由 project-sidebar-full.md 取代）

> 现行项目侧栏规范见 [project-sidebar-full.md](./project-sidebar-full.md)。本文件仅保留为最小切片的交付记录。

本切片在已交付的 `IProjectService` / `IRemoteProjectService` / Source Server 后端之上，提供最小可用的项目入口 UI。不重写既有 workspace shell、任务导航、side pane 与 full view。

## 产品语义

- 项目优先 UI 只是**读取投影**和**动作入口**，不拥有项目组织态。项目、roots、任务归属仍由持库 Host 的 `tasks-index.sqlite` 与 `IProjectService` 唯一拥有；远端入口由 `IRemoteProjectService` 唯一拥有。
- 侧栏项目目录（Project directory）读取本机 Host 的 `projectService.readProjects()` 与本机持有的远端入口 `remoteProjectService.readDirectory()`，展示：
  - 本机项目及其 `primaryRootStatus`（`available` / `missing` / `unavailable`）；
  - 远端 host 及其 `connectionStatus`（`online` / `connecting` / `offline`），以及其缓存的项目入口。
- 项目选择器（Project picker）只做两件事：
  - **打开**：选择本机项目 root 或远端入口，复用现有 `onStartDraftInWorkspace` / `onOpenRemoteWorkspace`；
  - **创建**：用 `projectService.readDirectory()` 浏览并选定一个已存在目录，再调用 `projectService.saveProject()` 创建项目并打开主目录。
- Source Server / 设备卡（settings）读取 `sourceServerManagementService.getSnapshot()` 与本机 `remoteProjectService.readDirectory()`，展示连接状态、迁移计数与迁移报告；只读展示与重试即可。
- 不新增任何项目/远端/迁移写入路径；所有写操作仍走既有服务合同。

## 状态所有者

| 状态                                    | 唯一所有者                                        | UI 读取方式                                                                                                                    |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 项目、roots、任务归属                   | 持库 Host `ProjectRepository` / `IProjectService` | `readProjects()` / `readDirectory()` / `readTree()`                                                                            |
| 主目录可用性                            | `createProjectService` 每次读取探测               | `VirtualProject.primaryRootStatus`                                                                                             |
| 本机远端入口                            | `createRemoteProjectService`                      | `IRemoteProjectService.readDirectory()`                                                                                        |
| host 连接运行态                         | 连接管理器（Host / Desktop）                      | `RemoteProjectHost.connectionStatus` / `SourceServerManagementSnapshot.states`                                                 |
| 迁移报告                                | Source Server 迁移服务                            | `sourceServerManagementService.getSnapshot()` / `getMigrationReport()` / `sourceServerWorkspaceService.listMigrationReports()` |
| 项目目录 UI 的 loading / error / 展开态 | React 组件局部 state                              | `useProjectDirectory`（不落 store）                                                                                            |
| 选择器输入、当前浏览目录、创建中状态    | React 组件局部 state                              | 组件内部                                                                                                                       |

UI 不缓存项目事实，不维护第二份项目列表；`state:projects` 广播只触发重新读取。

## 读取面与动作

### 侧栏项目目录（Project directory）

- 位置：`WorkspaceSidebar` 滚动区内、任务工具栏之前，新增可折叠区块（仅新增渲染，不改现有任务视图、滚动与 side pane 逻辑）。
- 数据：`useProjectDirectory()` 并行读取：
  - `projectService.readProjects()`；
  - `remoteProjectService.readDirectory()`。
- 状态：
  - 加载：骨架/`Spinner`；
  - 空：两侧均无项目时显示空态文案；
  - 错误：本机或远端各自错误独立展示，互不阻塞；提供重试；
  - 就绪：本机项目按 pinned + position 排序，远端按 host position + entry 顺序。
- 动作：
  - 点击本机项目 root → `onStartDraftInWorkspace(rootPath)`（复用既有 tab/draft 动作）；
  - 点击远端入口或“连接” → `onOpenRemoteWorkspace()`（复用既有 SSH/WSL/Docker 连接向导）；
  - “打开项目”按钮 → 打开项目选择器。

### 项目选择器（Project picker）

- 触发：侧栏项目目录区块头、项目区块 `+` 菜单新增“项目目录…”入口。
- **打开已有项目**：展示与本机/远端项目目录相同的列表；选择 root 后调用传入的 `onOpenProjectRoot`。
- **创建项目**：
  1. 输入项目名（可空，交给 `saveProject` 推导默认名）；
  2. 通过 `projectService.readDirectory({ path })` 浏览目录（默认从服务返回的 home 开始），只显示目录，支持返回上级/重新加载；
  3. 点击“使用此目录”后调用 `projectService.saveProject({ name?, roots: [path], primaryRoot: path })`；
  4. 成功后调用 `onOpenProjectRoot(savedPrimaryRoot)`，项目由 `state:projects` 广播刷新。
- 失败：服务缺失、目录不可读、保存拒绝（如 `project.directory-required`、`project.absolute-path-required`）都显示内联错误与重试；不伪造成功、不跳过校验。
- 远端项目不提供创建向导；远端新建仍走既有远端连接/项目流程。

### Source Server / 设备卡（settings）

- 新增设置分区 `devices`（标题“来源与设备” / “Sources & devices”）。
- 数据：
  - `sourceServerManagementService.getSnapshot()`：profiles、servers、`states`、`migrationCounts`；
  - `sourceServerManagementService.getMigrationReport(sourceServerId)`：选中设备的迁移报告行；
  - 无 management 服务时回退到 `remoteProjectService.readDirectory()`，仅展示 host 连接状态与入口数量。
- 展示：设备卡（名称、传输类型、连接状态、最近错误、迁移计数）；迁移报告只读列表（状态、路径、更新时间、错误码）。
- 重试：重新读取快照；`offline`/`failed` 且可重试时允许调用 `connectProfile(profileId)`（仅桌面 Host 提供）。
- 不实现新增/删除设备、凭据编辑、更新安装、工作区迁移执行；只读与重试。

## 导航与既有逻辑

- 不修改 `WorkspaceShellLayout` 的滚动、side pane、full view、pane 布局与 resize 逻辑；只通过 `WorkspaceSidebar` 新增区块与既有回调接线。
- 复用：
  - `onStartDraftInWorkspace`（项目草稿/new task）；
  - `onOpenRemoteWorkspace`（远程连接向导）；
  - `tabStore.addTab` / `activateTabByPath`（由既有动作内部完成）。
- 设置页只新增 `devices` 分区渲染分支与导航配置，不改既有分区行为。

## 失败语义

| 场景                                           | 结果                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| `projectService` 缺失（旧 Host / 测试 double） | 本机项目区域显示“服务不可用”，远端区域仍独立读取     |
| `remoteProjectService` 缺失                    | 远端区域显示“服务不可用”，本机区域不受影响           |
| `readProjects` reject                          | 本机区域错误 + 重试，不清空已展示的远端数据          |
| `readDirectory` reject                         | 目录浏览器内联错误 + 重试，保持当前路径              |
| `saveProject` reject                           | 内联错误，保持选择器打开，不调用打开动作             |
| 主目录 `missing` / `unavailable`               | 行内状态标记；仍允许打开（由 Host/会话准备阶段拒绝） |
| 远端 host `offline`                            | 状态标记；点击连接走既有重连/向导                    |
| `state:projects` 广播                          | 触发一次重新读取；迟到结果按请求版本丢弃             |

## 验收

1. 侧栏出现项目目录区块，能展示本机项目、主目录状态、远端 host 连接状态与远端入口；加载/空/错误/重试状态齐全。
2. 项目选择器可打开已有项目 root，也可浏览目录并创建项目；创建成功后打开主目录。
3. 设置页新增来源与设备分区，展示连接状态与迁移报告；重试可重新读取。
4. 既有 workspace/task 导航、side pane 与 full view 行为不变。
5. 桌面与移动 Web 布局可用；zh-CN / en-US 文案完整；键盘可操作、有 aria 标签。
6. 聚焦测试覆盖项目列表 loading/empty/error 与选择器 root 选择；`pnpm exec tsc --noEmit -p packages/ui/tsconfig.json`、目标 `oxlint`、`pnpm architecture:check --changed`、`git diff --check` 通过。

## 非目标

- 不实现项目拖拽排序、虚拟项目创建向导、bots/workflow 同步、账号/厂商功能。
- 不实现远端项目直连 target、Source membership 管理、设备增删改与更新安装。
- 不移植上游整页 4000 行 `WorkspaceShellLayout`；不修改 `ConversationTimeline.tsx`、`SessionPane.tsx`、`side-pane-full-view`、per-key store。
- 不改变核心协议与 services；若服务缺失只在 UI 显示不可用。
