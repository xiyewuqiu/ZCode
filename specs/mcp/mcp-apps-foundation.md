# MCP Apps + 插件 UI 沙箱：基础切片与 UI 桥

状态：垂直切片（vertical slice）。在基础契约 / 沙箱之上补齐 renderer ↔ sandbox 的 `ui/*` JSON-RPC 桥、host 侧资源读取与实例凭证、App-Provided Tools 实例信箱，以及内联卡片 + 侧栏 Gen UI 承载。不包含插件市场 UI、远程插件同步、Sampling 与 Gen UI vendor/Tweak 运行时。

## 目标与边界

本切片解决以下问题：

1. 定义 MCP Apps manifest：工具 `_meta` → `ui://` 资源 URI、可见性、CSP、权限。
2. Host 侧 discovery：把 MCP 工具映射到 UI 资源，并暴露 `PluginUiHostPort` typed 端口。
3. Host 侧 prepare：读取并校验 `ui://` 资源、签发 scoped 实例凭证、登记沙箱；未声明 / 不可见 / 超限一律拒绝。
4. Electron renderer：受信 relay shell + 独立 partition / 独立 origin 的 iframe 沙箱。
5. Renderer ↔ sandbox `ui/*` 桥：initialize 握手、host context、工具输入 / 结果、尺寸 / 显示模式、teardown、资源请求；未实现能力返回 `-32601`。
6. App-Provided Tools：页面工具发现、登记、模型调用经实例信箱投递，页面 claim 后执行并回传；复用正常工具执行器与审批。
7. Gen UI 承载：默认内联卡片；`preferredDisplayMode` 为 fullscreen / pip 或声明 `surface` 时切到侧栏浮层，仍复用同一个沙箱实例。
8. 默认拒绝，且宿主 / 资源 / 桥不可用时工具结果照常渲染。

非目标：插件市场 UI、远程插件同步、Sampling、`ui/message` / `ui/update-model-context` / `ui/download-file` 的完整交互、多 surface 管理器、Gen UI vendor 映射与 Tweak 私有回调。

## 领域契约（`@ycode/shared/mcp-apps`）

| 文件              | 职责                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `contract.ts`     | 扩展 ID、`text/html;profile=mcp-app`、CSP 放宽键、权限四键、沙箱句柄/登记载荷、`PluginSandboxPlatformPort`              |
| `bridge.ts`       | `ui/*` 与 MCP 方法名、initialize 结果、host context / capabilities、JSON-RPC 帧与错误码                                 |
| `hostPort.ts`     | `PluginUiHostPort`：prepare / validate / close / callTool / readResource / subscribe / app tools mailbox                |
| `toolMeta.ts`     | 纯函数归一化：`normalizeMcpToolUiMeta` / `normalizeMcpAppResourceMeta` / `readMcpToolVisibility` / `normalizeCspOrigin` |
| `manifest.ts`     | 合并工具与资源 `_meta` 得到 `McpAppsManifest`，并校验 HTML mimeType / 16 MiB 上限                                       |
| `schemas.ts`      | `display.ui` 与描述符的 zod 运行时校验                                                                                  |
| `resourceMime.ts` | 页面读资源的 8 MiB 上限与 MIME 白名单                                                                                   |
| `appTools.ts`     | App-Provided Tools 的描述符归一化、模型侧命名、信箱调用请求                                                             |

不变量：

- `resourceUri` 优先级：`_meta.ui.resourceUri` → `_meta["ui/resourceUri"]` → `openai/outputTemplate`；必须 `ui://` 开头且 ≤ 2048 字符，否则整个 UI 描述不存在。
- `visibility` 缺省 `["model","app"]`；不含 `model` 的工具不进 provider contracts，不含 `app` 的工具拒绝页面 prepare / call。
- CSP origin 只接受 `https:` / `wss:`，以及插件本机服务的 `http://127.0.0.1` / `ws://127.0.0.1`；不接受凭据、query、hash、路径。
- `'unsafe-eval'` / `'wasm-unsafe-eval'` 只由资源 `_meta["ycode/csp"]` 显式 true 放行；未知键与非布尔值丢弃。
- 权限只认 `camera` / `microphone` / `geolocation` / `clipboardWrite` 四键，未知键丢弃；未声明一律拒绝。
- 实例凭证只在本连接代际内有效；`validateInstance` 同时校验 workspace / session / plugin / server / 连接快照。

## Host prepare 与 discovery

`apps/ycode-cli/packages/adapters/src/mcp/descriptor.ts` 在 `tools/list` 时归一化一次 `_meta`：

```
MCP tools/list
  → normalizeMcpToolUiMeta(record._meta)
  → McpToolDescriptor { visibility, ui }
```

`apps/ycode-cli/packages/bootstrap/src/ycode-protocol/mcp-ui/`：

- `discoverMcpAppsFromTools(descriptors)`：纯函数，列出声明了 `ui://` 的工具。
- `readMcpAppUiResource(access, scope)`：fail closed 校验 server 归属、工具存在且 app 可见、`resourceUri` 与工具声明一致；读取资源后校验 MIME / 16 MiB，再合并资源级 CSP / permissions / 尺寸。
- `createMcpUiHandlers(...)`：`readResource` / `callTool` / `cancelToolCall` / `readResourceForUi`，含 8 MiB 与 MIME 白名单。
- `McpUiInstances`：实例凭证的唯一 owner；`open` 对同一逻辑作用域 + 同一连接代际幂等，close 先移除再 abort。
- `createMcpUiHostBridge(access, { registerSandbox, applyAppTools })`：prepare / validate / close / callTool / readResource / list / subscribe / app tools 的宿主端组合，实现 `PluginUiHostPort`；连接代际变化时撤销实例并清信箱。
- `McpUiAppToolMailbox`：页面工具登记、模型调用投递、claim / resolve、认领与执行超时、会话关闭清理；暴露集合经 `applyTools` 同步到 runtime。

`createMcpUiHostBridge` 的 prepare 顺序：

```
hostPort.prepareSandbox(scope + resourceUri + toolName + ownerWebContentsId)
  → instances.open(credential)
  → readMcpAppUiResource（server / 工具可见性 / resourceUri 绑定 / MIME / 16 MiB）
  → buildPluginSandboxRegisterInput（资源级 CSP / permissions / 尺寸优先）
  → 同进程：deps.registerSandbox(input) → PluginSandboxHandle
  → 跨进程：prepareRegistration(params) → { instance, register }（renderer 再交给 main）
```

任何一步失败都撤销刚签发的凭证；renderer 只拿到登记载荷 / 句柄，不接触 MCP client。

## 桌面沙箱（`packages/desktop/src/main/pluginSandbox`）

| 文件                | 职责                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract.ts`       | `ycode-sandbox://shell-<appIdentity>/instance/<sandboxId>/`（relay shell）与 `plugin-<appIdentity>`（插件 HTML）、`persist:plugin-sandbox-v1-<hash>`、注册表端口 |
| `csp.ts`            | 插件 CSP（规范缺省、四类域、eval 放宽）与 shell CSP、Permissions-Policy                                                                                          |
| `permissions.ts`    | Electron 权限名 → 规范四键、deny/prompt/allow 裁决、确认框文案                                                                                                   |
| `permissionGate.ts` | 按 partition 的内存同意记录 + 单飞确认框 + 异步授权后二次校验；请求方必须是 plugin origin                                                                        |
| `registry.ts`       | main 唯一 owner：幂等登记、TTL、容量 64、pin/unpin、一次性手势                                                                                                   |
| `protocol.ts`       | shell HTML（内联转发脚本）/ 插件 HTML；未知路径 404，全部 `no-store`                                                                                             |
| `guestPolicy.ts`    | webview 硬化、shell + plugin 双 origin 导航白名单、popup 拒绝、手势记录、MessageChannel + iframe `allow`                                                         |
| `session.ts`        | partition 级 protocol / 请求归属校验 / 权限闸门 / 下载拒绝 / 直连代理                                                                                            |
| `host.ts`           | app ready 后安装、IPC 登记（owner 取真实 sender）、窗口关闭清理                                                                                                  |

安全边界：

- webview 顶层文档是受信 shell；插件 HTML 只在 `allow-scripts allow-same-origin allow-forms` 的跨源 iframe 里。
- shell 只把 init MessagePort 与 plugin origin 的 iframe 消息原样转发，不解析协议。
- guest 固定 `contextIsolation`、`sandbox`、`webSecurity`，禁用 Node、子 frame Node、webviewTag、plugins、dialogs。
- 独立 origin 由可信 `appIdentity` 派生；随机 `sandboxId` 只在路径里。
- `will-attach-webview` 校验 shell 登记、partition、owner 三者一致，否则阻止挂载。
- 未声明权限一律拒绝；camera / microphone / geolocation 首次使用时原生确认，clipboardWrite 按声明放行；iframe `allow` 只转发四键。
- 页面重载、销毁、越界导航都会撤销旧登记；迟到 dispose 带 `initId` 不会误杀新登记。

## Renderer 桥与卡片（`packages/ui/src/plugin-ui`）

| 文件                                  | 职责                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `adapters/messagePortTransport.ts`    | 宿主 ↔ shell 的 MessagePort 帧通道（只做形状检查）                                                |
| `app/pluginUiJsonRpcBridge.ts`        | `ui/initialize` 握手、host context、工具 feed、display mode、资源请求、teardown、host → page 请求 |
| `app/pluginUiAppToolsRelay.ts`        | 页面 `tools/list` 发现 / 登记；信箱调用 claim → 页面 `tools/call` → resolve                       |
| `adapters/usePluginUiAppRuntime.ts`   | prepare → onPorts → 建桥 → 投递 → teardown 的生命周期                                             |
| `adapters/legacyHostPort.ts`          | 只有 HTML loader 时的兼容端口（工具 / 资源请求一律拒绝）                                          |
| `adapters/agentHostPort.ts`           | 完整端口：`mcp/ui` RPC + `platform.pluginSandbox.registerSandbox` + app-tool 订阅                 |
| `components/PluginUiHostProvider.tsx` | `PluginUiHostPort` / loader / 权限 / 外部链接 / session & workspace identity 注入点               |
| `components/PluginUiCard.tsx`         | 内联卡片 / 侧栏浮层、权限展示、fallback 摘要与原因                                                |
| `components/PluginUiSidePane.tsx`     | 不 portal、不换父节点的 fixed 承载框（fullscreen / pip）                                          |
| `domain/hostContext.ts`               | hostContext / hostCapabilities / 样式变量的唯一构造点                                             |
| `PluginUiToolCallBlock.tsx`           | 从工具行读取 `display.ui`，投递 input / result / cancelled                                        |

### `ui/*` 桥规则

- `ui/initialize`：回显页面请求的 `protocolVersion`（缺省 `2025-06-18`），返回 `hostInfo`、`hostCapabilities`、`hostContext`；记录 `appCapabilities`。只有收到 `ui/notifications/initialized` 才进入 ready；15 s 未握手则失败并 fallback。
- hostContext：主题、locale、displayMode / availableDisplayModes、容器尺寸、safeAreaInsets、platform、timeZone、deviceCapabilities、styles、toolInfo；widgetState 初值经 `ycode/widgetState` 扩展键下发。
- 工具 feed：ready 后 `ui/notifications/tool-input`、`ui/notifications/tool-result`、`ui/notifications/tool-cancelled`；握手前只保留最新一份，ready 时补发。
- 显示模式：`ui/request-display-mode` 必须落在 availableDisplayModes；宿主打开 / 关闭侧栏并推 `host-context-changed`。未知模式落回当前模式。
- 资源：`resources/read` 走宿主端口（8 MiB / MIME 白名单）；`resources/list`、`templates/list`、`subscribe`、`unsubscribe` 只在宿主实现时可用，否则 `-32601`。
- `ui/open-link` 只放行 http(s)；file / 自定义 scheme 一律 `-32602`。
- `ui/set-widget-state` 写 renderer 内存；不持久化。
- 未实现的 `ui/message`、`ui/update-model-context`、`ui/download-file` 返回 `-32601`，不伪造成功。
- teardown：已握手实例先发 `ui/resource-teardown`（500 ms 上限），再关传输与释放 sandbox；页面未回包也释放。
- 页面 `tools/call`（兼容别名 `ui/call-tool`）只经 `PluginUiHostPort.callTool`，复用正常工具执行器 / 审批，不产生旁路；取消经 `notifications/cancelled` 或卸载传到宿主。
- app tools：页面声明 `appCapabilities.tools` 后才 `tools/list` 并登记；`list_changed` 1 s 节流；信箱投递按 callId 去重，claim 成功后页面执行，结果超 10 MiB 或页面未运行都以错误结束。

### Gen UI 承载

- 默认内联卡片；`preferredDisplayMode === "pip"` 初始 pip，`fullscreen` 或声明 `surface` 初始侧栏 fullscreen。
- 内联 / 侧栏使用同一个承载框节点，只切 fixed 样式，不 reparent，避免 webview 重载与新 initId。
- `pip` 是右下角浮层；`fullscreen` 是右侧面板；Esc / 关闭按钮回 inline。
- `runtime.status === "loading"` 且已有句柄时仍先挂 webview；桥失败则撤掉句柄并显示 fallback。

## `mcp/ui` 跨进程接线（renderer → services → CLI → main）

CLI 进程不能调用 Electron main，因此 prepare 拆成两段：CLI 负责「读资源 + 校验 + 签发实例凭证 +
构造登记载荷」，renderer 负责把载荷交给 `IPlatformService.pluginSandbox.registerSandbox`（main）。
`createMcpUiHostBridge` 因此多一个 `prepareRegistration`：同一条校验链，但不调用 `registerSandbox`。

| 层        | 文件                                                                | 所有权                                                                     |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| shared    | `packages/shared/src/mcp-apps/rpc.ts`                               | `mcp/ui` 方法名、strict 参数/结果 schema、app-tool 通知 schema             |
| services  | `packages/services/src/ycode-agent/ycodeAgentService.ts`（`mcpUi`） | 选 workspace agent client；补齐 `workspace`（identity 优先）与路由         |
| CLI       | `bootstrap/src/ycode-protocol/mcp-ui/rpc.ts`                        | 会话查找、每会话 bridge、workspace 校验、op 分派                           |
| CLI       | `mcp-ui/agentAccess.ts` + `sessionAccess.ts`                        | App 的窄 MCP 访问面（工具描述 / 调用 / 资源）→ `McpUiSessionAccess`        |
| CLI       | `mcp-ui/instances.ts`                                               | 实例凭证唯一 owner；滑动空闲 TTL、撤销、连接代际校验                       |
| CLI       | `mcp-ui/hostBridge.ts`                                              | discovery / manifest / 16 MiB / 权限合并 / 登记载荷 / 连接撤销订阅         |
| CLI       | `mcp-ui/appToolsMailbox.ts` + `appToolsDefinitions.ts`              | app-tools 信箱、暴露集合计算、claim / resolve / 超时 / 模型工具同步        |
| CLI       | `app/mcp-app-facade.ts` + `app/mcp-app-host.ts`                     | `YCodeApp` 宿主面：页面调用授权（executor + 审批）、连接快照、app 工具替换 |
| contracts | `interfaces/mcp.port.ts`                                            | `appConnectionSnapshot` / `onAppConnectionInvalidated` / `appConnection`   |
| adapters  | `mcp/index.ts` + `mcp/pool.ts`                                      | 连接代际、identity 摘要、代际变化监听与 pool lease 转发                    |
| renderer  | `packages/ui/src/plugin-ui/adapters/agentHostPort.ts`               | `PluginUiHostPort` 适配器：RPC + main 登记 + app-tool 订阅                 |
| renderer  | `packages/ui/src/v4/SessionPane.tsx`                                | 会话根挂 `PluginUiHostProvider`（sessionId / workspace / platform / link） |
| main      | `packages/desktop/src/main/pluginSandbox/host.ts`                   | 沙箱登记、guest、partition、权限闸门                                       |

时序（prepare）：

```
PluginUiCard
  → usePluginUiAppRuntime.prepareSandbox(params)
  → agentHostPort: service.mcpUi({ request: { op: "prepare", ... } })
  → services.mcpUi: client.request("mcp/ui", { workspace: buildWorkspaceRef(target), ...request })
  → CLI server.dispatch → handleMcpUiRpc
      → requireSession(ctx.sessions, sessionId) + workspace identity 校验
      → getSessionHost(ctx, record)：record.app.mcpUiAgentAccess() → createMcpUiSessionAccess
      → bridge.prepareRegistration
          → McpUiInstances.open（同一逻辑作用域的幂等凭证）
          → readMcpAppUiResource（server / 可见性 / resourceUri 绑定 / mime / 16 MiB）
          → buildPluginSandboxRegisterInput（资源级 CSP / permissions / 尺寸优先）
      → 返回 { instance, register }（HTML 只在这一次跨进程）
  → agentHostPort: platform.pluginSandbox.registerSandbox({ ...register, requestId })
  → main: parseRegisterPayload → registry.register（幂等键 scopeId；owner 取真实 IPC sender）
  → 返回 PluginSandboxHandle → onPorts → renderer 建 `ui/*` 桥
```

时序（页面工具 / 资源 / app-tools）：

```
page tools/call | resources/read
  → 渲染桥 handler → PluginUiHostPort.callTool | readResource
  → services.mcpUi("mcp/ui") → CLI handleMcpUiRpc
      → bridge.validateInstance（workspace / session / plugin / server / 实例 / TTL）
      → createMcpUiHandlers.callTool（可见性 + callId 去重）| readResourceForUi（8 MiB / MIME）
  → MCP client（本会话 mcpPort）→ 结果回页面

页面 tools/list（app tools）→ relay 登记
  → "mcp/ui" registerAppTools → CLI McpUiAppToolMailbox
模型调用（app tool）→ CLI mailbox.execute
  → context.notify("mcp/ui/appToolCall")
  → services onDynamicMcpUiAppToolCall
  → renderer subscribeAppToolCalls（按 sessionId 过滤；relay 再按 scopeId/instance 过滤）
  → claimAppToolCall → 页面 tools/call → resolveAppToolCall
```

不变量：

- prepare 幂等键 =（workspace identity、sessionId、pluginId、serverName、scopeId、resourceUri、ownerWebContentsId）+ 连接代际；
  同一键重复 prepare 返回同一实例 token，main 按 `scopeId` 幂等登记，不会用新 HTML 覆盖已挂载的 guest。
- 连接代际 = `McpPort.appConnectionSnapshot(serverName)` 的 `{ identity, generation }`：
  identity 只由宿主可信配置派生（platform / execPath / workingDirectory / serverName / 规范化 config），
  generation 由 adapter 在 connect / disconnect / close 时递增；返回 null 表示当前不签发 / 已断连。
  `McpPort.onAppConnectionInvalidated(serverName, listener)` 在同一代际变化时通知，bridge 主动撤销实例。
- 凭证在 CLI 内滑动过期（空闲 30 分钟）；`close`、会话关闭（`session/close`、v4 `deleteSession`）、冷恢复替换 record、
  连接代际变化都会撤销并清空信箱。过期凭证 `validate` 先移除再抛错，不存在「过期但仍可调用」的窗口。
- 连接快照缺失（mock / 旧端口）视为宿主未实现撤销；已实现端口的 null 快照表示 server 未连接，不签发新凭证。
  validate 只在凭证确属本实例后才按快照撤销，错 server / 旧代际的请求不能关闭合法页面。
- 页面 `callTool` 必须走 `YCodeApp.callMcpToolForUi` → `ToolExecutor.authorizeAppTool`：
  与模型调用共用 validateInput、PreToolUse hook、项目 deny 规则与 permission broker，不允许直接调 `mcpPort`。
  授权返回后再次比对连接快照，并以 `appConnection` 固定执行连接；代际变化只失败，不重连重放。
- App-Provided Tools 的模型面 = `McpUiAppToolMailbox` 的暴露集合 → `YCodeApp.replaceMcpAppProvidedTools`：
  同 server 只暴露最近登记的实例，模型名 `app__<server>__<tool>`，与既有工具重名时以既有工具为准。
  每次 register / unregister / 认领超时 / 连接撤销都整体重算并失效工具缓存，模型下一次请求即看到最新集合。
- 模型调用 app tool 的 executor 带 `retainExecution`：在审批前 pin 住实例，实例撤销时 abort 审批与执行，
  结束后 release；实例不存在时直接返回 ToolCancelled 结果，不进入 hook / 审批。
- 信箱终态：认领 5 s / 执行 30 s 两段超时，结果 ≤ 10 MiB；取消 / 超时 / 页面卸载都以错误结束并通知页面
  `cancelled: true`，pending 与实例登记一并清理，不重发。
- workspace 路由：services 用目标连接补齐 `workspaceKey`；CLI 校验请求 workspace 与会话 record 一致，
  identity 优先于路径，`remoteSessionId` 同时比对。UI 适配器不手写身份格式。
- 失败一律 fail closed：`record.app.mcpUiAgentAccess` 缺席 → `-32601`；workspace 不一致 → `-32602`；
  资源 mime / 16 MiB / 工具可见性失败 → 拒签凭证。prepare 失败不影响工具结果本身。
- Web / 无 `platform.pluginSandbox.registerSandbox`：适配器返回 null → 卡片 `no-host`，不伪造 host。
  Web 端只要注入实现 `registerSandbox` 的平台端口，同一条 `mcp/ui` RPC 适配器即可复用，不新增分支。
- 只读观察视图（`SessionPane readOnly`、子代理详情）不挂宿主：历史页面不能发起新的 MCP 工具调用，卡片退回摘要。
- app-tool 通知是进程级广播；renderer 只按 sessionId 过滤，实例 token 与 scopeId 由 relay 二次校验。

## 状态所有者与事件顺序

```
tools/list ──adapter normalize──► McpToolDescriptor{ui}
                                      │
agent core ──createMcpToolDisplay────► ToolCallRow.display.ui (持久化)
                                      │
UI MCP row ──readPluginUiDisplay──────► PluginUiCard
                                      │
UI host port ──prepareSandbox────────► CLI `mcp/ui` RPC（host bridge）
                                      │  ├─ readMcpAppUiResource / manifest / 16 MiB / MIME
                                      │  ├─ McpUiInstances.open(credential)
                                      │  └─ 返回 { instance, register }
                                      │
renderer port ──registerSandbox──────► Main registry（唯一 owner）
                                      │
Main ──shell-<id> relay HTML─────────► webview guest（独立 partition）
Main ──plugin-<id> iframe HTML───────► iframe（CSP / Permissions-Policy）
                                      │
Main dom-ready ──MessageChannel──────► UI bridge（port2）/ shell（port1）
                                      │
UI bridge ──ui/initialize / tool-result / display-mode──► page
page ──tools/call / resources/read / open-link──► UI bridge ──► host port ──► MCP client
page ──tools/list / tools/call（app tools）──► UI relay ──► host mailbox claim / resolve
                                      │
UI 卸载 ──teardown + closeInstance + disposeSandbox(sandboxId, initId)
```

- manifest / 工具可见性：agent（discovery 时一次）。
- 资源 HTML、实例凭证、app-tools 登记与信箱：CLI 的每会话 `McpUiHostBridge`（`mcp/ui` RPC）。
- 连接代际：adapter 拥有 generation，pool 按 lease 转发；CLI 的 `McpUiSessionAccess` / bridge 只读，
  不自行推断；代际变化由 adapter 通知、bridge 撤销。
- 模型侧 `app__*` 工具：CLI 信箱计算暴露集合，`YCodeApp` facade 在 runtime 工具表整体替换并失效缓存；
  executor 仍是唯一执行 / 审批入口。
- 沙箱登记、guest、端口、权限同意：main（renderer 经 `IPlatformService.pluginSandbox` 发起）。
- 桥状态、widgetState、卡片展开 / 侧栏状态：renderer 内存。
- 工具结果投影与持久化：agent/core；`display.ui` 只是投影，不是运行时事实。

## 降级

任何一步失败都不阻塞工具结果：

- `platform.pluginSandbox` 缺失 → `reason: no-platform`。
- 没有 host port / loader → `reason: no-host`。
- host 需要 session 但工具行未绑定 → `reason: no-session`。
- 资源不可读 / loader 返回空 → `reason: no-resource`。
- 握手失败 / 超时 → `reason: bridge-failed`。
- prepare / 登记抛错 → `reason: error`。

所有降级都保留 MCP 原始结果与结构化摘要；卡片只展示原因码与宿主错误文本。

## 永久测试（无需打包 / 运行 Electron）

以下用例使用 `node:test` + `tsx`，以 fake service / fake platform / fake MessagePort / fake webContents 覆盖 renderer → service RPC → bootstrap host bridge → desktop sandbox 的接线，默认套件可独立运行：

| 层               | 文件                                                        | 覆盖                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renderer 适配器  | `packages/ui/test/pluginUiAgentHostPort.test.ts`            | 无平台端口 → `null`（no-host）；prepare 透传 workspace / session / resource / owner 并登记 main 载荷；登记失败撤销实例（close）；callTool / cancelToolCall / readResource / validate / close 路由；app-tools register / claim / resolve / unregister；app-tool 订阅按 sessionId 过滤与退订                                                                                            |
| renderer 桥      | `packages/ui/test/pluginUiJsonRpcBridge.test.ts`            | `ui/initialize` 回显版本与 host context（含 widgetState）；握手前请求 `-32600`；tool-result 握手前只保留最新并在 ready 补发；未实现方法 `-32601`、缺参 / `file:` 链接 `-32602`；工具 / 资源 / open-link 路由；取消通知 abort 调用；display mode 只落在 available；teardown 先请求再释放；15 s 握手超时失败                                                                            |
| 卡片 fallback    | `packages/ui/test/pluginUiCardFallback.test.ts`             | `no-platform` / `no-host` / `no-session` 判定顺序（含 legacy loader 与无 `registerSandbox`）；原因短码 + 宿主错误文本；`readPluginUiDisplay` / `readPluginUiPreview` 的结构化摘要；surface / CSP / 尺寸提示在 fallback 后仍可重试                                                                                                                                                     |
| CLI `mcp/ui` RPC | `apps/ycode-cli/packages/bootstrap/test/mcp-ui-rpc.test.ts` | prepare 幂等（同作用域 + 同连接代际同 token）；workspace identity / 路径 / server 不一致 fail closed；close 后 validate / callTool 拒绝；连接快照换代与 `onMcpAppConnectionInvalidated` 撤销实例、清空 app tools；app tools 以 `app__<server>__<tool>` 暴露、`retainExecution` 在审批前 pin、claim / resolve 信箱回环；页面 callTool 只走 `callToolForUi`；资源读取 8 MiB / MIME 边界 |
| 桌面协议 / CSP   | `packages/desktop/test/pluginSandboxCspProtocol.test.ts`    | 插件 CSP 缺省不放行 eval，仅 `ycode/csp` 显式放宽；CSP origin 归一化 / 去重 / 分派到指令；shell CSP 与 Permissions-Policy；URL 解析拒绝非 `ycode-sandbox` / 端口 / 凭据 / 非实例路径；shell / plugin 文档响应头、`no-store`、未知 sandbox / 错误 appIdentity / 非 GET / 未知路径拒绝                                                                                                  |
| 桌面权限         | `packages/desktop/test/pluginSandboxPermissions.test.ts`    | Electron 权限名 → 四键（media 音视频、clipboard、geolocation）；未声明 deny、camera / microphone / geolocation prompt、clipboardWrite 按声明放行；确认按 partition + 权限集合单飞并记忆；非 plugin origin / stale guest / 未声明键拒绝；系统媒体授权失败不写同意；check handler 只放行已授予项；权限确认文案中英                                                                      |
| 桌面 guest 策略  | `packages/desktop/test/pluginSandboxGuestPolicy.test.ts`    | webPreferences 硬化（contextIsolation / sandbox / webSecurity / Node / webviewTag / dialogs）与不安全 params 清除；will-attach 校验 shell URL、partition、owner；popup 拒绝、导航白名单；dom-ready 建 MessagePort 且 host 先于 shell、iframe allow 来自资源权限；input-event 记录一次性手势；页面重载 / 销毁 dispose 旧 `initId`；活 guest pin 住 TTL；未知 sandbox 无操作            |

运行命令：

```bash
pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test \
  packages/ui/test/pluginUiAgentHostPort.test.ts \
  packages/ui/test/pluginUiJsonRpcBridge.test.ts \
  packages/ui/test/pluginUiCardFallback.test.ts
node --import tsx --test apps/ycode-cli/packages/bootstrap/test/mcp-ui-rpc.test.ts
pnpm exec tsx --test \
  packages/desktop/test/pluginSandboxCspProtocol.test.ts \
  packages/desktop/test/pluginSandboxPermissions.test.ts \
  packages/desktop/test/pluginSandboxGuestPolicy.test.ts
```

测试专用类型检查（不改变生产工程）：

```bash
pnpm exec tsc -p packages/ui/test/tsconfig.plugin-ui.json
pnpm exec tsc -p apps/ycode-cli/packages/bootstrap/test/tsconfig.json
pnpm exec tsc -p packages/desktop/test/tsconfig.plugin-sandbox.json
```

### 仍仅能在运行时验证

以下行为依赖真实 Electron / webview / MCP server，永久套件只覆盖其纯逻辑与 fake 接线，不强行标记为通过：

- `packages/desktop/src/main/pluginSandbox/session.ts` 的 `session.protocol`、`webRequest.onBeforeRequest` 归属复核、`setPermissionRequestHandler` / `setPermissionCheckHandler` 与真实 guest `webContents` 的绑定。
- `host.ts` 的真实 `ipcMain` sender 覆盖、`BrowserWindow` 原生权限确认框、`MessageChannelMain`、窗口销毁清理与 `clearBrowserData`。
- `guestPolicy` 在真实 `will-attach-webview` / `did-attach-webview` 事件链中的 attach 顺序，以及真实 webview reload 对 `initId` 的影响。
- renderer `<webview>` 布局、真实 MessagePort 帧转发、PluginUiCard 的实际 DOM 渲染（当前 `node:test` 套件无 DOM runner，fallback 以纯判定 + 摘要函数覆盖）。
- 真实 MCP server 的 `tools/list` / `tools/call` / `resources/read` 回环、app-tool 页面执行，以及打包后 preload / partition 持久化行为。

## 验收场景

1. 工具 `_meta.ui.resourceUri = "ui://..."` 时，`display.ui` 出现且 MCP 卡片可见。
2. 资源 `_meta.ui.permissions = { camera: {} }` 时，prepare 把 `permissions: ["camera"]` 交给沙箱；未确认前 camera 请求被 prompt；未声明时直接 deny。
3. 资源 CSP 未声明 eval 时，生成的 CSP 不含 `'unsafe-eval'` / `'wasm-unsafe-eval'`；声明后只放行对应项。
4. `will-attach-webview` 收到未登记 / partition 不符 / owner 不符的 URL 时阻止挂载。
5. 页面完成 `ui/initialize` + `initialized` 后，`tool-result` 能到达页面；15 s 未握手落 fallback。
6. model-only 工具、非 MCP App mimeType、超 16 MiB HTML 的 prepare 请求被拒绝，且不签发凭证。
7. 页面 `tools/call` / `resources/read` 只经 host port；未实现的方法返回 `-32601`，`file:` 链接返回 `-32602`。
8. app tools：登记后模型工具表出现 `app__*`，模型调用进入信箱，未 claim 超时/注销；claim 后页面执行，resolve 回传结果；串 workspace / 旧凭证 / 旧代际调用被拒绝；注销或连接撤销后模型工具立即消失。
9. 非桌面平台 / 宿主缺失 / 桥失败时，MCP 工具结果照常渲染，卡片显示摘要与原因。
10. 同一工具重复登记返回同一 `sandboxId` / `initId`，不覆盖 HTML；fullscreen / pip 切换不重载沙箱。
11. 窗口关闭 / 崩溃后，其名下登记全部释放；迟到 dispose 不影响新代次。
12. 页面 `callTool` 命中 deny 规则时不询问 broker；需要审批时 broker 拒绝则不执行；批准期间连接换代旧批准失效。
13. server 重连 / 断开后，旧实例 token 的 validate、页面调用与 app-tool claim 全部失败，模型侧旧 `app__*` 消失。

## 已完成（本切片）

- 连接代际撤销：`McpPort.appConnectionSnapshot` / `onAppConnectionInvalidated` 由 adapter 提供
  （identity = 可信配置摘要，generation = connect / disconnect / close 递增），pool 按 lease 转发；
  `McpUiSessionAccess` 把它接到 bridge。`McpUiInstances.validate` 在凭证确属本实例后按快照撤销并清空信箱，
  连接代际变化还会主动撤销已签发的实例与模型侧工具。空闲 TTL、close、会话关闭撤销保持不变。
- 页面工具调用的审批：`YCodeApp.callMcpToolForUi` → `ToolExecutor.authorizeAppTool`，
  复用 validateInput、PreToolUse hook、项目 deny 规则与 permission broker；授权后再次校验连接快照，
  `mcpPort.callTool` 以 `appConnection` 固定连接，代际变化不重连、不重放。
- app-tools 模型面：`McpUiAppToolMailbox` 计算暴露集合（同 server 最新实例、`app__` 命名、重名让位），
  经 `YCodeApp.replaceMcpAppProvidedTools` 注册为正常 `ToolEntry`；`retainExecution` 在审批前 pin 实例，
  实例撤销时 abort 审批 / 执行，结束后 release。登记 / 注销 / 认领超时 / 连接撤销都同步工具表并失效缓存。
- app tool 结果 / 超时 / 取消：认领 5 s、执行 30 s、结果 10 MiB、参数 1 MiB；取消 / 超时 / 页面卸载
  以错误结束并向页面发 `cancelled: true`，pending 与实例登记一并清理。

## 未完成（后续 vertical slice）

- 页面 `ui/message`、`ui/update-model-context`、`ui/download-file` 的会话动作与图片校验。
- Sampling、资源更新通知的完整路由（桥已支持 `resources/subscribe` 端口，宿主实现后即可用；
  `mcp/ui` 目前未暴露 list / subscribe）。
- 多 surface 管理器、跨工具复用面板、时间线替代裁决。
- Gen UI 随包资源、vendor 映射、Tweak 私有回调。
- 插件市场 UI、远程插件同步与全部 `plugin-ui` surface 类型。
