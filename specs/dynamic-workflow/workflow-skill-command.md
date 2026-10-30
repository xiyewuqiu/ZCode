# Dynamic Workflow 技能、`/workflow` 命令与技能门

状态：首切片，对应上游 ZCode v3.14.3（29628c9a）的技能/命令/技能门部分。
范围：随 CLI 分发的 `dynamic-workflows` 技能包、`/workflow` 内置命令、`--enable-workflow` 开关、四个创作工具（`CreateWorkflow` / `AmendWorkflow` / `SaveWorkflow` / `EvalWorkflowSnippet`）的技能门，以及内联草稿的 read-state 持久化。
不包含：留白（holes / `FillWorkflowHole`）、run delta / 表 / 淘汰、协议结构变更、厂商与账号逻辑、工具描述瘦身（`CreateWorkflow` 等仍保留现有长描述）。

## 1. 产品规则

### 1.1 技能包

- `apps/ycode-cli/packages/bundled-skills/skills/dynamic-workflows/` 随 CLI 分发，包含 `SKILL.md`、`patterns.md`、`examples.md`，三者都是必需资产。
- 它不是插件：不进市场目录、没有启停开关、不能卸载，也不出现在设置页技能列表或 `$` 引用面板。其发现来源固定为 `source: "bundled"`、`scope: "system"`。
- 同名技能按发现顺序取先者；内置包 `priority = 1_000_000`，排在同名用户/项目/插件技能之后。
- 动态工作流关闭（`dynamicWorkflowEnabled === false`）时，`SKILL.md` 的绝对路径进入技能发现的 `disabledPaths`，技能不可加载。
- 必需资产缺失时**整包拒绝**并记录 warn，而不是装出一个引用文件缺失的技能。此时技能门自动失效（见 1.3），工作流编辑不被锁死。

### 1.2 `/workflow` 命令

- `workflow` 是内置 prompt 命令，正文随 CLI 编译，不依赖可卸载插件；命令名进入保留字表，用户或插件的同名命令不会被展开。
- 正文包含 `$ARGUMENTS`，并要求模型先加载 `dynamic-workflows` 技能、再写脚本调用 `CreateWorkflow`。
- 命令出现在共享 help 表与 App `/` 面板（紧随 `goal`）；动态工作流关闭时 App 目录剔除该入口，命令展开也返回 `undefined`（原文按普通 prompt 处理）。
- headless：`--enable-workflow` 只允许与 `-p/--prompt` 或 `--target` 同用；未给出时本次会话显式为关闭。
- TUI / 协议 Host 默认不写该字段，保持「缺席即开启」；协议 Host 由 `appRuntimePreferences` 显式下发。

### 1.3 技能门

四个创作工具的 `resolveInput` 在解析脚本之前检查技能：

| 工具 | 何时需要技能 | 例外 |
| --- | --- | --- |
| `CreateWorkflow` | 提交脚本（`script` 或 `path`，或两者都省略的普通调用） | 仅 `saved` 运行已保存定义 |
| `AmendWorkflow` | 带 `script` 或 `path` | 只改设定（沿用前驱脚本） |
| `SaveWorkflow` | 总是 | — |
| `EvalWorkflowSnippet` | 总是 | — |

- 判据来自 runtime 的 provider 可见历史：存在一次成功完成（有对应 tool 结果且 `isError !== true`）的 `Skill` 调用，其 `skill` / `name` 等于 `dynamic-workflows`。
- 判据随历史重建：compaction 移除该调用后门重新关上；resume / rewind 随历史恢复，不维护第二份会话状态。
- 未加载时返回稳定错误码 `428`，文案点名当前工具并要求先调用 `Skill`；不进入权限确认、不启动、不停止任何 run。
- **缺席即放行**：没有 `hasLoadedSkill` 探针（无 `skillPort` 的会话、未提供探针的宿主）时不设门。
- **技能不可发现时不设门**：探针由 runtime 注入，注入条件是「本会话有 `skillPort`，且技能发现结果里存在 `dynamic-workflows`」。技能包缺失或发现失败时门关闭，避免出现「要求加载一个不存在的技能」的死锁。

## 2. 状态所有权与事件顺序

```text
技能包位置（唯一解析器）
  bootstrap/app/bundled-skills.ts
    ├─ SEA：<cli storage>/bundled-skills/<content-hash>/（首启按 hash 解压，目录名即身份）
    └─ 文件系统：入口旁的 packages/bundled-skills（开发、桌面、远端 stage）
        │
        ├─ create-app：extraResolvedRoots 注入 skillPort（session 的技能发现）
        └─ skills.ts：`ycode skills list/inspect` 走同一个解析器

技能门（读侧，无独立状态）
  runtime.messageHistory.borrowReadOnlyRuntimeEntries()
    └─ core/agent/loaded-skills.ts#sessionHasLoadedSkill
        └─ ToolInputResolutionContext.hasLoadedSkill
            └─ handlers/workflow-skill-gate.ts#{requireDynamicWorkflowSkill, ...NeedsSkill}

草稿 read-state（写侧）
  CreateWorkflow/AmendWorkflow 内联草稿写盘后
    └─ ToolExecutionContext.fileSystemPort.stat → runtime.readFileState
        └─ recordReadFileStateMetadata → tool part metadata.readFileState
            └─ resume：read-file-state-hydrator 恢复同一份 read-state
```

- 技能发现只有一个解析器（`resolveBundledSkillRoots`）；两个调用点只传不同存储根/日志。
- 技能门不持有状态；唯一事实是历史，compaction / resume / rewind 天然一致。
- 草稿 read-state 的唯一所有者是 `runtime.readFileState`；tool part metadata 是它的持久化投影，resume 时回灌。

### 2.1 SEA 解压幂等

1. `sea.isSea()` 为假 → 走文件系统候选。
2. 读取 `ycode-bundled-skills/manifest.json`；版本不是 1、缺 `hash` 或 `files` → 视为无 SEA 包。
3. 目标目录 `<cli storage>/bundled-skills/<hash>/`，`.ycode-bundled-skills-seed.json` 记录 hash 且必需资产齐全 → 直接复用。
4. 否则写唯一临时目录（pid + uuid），逐文件校验 sha256，写 marker 后 `rename` 到目标。
5. `rename` 失败且目标已完整 → 并发赢家先到，复用；其他失败回退到任一完整旧包并 warn；临时目录清理。

## 3. 接口

| 位置 | 接口 | 说明 |
| --- | --- | --- |
| `@ycode/contracts` | `DYNAMIC_WORKFLOW_SKILL_NAME = "dynamic-workflows"` | core 的门与 bootstrap 的技能包共用，两者不能互相 import |
| `bootstrap/app/bundled-skills.ts` | `resolveBundledSkillRoots({cliStorageRoot, logger})` | 返回 0 或 1 个 `SkillRoot` |
| `bootstrap/app/bundled-skills.ts` | `findMissingBundledSkillPackPaths(packRoot)` | 必需资产检查，测试与诊断复用 |
| `bootstrap/builtin-workflow-command.ts` | `expandBuiltinWorkflowCommandPrompt(args)` | 复用 contracts 的自定义命令展开规则 |
| `core/agent/loaded-skills.ts` | `sessionHasLoadedSkill(entries, skillName)` | 历史判据 |
| `core/tool/handlers/workflow-skill-gate.ts` | `requireDynamicWorkflowSkill(context, toolName)` | 返回失败或 `undefined` |
| `core/tool/handlers/workflow-skill-gate.ts` | `createWorkflowNeedsSkill(input)` / `amendWorkflowNeedsSkill(input)` | 两个例外 |
| `ToolInputResolutionContext` | `hasLoadedSkill?(skillName)` | 探针；缺席即放行 |
| `ToolExecutionContext` + metadata | `PersistedReadFileStateTool` 增加 `CreateWorkflow` / `AmendWorkflow` | resume 恢复草稿 read-state |

## 4. 失败语义

- 技能未加载：工具调用以 `428` + 结构化文案失败；没有确认窗、没有 run 状态变化。
- 技能包缺失：`resolveBundledSkillRoots` 返回 `[]` 并 warn（`bootstrap.bundled_skills`），技能门因探针缺席而放行；工作流仍可编辑。
- SEA 解压失败：清理临时目录；优先复用完整旧包，否则返回 `undefined`（同上，门放行）。
- 草稿 stat 失败：不记 read-state，不使工具调用失败；模型下一次 `Edit` 退回「先 Read」。
- `/workflow` 在关闭态：不展开、不进目录；手打命令名按普通 prompt 处理（与「命令不存在」同形）。

## 5. 验收场景

1. 开发态 `packages/bundled-skills` 存在时，`resolveBundledSkillRoots` 返回 `skills/` 根，`source: "bundled"`、`scope: "system"`、`priority: 1_000_000`。
2. 删除 `examples.md` 后同一目录不被接受，返回 `[]`，warn 只记录一次。
3. SEA 资产 manifest 的 hash 与解压目录名一致；二次启动不重复解压。
4. `sessionHasLoadedSkill`：成功的 `Skill(dynamic-workflows)` 返回 true；只有调用没有结果、结果 `isError`、或技能名不同返回 false。
5. 门：`CreateWorkflow({saved:{name}})` 在未加载技能时放行；`CreateWorkflow({script})` 在未加载时返回 428；`AmendWorkflow` 只改 `max_concurrency` 放行，带 `script` 被拒；`SaveWorkflow` / `EvalWorkflowSnippet` 未加载即拒。
6. 探针缺席（无 `skillPort` 或技能未发现）时四个工具全部放行。
7. resume 后，历史里成功的 `Skill(dynamic-workflows)` 仍使门放行；compaction 移除它后门重新拒绝。
8. `/workflow` help 表条目存在，App 目录顺序为 `goal`、`workflow`、`compact`、`init`；关闭态目录不含 `workflow`，展开返回 `undefined`。
9. `--enable-workflow` 无 `-p/--target` 时报作用域错误并退出码 1。
10. `CreateWorkflow` / `AmendWorkflow` 内联草稿写盘后，read-state 含该路径；resume 后同一路径仍可 `Edit`。

## 6. 迁移边界

- 不迁移协议字段、事件或 run journal 结构；不引入留白与 run delta。
- `CreateWorkflow` 等工具描述保持现状（本切片不做描述瘦身），技能只补充写作规则与示例。
- 关键说明：`dynamic-workflows` 技能与技能门必须同批发布；只发门不发技能会让所有脚本提交被拒。
