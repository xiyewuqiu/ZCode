# 长会话浏览器回归

## 切换任务首帧标题

```powershell
pnpm exec vite --config packages/ui/test/browser/taskSwitch.vite.config.mts
node packages/ui/test/browser/run-task-switch.mjs
```

使用本机 Chrome、真实标题 hook 与受控服务/转换依赖，记录 layout effect 中每次 commit。
覆盖切任务首帧、同 taskId 跨工作区/连接、迟到回包、列表标题优先、草稿与读取失败。
不连接真实 Host 或 Agent，也不替代会话协议投影测试。

## Agent 队列键盘与移动端

独立启动队列场景，使用真实组件、样式和共享常量，以模拟回传验证 UI，不连接真实 Agent：

```powershell
pnpm exec vite --config packages/ui/test/browser/queue.vite.config.mts
node --test packages/ui/test/browser/queue.e2e.mjs
node packages/ui/test/browser/run-queue-feedback.mjs
```

测试需要已安装浏览器的 `agent-browser`；可用 `AGENT_BROWSER_BIN` 指定可执行文件。
覆盖键盘移动、取消、焦点保留、锁定行、无排序权限、中英文提示和手机按钮尺寸。
`run-queue-feedback.mjs` 使用本机 Chrome，验证四类操作拒绝、网络结果未知的可见提示及无未处理异常；
真实 SessionPane 调用方仍需在完整应用中联调。
截图写入 `.tmp/queue-e2e`，测试只关闭自己的浏览器会话。

## 子 Agent 目录

启动下述 Vite 测试服务后运行：

```powershell
node packages/ui/test/browser/run-subagent-directory.mjs
corepack pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/sessionSubagentsQuery.test.ts packages/ui/test/visibleProjection.test.ts
```

使用本机 Edge、5,100 条合成记录和真实目录组件 / 查询 hook，覆盖虚拟挂载上限、20Hz 无关投影更新隔离、滚动锚点、键盘首尾与打开、焦点保留、分页重试和跨 scope 在途隔离。测试包含亮暗主题、手机宽度、20px UI 字号和 reduced-motion；截图及帧采样位于 `node_modules/.cache/subagent-directory/`。此 fixture 不启动真实 Agent、Host 或远程连接。

## 会话永久删除

保持 Vite 测试服务运行后，从仓库根目录执行：

```powershell
node packages/ui/test/browser/run-task-storage.mjs
node packages/ui/test/browser/run-task-delete-entry.mjs
corepack pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/taskStorageDialogStore.test.ts
```

第一个脚本覆盖预检弹窗本身的确认、阻塞、重试与迟到结果隔离；第二个脚本挂载真实 `TaskActionMenuContent` 与 app 级弹窗 host，验证任务右键菜单里的「删除会话…」能打开预检弹窗、确认前不可删除、确认后提交清理、中文文案以及只读 workspace 下入口被禁用。fixture 使用合成 service，不连接真实 Host 或删除真实历史。

## 会话目录功能回归

保持下述 Vite 测试服务运行后，从仓库根目录执行：

```powershell
node packages/ui/test/browser/run-outline.mjs
corepack pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/conversationOutline.test.ts packages/ui/test/longConversation.test.ts packages/ui/test/conversationPreview.test.ts
corepack pnpm exec tsc -p packages/ui/test/tsconfig.long-conversation.json
```

浏览器入口复用本机 Edge 和已有 playwright-core，不需要账号。覆盖 2,000 条目录的桌面、390px 手机、260px 窄屏，完整问题搜索、序号定位、键盘首尾/翻页、输入法保护、焦点恢复、失败重试及过期异步结果隔离；真实 Timeline fixture 另测 5,000 段工作记录中的跳转、流式选择保持和同路径工作区切换。中英文与深色截图位于 `.tmp/conversation-outline/`。加载异常使用受控 fixture 注入，不代表真实远程链路验收。

## 长会话测试入口

从仓库根目录启动独立测试页，无需服务端、账号或真实会话数据：

```powershell
corepack pnpm exec vite --config packages/ui/test/browser/vite.config.mjs
```

在另一个终端运行：

```powershell
npx --yes agent-browser --session long-conversation open http://127.0.0.1:5199/packages/ui/test/browser/longConversation.html
Get-Content packages/ui/test/browser/measureScrolling.js -Raw | npx --yes agent-browser --session long-conversation eval --stdin
Get-Content packages/ui/test/browser/verifyInteractions.js -Raw | npx --yes agent-browser --session long-conversation eval --stdin
```

默认包含 100 轮、最后一轮的 1000 段 Markdown 和 40 个成功压缩标记，合计 1637 行。参数 `turns`、`work` 可调整规模。

`measureScrolling.js` 在 20 次/秒的流式更新下采样 180 帧滚动，跳过前 16 帧，输出帧间隔分布和挂载数量。`verifyInteractions.js` 断言搜索早期问题、展开/收起历史、输入、回到底部、完成态迁移及消息不丢失。交互测试会结束当前工作轮，再测量需重新加载页面。

窄屏回归使用 `npx --yes agent-browser --session long-conversation set viewport 390 844`，重新加载后再次运行两个脚本。40 项以上的工作列表使用动态测高的虚拟窗口；查找命中、文字选择和焦点会暂缓回收对应项。

完整长单轮回归（保持上面的 Vite 服务运行）：

```powershell
node packages/ui/test/browser/run-regressions.mjs
```

入口使用本机 Edge 的隔离 headless profile；也可设置 `ZCODE_TEST_BROWSER_CHANNEL=chrome` 使用本机 Chrome。覆盖 1258×622 和 390×844、5,000 段工作正文、200 次压缩标记、20Hz 更新、远处查找、选区回收、10 次会话切换、后台追赶、整轮复制。每个视口报告帧分布；功能断言失败返回非零，帧耗时是观测值，不作为跨机器阈值。截图保存在 `.tmp/desktop-iteration/`。

Windows 原生窗控及真实 Host 启动分别运行：

```powershell
node packages/desktop/test/run-window-chrome.mjs
node packages/desktop/test/run-window-chrome.mjs --host
```

两者均使用独立临时 profile 与数据目录，退出后释放。Host 用例编译并启动真实 Window Host，校验数据库就绪和预热端口交接；它不执行 Agent 模型请求，也不代表完整 SessionPane/Host/Agent 链路的压力结果。

测试与类型检查：

```powershell
corepack pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/shared/test/conversationBatch.test.ts packages/ui/test/longConversation.test.ts
corepack pnpm exec tsc -p packages/ui/test/tsconfig.long-conversation.json
```

## 会话派生模型与桌面布局

`shellPerformance.html` 复用 SessionPane 的实际分享/订阅 hooks、窗控、Panel 动画和设置加载壳，使用合成 store 和平台服务，不需要真实 Host。

```powershell
npx --yes agent-browser --session shell-performance open http://127.0.0.1:5199/packages/ui/test/browser/shellPerformance.html
Get-Content packages/ui/test/browser/verifyShell.js -Raw | npx --yes agent-browser --session shell-performance eval --stdin
```

再次运行先重新加载页面。窄屏和减少动画验证，在页面成功打开后设置（检查脚本结果中的 viewport 与 reducedMotion）：

```powershell
npx --yes agent-browser --session shell-performance set viewport 390 844
npx --yes agent-browser --session shell-performance set media light reduced-motion
'location.reload()' | npx --yes agent-browser --session shell-performance eval --stdin
Get-Content packages/ui/test/browser/verifyShell.js -Raw | npx --yes agent-browser --session shell-performance eval --stdin
npx --yes agent-browser --session shell-performance close
```

断言包含关闭分享时零历史读取、持续更新不重复订阅、换 store/卸载清理、候选 scope 隔离、原生窗控避让区缩放、Panel 收放、设置页加载返回。测试页不调用分享发布接口。

## 大规模分享目录

`shareDirectory.html` 挂载实际分享选择面板，提供 2,000 项合成候选；最后一项初始处于运行状态。

```powershell
npx --yes agent-browser --session share-directory open http://127.0.0.1:5199/packages/ui/test/browser/shareDirectory.html
Get-Content packages/ui/test/browser/verifyShareDirectory.js -Raw | npx --yes agent-browser --session share-directory eval --stdin
corepack pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/conversationPreview.test.ts
```

覆盖虚拟挂载数量、摘要搜索、首尾与方向键跨屏导航、Space 选择、Enter 定位、隐藏选择保留、运行中禁用、运行完成、260px 分屏容器及关闭/重开。每次重跑先刷新页面恢复数据。设置 390×844 视口与 reduced-motion 后重跑，可查看输出中的视口和动效偏好是否实际生效。

```powershell
npx --yes agent-browser --session share-directory set viewport 390 844
npx --yes agent-browser --session share-directory set media dark reduced-motion
'location.reload()' | npx --yes agent-browser --session share-directory eval --stdin
Get-Content packages/ui/test/browser/verifyShareDirectory.js -Raw | npx --yes agent-browser --session share-directory eval --stdin
npx --yes agent-browser --session share-directory close
```

结束后关闭测试浏览器并停止 Vite：

```powershell
npx --yes agent-browser --session long-conversation close
```
