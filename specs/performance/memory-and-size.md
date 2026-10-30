# 内存与安装包体积基线

## 实测基线（2026-10-29，Windows）

- 13 个 YCode/node 进程，工作集合计约 2.3GB：renderer 465MB、4 个 app-server 约
  648MB、GPU 243MB、main 125MB。
- `~/.ycode` 1.3GB：DB 764MB、artifacts 241MB、logs 123MB、exec 59MB、rollout 42MB。
- SQLite `part` 表 593MB：tool 输出 407MB、reasoning 52MB；单条最大 373KB。
- `app.asar` 262MB、`dist` 787MB；asar 内含大量 renderer 已打包依赖。

## 本轮规则

1. **Renderer 依赖不进 asar**：`out/renderer` 已由 Vite 全量打包。仅被
   `@ycode/ui` 浏览器代码引用、main/host 不 import 的包从 asar 排除；新 main/host
   运行时依赖必须进入 `REQUIRED_ASAR_RUNTIME_MODULES`，不得依赖 electron-builder 自动收包。
2. **Shiki 共享 highlighter**：每个主题一个 highlighter，语言按需 `loadLanguage`；
   不再按 `theme:language` 各建实例。
3. **Shiki token 缓存有界**：LRU，最多 400 条、估算 24MiB；命中后刷新 LRU；
   诊断上报条数与字节数。
4. **主窗口关闭拼写检查**：聊天/代码输入不依赖 Chromium 字典和后台检查器。
5. **控制面进程空闲回收**：plugin-management 与 mcp-status 专用 app-server 在没有
   在飞请求且 storage ready 后 5 分钟回收；chat 会话进程不套用该策略。
6. 不通过删除会话历史、降低安全校验或吞错来换内存/体积。

## 验收

1. 下一次生产打包后 `app.asar` 明显小于 262MB；renderer-only 包不出现在 asar；
   启动、插件管理、浏览器、代码高亮、编辑 diff 均正常。
2. Shiki 跨多种语言后 highlighter 数量 ≤2，tokensCache ≤400 条且 ≤24MiB。
3. 主窗口 `webPreferences.spellcheck === false`。
4. 插件管理 app-server 空闲 5 分钟后退出，再次打开插件设置能冷启动恢复。
5. chat app-server 不因本策略被回收；运行中的后台任务不受影响。

## 未验证

- 当前轮未执行生产打包，asar 实际缩减需下一次 `package:desktop` 验证。
- Renderer 455MB 的具体构成仍需 Chrome heap snapshot；本轮先消除了 Shiki 明确的无界缓存
  和一个重复依赖大头。
