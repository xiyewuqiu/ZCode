# 项目侧栏完整视图（project-sidebar）

本规范取代 `project-first-ui-minimal.md`。项目树是侧栏唯一组织视图；workspace tab 继续只负责导航与执行目录，任务、项目、分组、远端入口均由既有 Host/服务端口唯一拥有。

## 产品语义

- 侧栏 = 项目树 + 任务行 + 设备/远端入口 + 偏好页脚。项目节点可展开任务，任务可拖拽/分组/置顶/归档；远端设备可连接、编辑、重命名、断开。
- UI 只做读取投影与动作入口，不缓存第二份项目事实：
  - 项目、roots、任务归属：持库 Host 的 `IProjectService` / `IRemoteProjectService`；
  - 分组结构：`IYCodeTaskService.listGroupedTaskViewStructure` / `applyGroupedTaskViewOrder`（无独立 `ITaskGroupService` 端口时由 `useTaskGroups` 适配）；
  - 未读信号：`ycodeTaskService.onDynamicWorkspaceEvent` 的 `background_terminal`；Controller 提供 `onDynamicTaskUnreadSignal` 时优先使用；
  - 设备管理：`ISourceServerManagementService`（仅桌面 base attachment）。
- 选择视图（projects / grouped / timeline）与折叠偏好只存本机 UI 偏好（`view-preference.ts`、`grouped-expansion.ts`、`useProjectSidebarPreferences`）。

## 组件边界

| 目录/文件                                                                                                                                                | 职责                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ProjectDirectoryProvider`                                                                                                                               | 唯一目录 owner：`useProjectTree` + `useTaskGroups` + `useProjectSidebarPreferences` + 设备名注册表；同源供侧栏与 composer 使用 |
| `ProjectSidebar`（`index.tsx`）                                                                                                                          | 组合项目区、置顶/时间线/分组任务、页脚、创建/编辑/远端项目选择对话框                                                           |
| `ProjectSections` / `SortableProjects` / `ProjectSidebarNode` / `ProjectNodeContent`                                                                     | 项目行、主目录状态、置顶、拖拽排序、菜单、设备与连接诊断                                                                       |
| `RemoteHostSection` / `RemoteProjectList` / `RemoteProjectPicker` / `RemoteProjectMenu` / `OfflineRemoteProjectRows` / `RemoteConnectionProgressSection` | 远端 host 分组、缓存入口、离线行、连接进度、设备详情                                                                           |
| `ProjectCreation` / `ProjectEditor` / `ProjectFolderTrustDialog` / `ProjectComposerMenu`                                                                 | 新建/编辑项目、目录选择、项目信任、聊天项目切换                                                                                |
| `ArchiveManagement` / `ArchiveGroupCard`                                                                                                                 | 归档任务查看、恢复、永久删除                                                                                                   |
| `TaskGroupedView` / `grouped/*`                                                                                                                          | 分组虚拟化列表、组内拖拽、组菜单、草稿行                                                                                       |
| `useProjectTree` / `project-tree-reader` / `useProjectUnreadSignals` / `useProjectPinIntent`                                                             | 权威树读取、未读/置顶信号                                                                                                      |
| `useProjectFileTree` / `project-file-navigation`                                                                                                         | 项目/任务文件树入口（文件树仍由 `WorkspaceSidebar` 覆盖层渲染）                                                                |
| `useProjectRemoteSync` / `task-mutation` / `remote-navigation`                                                                                           | 远端同步菜单、任务组织命令、远端 workspace 绑定                                                                                |

## 集成

- `WorkspaceSidebar.tsx` 现在是适配层：渲染 `ProjectSidebar`，保留 `WorkspaceFileTree` 覆盖层、文件树打开请求与 `SidebarFileTreeOpenRequest` 导出。
- `WorkspaceShellLayout` 继续拥有侧栏宽度、side pane、full view、工作台与 tab 导航；只新增 `workspaceIdentity` 透传，不改滚动/resize。
- 新建任务：项目行请求携带 `projectId` / `taskGroupId`；适配层补 `targetWorkspace`（项目主 root + canonical identity），`startDraft` 同时写入 `draftProjectId` / `draftTaskGroupId`。
- 文件树：项目/任务行调用 `onOpenFileManager`，适配层覆盖渲染 `WorkspaceFileTree`；`fileTreeOpenRequest` 仍由 Shell 发起。
- 设置页 `devices` 分区在 `sourceServerManagementService` 存在时渲染完整 `SourceServerManagementPanel`（连接、Profile、迁移报告、重试/放弃/导出、更新、日志）；否则回退只读 `DevicesSection`。
- 启动更新提示由 `root/sourceServerUpdateNotifications.ts` 消费管理快照；迁移报告导出/放弃/重试由 `SourceServerMigrationReportPanel` 调用管理服务。

## Composer 项目选择器

- `WorkspaceShellLayout` 在草稿态 `draftComposerHeader` 挂载 `ProjectComposerMenu`，顺序与上游一致：项目菜单 → `children`（插件预览 / Git 分支）→ 编辑 Plus。`showEditProject` 只在聊天头部启用。
- `ProjectDirectoryProvider` 提升到 `WorkspaceShellLayout` 根；`WorkspaceSidebar` → `ProjectSidebar` 复用同一 Provider。菜单与侧栏共享项目树、排序偏好和设备名，不按 tabs / cwd 生成第二份项目。
- Props：`workspacePath` / `workspaceIdentity` 表达当前草稿执行目录与 Host 身份；`onCreateTask` 复用 `handleCreateTaskInChat` → Root `prepareSession` 导航；`onSelectConversationWorkspace` 复用在项目外工作的目标解析；`allowRemoteWorkspace` / `onOpenRemoteWorkspace` / `onConnectRemote` / `onCancelRemote` 复用 Root 连接 owner；`showEditProject` 复用 `ProjectEditor`。
- 候选来自目录 owner 的未删除项目，按侧栏顺序；搜索名称、设备名和 roots；离线项目保留但禁用，零 roots 不过滤。当前选中由草稿所属项目 + Host 身份决定，同 ID 不同 Host 互不串选。
- 选择项目调用 `onCreateTask({ projectId, hostId? })`；紧凑远控模式显式携带 Host。聊天内远程连接发起后，每次展示目标设备的目录选择；唯一匹配沿实际项目 ID 登记入口，Root 准备和导航完成前 `ComposerSubmissionPendingContext` 阻塞当前 `ConversationComposer` 的按钮与快捷键提交，后台化 / 取消 / 草稿身份变化解除。
- 旧 `ChatEmptyState` / tab workspace 菜单已移除；定时任务表单改用独立 `Select`，不再复用聊天项目菜单。
- 测试：`packages/ui/test/projectComposerMenu.test.ts` 覆盖选择与搜索、离线禁用、编辑入口与身份、同 ID 跨 Host 隔离、紧凑模式 Host、Pending 门禁；fixture 为 `packages/ui/test/browser/projectComposerMenu.fixture.tsx`。

## 状态所有者

| 状态                      | 所有者                                       | UI 读取                                                                |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| 项目/roots/任务归属       | Host `ProjectRepository` / `IProjectService` | `readTree` / `readProjects`                                            |
| 远端入口                  | `IRemoteProjectService`                      | `readDirectory`                                                        |
| host 连接态               | 连接管理器                                   | `RemoteProjectHost.connectionStatus`、`SourceServerManagementSnapshot` |
| 分组结构                  | tasks-index（`task_groups` 等表）            | `listGroupedTaskViewStructure` / `applyGroupedTaskViewOrder`           |
| 未读                      | tasks-index 终态/Controller 信号             | `workspace_task_list_changed.unreadSignal`                             |
| 视图偏好/折叠             | 本机 `localStorage`                          | `view-preference` / `grouped-expansion`                                |
| 创建/编辑弹窗、拖拽瞬时态 | React 局部 state                             | 组件内                                                                 |

## 失败语义

| 场景                  | 结果                                     |
| --------------------- | ---------------------------------------- |
| `projectService` 缺失 | 项目区显示不可用；任务/远端区独立        |
| 读取项目树失败        | 内联错误 + 重试；保留上次已接受树        |
| 远端 host 离线        | 显示缓存入口与离线标记；连接走既有向导   |
| 分组 RPC 失败         | 保留原结构并 toast；不写本地假分组       |
| 任务组织命令失败      | 保留行事实并刷新；迟到回包按请求版本丢弃 |
| 管理服务缺失（Web）   | 设置页回退只读设备卡；不伪造设备操作     |
| 创建项目保存失败      | 保持对话框并展示服务错误码；不导航       |

## 无障碍 / 布局 / 国际化

- 拖拽同时提供键盘传感器；菜单/树行有 `aria-label`、`aria-expanded`、`role=alert` 错误。
- 跟随系统 `prefers-reduced-motion`（动画类复用现有 CSS）。桌面和移动 Web 使用同一 DOM，窄屏隐藏拖拽手柄文案并保留点击目标。
- 所有新增文案同时提供 `zh-CN` 与 `en-US`。

## 验收

1. 项目区展示本机项目、主目录状态、远端 host 与缓存入口；支持拖拽排序、置顶、展开/折叠、选择视图。
2. 任务行支持置顶、归档、重命名、未读、文件树、移动到分组；分组视图支持拖拽、组颜色、解散、虚拟化滚动。
3. 归档管理可查看/恢复/永久删除归档任务。
4. 远端连接进度、离线行、设备详情、连接/断开/编辑/重命名可用；创建/编辑项目与远端项目选择可用。
5. 设置页设备分区展示完整 Source Server 管理与迁移报告，重试/放弃/导出可用。
6. 文件树覆盖层、side pane full view、会话时间线与 tab 导航行为不变。
7. `pnpm exec tsc --noEmit -p packages/ui/tsconfig.json`、目标 `oxlint`、`pnpm architecture:check --changed`、`git diff --check` 通过；`packages/ui/test/project-sidebar/*`、`packages/ui/test/remote-connection-flow/*` 与 `packages/ui/test/projectComposerMenu.test.ts` 通过。

## 已知缺口

- 本仓库已移除手机远控（`WebRemoteControl*`）与账号/编码套餐（CodingPlan）功能，因此上游侧栏中设备切换头、远控查看自动已读、升级入口未移植；composer 没有 `isWebRemoteControlShell` 来源，`ProjectComposerMenu` 以默认非紧凑布局挂载。项目树与 composer 其余交互完整保留。
- `ITaskGroupService` 独立端口不存在，分组通过 `IYCodeTaskService` 的 grouped 结构/排序端口适配；`admit` 由 tasks-index 自行登记。
- 上游 `activity/hook` 与 `activity/refresh` 合同测试依赖 `vitest` + `@testing-library/react`，本仓库使用 `node:test`，这两个测试未移植；纯结构合同测试已移植并通过。
- 桌面 Source Server 的远端迁移执行仍按 `source-server-backend.md` 的显式 gap 返回 `failed` 报告；本切片只展示与重试，不伪造成功。
