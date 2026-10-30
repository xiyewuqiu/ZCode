# YCode 终极迭代路线

> 目标：功能为王，性能为皇。每一阶段必须端到端可运行、可验证，禁止空壳和双轨。

## 已落地基线

- goal verifier 传输回退：非流式 2xx 解析失败改走流式；两条传输失败不伪完成。
- 每个模型独立 `apiFormat`：Provider 默认、模型覆盖、执行链路一致。
- 模型目录拉取：Host 侧 `/models` / `/v1/models`、批量添加、搜索、反转选择。
- 模型选择器搜索：>4 个模型时跨 Provider 搜索、扁平结果、空状态。

## 阶段 1：模型平台补全

**功能**

1. 模型元数据目录：`models.dev` 类目录缓存（TTL、只补空字段、手动刷新），解决
   `/models` 只返回 ID 的 Provider。
2. 模型收藏/置顶：本地按 workspace 保存，模型选择器顶部固定展示。
3. 推理档位选择：模型选择器内直接切换，按模型能力校验并保留当前档位。
4. 模型列表失效刷新：配置 revision / credential 变化时失效；失败保留 last-known-good。

**验收**

- 只有 ID 的模型拉取后能自动补全 contextWindow / maxOutputTokens，用户已有值不被覆盖。
- 收藏跨会话保留，但只影响 UI 排序，不写 Provider 配置。
- 推理档位与模型能力不一致时拒绝并提示，不发非法请求。

## 阶段 2：长会话 UI 性能

1. 回合完成/折叠使用 spacer 锚定，视口不跳。
2. 滚动所有权三态：pinned / unlocked / jumping；用户上滑立即解锁，贴底才跟随。
3. Markdown 冻结前缀：流式只重解析尾部 block，已定稿 block 不重建。
4. 单轮 item 级窗口：巨型回合只挂载视口附近工作项。
5. 性能门槛：流式期间输入延迟、最早历史页加载、10 万 chunk 折叠行卡顿各一条预算。

**验收**

- 1000 回合 + 20Hz 流式下滚动与输入不卡顿；回合完成不出现视口跳动。
- 搜索/目录跳转命中折叠内容时能正确展开并定位。

## 阶段 3：Agent 可靠性

1. Git 破坏性命令防护：`reset --hard`、`clean -fd`、`checkout -- .`、`push --force`
   等必须显式授权，只读/计划模式直接拒绝。
2. 压缩事务化：start/summary/end、不拆 tool pair、summary 必须更小、崩溃可检测。
3. Goal 轮次预算 + blocked 阈值 + revision CAS。
4. 后台任务统一游标：lossy read、result-once、完成通知有界唤醒。
5. 会话事件搜索：FTS + 语义提取 + cwd 围栏。

## 阶段 4：ZCode 上游吸收

- 以 `upstream/main` 为源，按功能而非整包同步：
  - v3.14.3：workflow / dynamic-workflow / plugin / session 相关修复。
  - v3.15.1：tool search、bash 执行生命周期、websearch 客户端工具、remote UI。
- 每个功能先出差异清单，再手动移植；不直接 merge 重命名后的树。

## 阶段 5：深度联网与 Agent UX

1. Host 侧统一搜索后端：Provider-native / 自建搜索 / MCP 搜索统一为 `WebSearch`。
2. 结果去重、来源引用、查询规划、失败降级。
3. 可编辑计划面板 + 动作前预览；长时间任务可追踪、可中断、可恢复。
4. 破坏性操作预演与回滚点。

## 非目标

- 不为了“功能数量”堆空壳。
- 不引入第二套状态或长期双轨。
- 不用超时、吞错、假数据掩盖同步问题。
