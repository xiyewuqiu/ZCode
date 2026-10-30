# ApplyPatch 工具规范

## 1. 背景与目标

`ApplyPatch` 是一个 provider 可见的结构化补丁工具：模型把多处文件改动写成一份
自由文本补丁（freeform `patch_text`），由工具在本地工作区一次性校验并应用。

它解决的是 `Edit` 的 `old_string` / `new_string` 难以表达的局部改动——尤其是：

- 同一份补丁内跨多个文件的新增、修改、删除、移动；
- 需要按行号上下文定位、而不是按整段精确文本定位的修改；
- 希望先看到完整 diff 再决定是否落盘的场景。

目标：

- 语法严格、失败可解释，不靠宽松回退掩盖模型意图；
- 预检完成后再写文件，单文件原子替换；
- 路径、权限、压缩、子代理工具面与现有基础设施对齐；
- UI 不做专门适配，复用现有通用工具展示与 diff 投影。

## 2. 工具契约

| 项           | 值                                                        |
| ------------ | --------------------------------------------------------- |
| 工具名       | `ApplyPatch`                                              |
| 输入         | `{ patch_text: string }`（strict，只允许该字段）          |
| 输出         | `{ files, structuredPatch, summary }`                     |
| 模型可见顺序 | 进入 provider-visible 排序集合，按字母序排在 `Agent` 之后 |
| 注册         | `builtInTools` 常驻注册（不受动态工作流灰度门影响）       |
| 并发         | `concurrentSafe: false`                                   |
| 超时         | 默认与上限均为 30s，不允许单次调用覆盖                    |

`files[]` 每项包含：

- `filePath`：实际写入目标（解析后的绝对路径）；
- `type`：`add` / `update` / `delete` / `move`；
- `movePath`：移动目标（仅 `move`）；
- `structuredPatch`：该文件的 unified diff hunks；
- `additions` / `deletions`：按 hunk 行首 `+` / `-` 统计。

顶层 `structuredPatch` 为所有文件 hunk 的拼接，`summary` 每文件一行，前缀
`A`（新增）、`M`（修改/移动）、`D`（删除）。

## 3. 补丁语法

补丁必须由 `*** Begin Patch` 开始、`*** End Patch` 结束；两者之间只允许下列
section。空行可存在于 section 之间，其他无法识别的行一律视为语法错误。

```text
*** Begin Patch
*** Add File: <path>
+<content line>
+<content line>

*** Update File: <path>
*** Move to: <new path>          # 可选，必须紧跟 Update File
@@ <change context>             # 可选上下文提示
 <context line>
-<removed line>
+<added line>
*** End of File                 # 可选，仅允许出现在 hunk 内

*** Delete File: <path>

*** End Patch
```

规则：

1. `*** Add File:` 后每个内容行必须以 `+` 开头，`+` 后的文本原样成为文件内容；
   工具统一补一个结尾换行。
2. `*** Update File:` 后允许零个或多个 `@@` hunk。hunk 内：
   - 空格前缀 = 上下文行（同时进入旧/新序列）；
   - `-` 前缀 = 删除行；
   - `+` 前缀 = 新增行；
   - `*** End of File` 表示该 hunk 必须锚定文件末尾。
3. `*** Move to:` 只能出现在 `*** Update File:` 之后、首个 hunk 之前；移动 =
   在目标路径写入新内容，再删除源文件。
4. `*** Delete File:` 只删除显式列出的文件，不做通配。
5. 兼容 `cat <<'EOF' ... EOF` 形式的外层 heredoc，会先剥掉 shell 包装。
6. 解析前统一把 CRLF / CR 归一为 LF；输出写回时按原文件检测到的行尾恢复。
7. `*** Begin Patch` / `*** End Patch` 缺失、顺序颠倒，或 section 内出现非法行，
   均返回 `apply_patch_invalid_patch`，不进入任何文件写入。

## 4. 应用语义

### 4.1 行模型

- 文件内容按逻辑行处理；读取结果已由 `FileSystemPort` 归一为 LF。
- hunk 匹配从严格到宽松依次尝试：
  1. 精确相等；
  2. 忽略行尾空白；
  3. 忽略首尾空白；
  4. Unicode 规范化（弯引号、全角/长破折号、省略号、不换行空格）后比较。
- `*** End of File` 的 hunk 优先从文件末尾向前对齐。
- 旧行序列末尾为空行但未命中的场景，会去掉该尾行再试一次，兼容“文件末尾换行
  是否计入”的差异。
- 所有 hunk 先在原文本上定位，再从后往前 splice，避免前一个 hunk 的长度变化
  影响后一个 hunk 的偏移。
- 输出保证以单个结尾换行结束。

### 4.2 编码与行尾

- `update` / `move` / `delete` 读取现状时携带原文件的 `encoding` 与
  `lineEndings`。
- 写回时把逻辑 LF 文本交回 `FileSystemPort`，由端口按原编码和行尾落盘；
  支持 UTF-8 以及 GB2312 / GBK / GB18030 等已声明编码。

## 5. 安全与路径

### 5.1 路径解析

每个补丁路径都经过：

1. `resolveWorkspacePath({ operation: "write" })`：与 `Write` / `Edit` 共用同一套
   相对路径解析规则（相对 `workingDirectory`，绝对路径原样规范化）；
2. 工作区包含校验：解析后的绝对路径必须位于 `workspaceRoot` 之内。

以下情况直接拒绝，错误码 `apply_patch_invalid_patch`：

- `../` 逃逸到工作区外；
- 跨盘符或绝对路径落到工作区外；
- 路径解析结果等于工作区根目录本身。

包含判断是词法的（`path.relative`），不执行 `realpath`。符号链接逃逸由
`FileSystemPort` 与宿主权限层负责；工具不额外引入磁盘探测，避免权限判定被
一次 I/O 失败改变。

### 5.2 写入策略

- **先预检、后写入**：所有 section 先完成“目标是否存在 / 能否读出 / 能否算出新
  内容”的校验；任一 section 失败则整份补丁不写任何文件。
- **单文件原子**：写入使用 `writeTextFile({ atomic: true, createParents: true })`。
- **更新防竞态**：`update` 携带预检时读到的 `expectedRevision`；文件在预检与
  写入之间被修改时，端口返回 `stale_write`，不会覆盖他人改动。
- `add` 要求目标不存在；`delete` / `update` 要求目标存在。
- `move` 当前按上游语义写入目标并删除源；目标已存在时由原子写覆盖。

## 6. 权限与工具面

### 6.1 权限元数据

| 字段                        | 值                                                                                |
| --------------------------- | --------------------------------------------------------------------------------- |
| `permission`                | `edit`                                                                            |
| `riskLevel`                 | `medium`                                                                          |
| `sideEffectScope`           | `workspace`                                                                       |
| `needsApproval`             | `true`                                                                            |
| `readOnly`                  | `false`                                                                           |
| `destructive`               | `false`（删除是显式 section 且全程需确认；`destructive` 高破坏档仍保留给 `Bash`） |
| `patternSources`            | `input`（权限规则主体取 `patch_text`）                                            |
| `alwaysAllowPatternSources` | `input`                                                                           |
| `denyPriority`              | `beforeAsk`                                                                       |

`PermissionService.isWriteTool` 已包含 `ApplyPatch`：

- Edit 模式：`permission === "edit"` 且 `sideEffectScope === "workspace"`，按文件
  编辑工具放行；
- Build 模式：存在副作用且需要确认，走 ask；
- Plan 模式：非只读工具，需确认；
- Yolo：按现有模式策略放行。

Hook 匹配别名：`ApplyPatch` 同时匹配 `Write` 与 `Edit` 的 hook matcher，避免为
同一类文件改动重复配置 hook。

### 6.2 压缩与可见性

- `DEFAULT_MICROCOMPACT_COMPACTABLE_TOOLS` 包含 `ApplyPatch`，历史补丁结果可被
  微压缩清理。
- `orderProviderVisibleToolContracts` 的排序集合包含 `ApplyPatch`。
- `packages/shared/src/tool-identity.ts` 已把 `ApplyPatch` 归类为 `file-write`，
  UI 按现有通用逻辑展示，无需专门适配。

### 6.3 子代理工具面

- Explore 子代理使用显式白名单，不包含 `ApplyPatch`，保持只读语义。
- general-purpose 子代理使用 `"*"`，注册后自动获得 `ApplyPatch`。
- workflow actor 只做减法，未移除 `ApplyPatch`，仍然可以编辑工作区。
- workflow child 的禁用名单只针对 `alwaysAsk` 的工作流编排工具，`ApplyPatch`
  不在其中。

## 7. 状态与执行顺序

```text
模型 tool_use(ApplyPatch, patch_text)
        │
        ▼
ToolExecutor ── 权限判定（edit / workspace / needsApproval）
        │
        ▼
ApplyPatch handler
  1. parseStructuredPatch        （纯文本，不碰磁盘）
  2. verifySection × N           （stat / readTextFile / derivePatchedContent）
  3. 全部通过后逐个落盘          （writeTextFile atomic / removeFile）
        │
        ▼
ToolExecutionResult(output) ── 通用 UI diff / compact / 历史
```

唯一写入路径是 `FileSystemPort`；handler 不直接使用 `node:fs`。工具不维护额外
持久化状态，也不在成功后回填 `ReadFileState`，因此后续 `Write` / `Edit` 仍会
要求重新读取，符合“补丁后内容可能变化”的事实。

## 8. 失败语义

| 错误码                       | 触发条件                                                       | 可恢复 |
| ---------------------------- | -------------------------------------------------------------- | ------ |
| `apply_patch_invalid_patch`  | 缺少 Begin/End、非法 section/hunk 行、路径逃逸、update 无 hunk | 是     |
| `apply_patch_empty_patch`    | 语法合法但没有任何 section                                     | 是     |
| `apply_patch_file_not_exist` | `update` / `delete` / `move` 源文件不存在                      | 是     |
| `apply_patch_file_exists`    | `add` 目标已存在                                               | 是     |
| `apply_patch_hunk_not_found` | hunk 上下文无法定位                                            | 是     |
| `apply_patch_io_error`       | 落盘阶段失败（权限、磁盘、stale_write 等）                     | 是     |

约定：

- 所有业务失败通过 `CoreErrorType.ToolExecutionFailed` 返回，`recoverable: true`，
  `context.code` 为上述错误码，`context.toolName = "ApplyPatch"`。
- 预检失败：整份补丁未写盘，错误信息指出具体文件。
- 落盘失败：错误信息与 `context` 明确报告：
  - `appliedFiles`：已经完成的文件；
  - `failedFile`：失败发生的目标路径；
  - 文案区分“完全未写入”与“已部分写入 N/M”。
- 取消（`abortSignal` 已中止）不包装成 `apply_patch_io_error`，保留端口的
  `cancelled` 语义，由 executor 统一收口。
- 成功时返回每个文件的 hunk 与统计；模型侧内容为
  `Patch applied successfully.` 加 summary 列表。

## 9. 验收场景

1. **新增**：`*** Add File` 创建新文件，内容与 `+` 行一致；目标已存在时报
   `apply_patch_file_exists` 且不覆盖。
2. **修改**：`*** Update File` + 多 hunk 正确替换；上下文宽松匹配可处理行尾空白
   差异；`*** End of File` 锚定末尾。
3. **删除**：`*** Delete File` 删除已存在文件；不存在时报
   `apply_patch_file_not_exist`。
4. **移动**：`*** Update File` + `*** Move to` 在新路径写入新内容并删除源文件。
5. **语法错误**：缺少 End marker、非法 hunk 行、update 无 hunk 均报
   `apply_patch_invalid_patch`，且不产生任何文件写入。
6. **空补丁**：只有 Begin/End、没有 section，报 `apply_patch_empty_patch`。
7. **路径逃逸**：`*** Add File: ../outside.txt` 或工作区外绝对路径被拒绝，报
   `apply_patch_invalid_patch`，不写盘。
8. **预检失败不落盘**：补丁前半段合法、后半段 hunk 不匹配时，整份补丁不写任何
   文件。
9. **部分失败**：预检通过但第二个文件写入失败时，错误信息包含已应用文件列表与
   失败文件路径，且第一个文件保持原子写入结果。
10. **权限与工具面**：Build 模式触发确认；Edit 模式按文件编辑放行；Explore 子
    代理看不到该工具；`ApplyPatch` 出现在 provider-visible 顺序与微压缩可清理
    列表内。

## 10. 非目标

- 不实现跨文件的全局事务回滚；落盘阶段失败只报告已应用/失败文件，不回滚已成功
  的文件。
- 不为每个文件生成独立的 workspace checkpoint：现有 checkpoint 机制按“单个
  top-level `filePath`”建模，`ApplyPatch` 一次可改多个文件，复用会造成错误的
  单文件快照语义。
- 不修改 UI；现有通用 diff/工具块展示直接消费输出。
- 不改变 `Write` / `Edit` 的 read-before-write 规则。
