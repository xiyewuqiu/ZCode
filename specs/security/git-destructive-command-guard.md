# 破坏性 Git 命令守卫

## 背景

编码 Agent 通过 Bash 工具执行 shell。`git reset --hard`、`git clean -fdx`、强制推送等命令会
直接丢弃用户未提交的工作或远端历史，是用户调研中最集中的信任风险。普通 Bash 工具已经有
“高风险、需要确认”的通用闸门，但它不知道本次命令具体危险在哪里：计划模式只给出
“只允许只读工具”，确认窗也只说“高风险工具需要批准”，模型和用户都缺少可执行的判断依据。

本守卫的目标是**精确识别**破坏性 Git 命令，给出具体原因和安全替代方案，并复用现有权限
机制决定放行、询问或拒绝；绝不改写模型发出的命令。

## 产品规则

1. 至少识别以下命令（子命令 + 参数语义，不是字符串包含）：
   - `git reset --hard`
   - `git clean` 同时带强制标记 `-f`/`--force`（含 `-fd`、`-fdx`、`-df` 等短选项组合）
   - `git checkout -- <path>`、`git checkout .`、`git checkout -f`/`--force`
   - `git restore` 默认或显式恢复工作区（`--worktree`/`-W`、或未指定 `--staged`/`-S`）
   - `git push --force`、`-f`、`--force-with-lease`、`--mirror`、`+<refspec>`
   - `git branch -D`、`git branch --delete --force`
   - `git stash drop`、`git stash clear`
   - `git reflog expire --expire=now`（含 `--expire-unreachable=now`，未加 `--dry-run`）
   - `git gc --prune=now`
2. 判定必须基于 `unbash` 解析出的 AST 和 argv，不直接对原始文本做正则匹配。
   - 支持 `&&`、`||`、`;`、管道、子 shell、花括号组、`if`/`for`/`while`/`case` 等组合结构。
   - 支持环境变量前缀（`FOO=1 git ...`）和常见包装器（`command`、`builtin`、`noglob`、
     `env`、`sudo`、`nohup`、`time`、`timeout`）。
   - 支持 `bash -c 'git reset --hard'` 这类 shell 字符串，递归解析，深度受限。
   - 命令替换/进程替换里的脚本也纳入扫描（如 `echo $(git reset --hard)`）。
3. 不误报：
   - `git log --grep="reset --hard"`、`echo "git reset --hard"`、`git commit -m "..."`；
   - `git reset --soft`、`git reset --mixed`、`git reset`；
   - `git clean -n`/`--dry-run`（即使同时带 `-f`）；
   - `git restore --staged <path>`（只动索引）；
   - `git branch -d <merged>`（只删除已合并分支）；
   - `git reflog expire --dry-run ...`。
4. 模式与权限：
   - 计划模式（含 `planEnabled`）以及任何不允许变更的只读模式：直接拒绝，理由包含具体命令。
   - 普通模式（build/edit）：走现有 `needsApproval`/权限确认机制，本次标记为 `critical` 风险，
     必须弹出明确确认；确认理由包含命中的命令、危险点和安全替代方案。
   - `yolo` 是用户主动选择的全放行模式，保留直通；`auto` 仍未实现，继续拒绝。
   - 没有可用的权限应答方时，现有 `DenyPermissionBroker` 会拒绝，守卫不自行降级为执行。
   - PreToolUse hook 的 `allow` 属于用户显式配置的授权路径，可以放行普通 `ask`；本守卫不新增
     绕过该路径的特例。`alwaysAsk` 不用于本守卫，因为它会绕过计划模式拒绝。
5. `--force-with-lease` 策略：仍视为破坏远端历史的命令，必须显式确认；但提示中优先建议
   `--force-with-lease --force-if-includes` 而不是裸 `--force`。`--force-if-includes` 单独出现
   不构成强制推送。
6. 失败语义：
   - shell 解析失败时分类器返回空结果；Bash 现有的“解析失败即非只读”逻辑仍会让普通模式
     询问、计划模式拒绝，不会静默执行。
   - 分类器是纯函数，不读文件、不访问网络、不启动进程。
   - 不吞异常、不用超时兜底、不改写命令文本。
7. 非破坏性命令的 shell 执行路径保持不变。

## 所有者与接口

- `apps/ycode-cli/packages/core/src/tool/handlers/bash-git-safety.ts`
  - 纯分类器所有者。导出 `classifyDestructiveGitCommand(command)`、
    `formatDestructiveGitReason(findings)` 等纯函数，便于测试。
  - 输出稳定的分类 id、归一化命令文本、危险说明和安全替代方案。
- `apps/ycode-cli/packages/core/src/tool/handlers/bash.ts`
  - `resolveBashPermissionCapability` 在权限判定边界调用分类器，把命中结果投影为
    `destructive: true`、`needsApproval: true`、`riskLevel: "critical"`，并附带 `reasonDetail`。
  - `executeBashHandler` 在计划模式再做一次防御性拒绝（正常流程在权限层已拒绝），覆盖
    hook/未来入口绕过权限层的极端情况。
- `permission/service.ts`
  - 只新增 `reasonDetail` 的透传：ask/deny 时把它追加到既有理由后，不改变任何 allow/deny/ask
    判定，也不影响未提供 `reasonDetail` 的工具。

## 事件顺序

```text
模型 tool call
  → executor 归一化/校验
  → PreToolUse hook
  → PermissionService.checkPermission
       ├─ Bash capability resolver: 分类器命中 → critical/needsApproval + reasonDetail
       ├─ plan/只读 → deny(reason + reasonDetail)
       └─ build/edit → ask(reason + reasonDetail)
  → PermissionRequested / PermissionDenied（用户可见）
  → 批准后 handler 执行（命令文本原样）
  → 拒绝 → PermissionDenied 错误返回模型
```

状态所有者仍是 `PermissionService` 的判定结果；分类器只提供本次调用的只读事实，不持久化、
不缓存，也不参与 UI 模型。

## 验收

1. `git reset --hard HEAD~1` 命中 `reset-hard`；`git reset --soft HEAD~1` 不命中。
2. `git clean -fdx`、`git clean -fd`、`git clean -d -f` 命中；`git clean -n -f` 不命中。
3. `git checkout .`、`git checkout -- .`、`git checkout -- "my file.txt"` 命中。
4. `git restore .`、`git restore --worktree .`、`git restore --staged --worktree .` 命中；
   `git restore --staged .` 不命中。
5. `git push --force origin main`、`git push --force-with-lease`、`git push origin +main` 命中。
6. `git branch -D feature`、`git branch --delete --force feature` 命中；`git branch -d merged` 不命中。
7. `git stash drop`、`git stash clear` 命中；`git stash list` 不命中。
8. `git reflog expire --expire=now --all` 命中；`git reflog expire --dry-run --expire=now` 不命中。
9. `git gc --prune=now` 命中；`git gc` 不命中。
10. `FOO=1 git reset --hard`、`cd repo && git reset --hard`、`bash -c 'git reset --hard'`、
    `echo $(git reset --hard)` 命中。
11. `git log --grep="reset --hard"`、`echo "git reset --hard"`、`git commit -m "reset --hard"` 不命中。
12. 计划模式下命中命令被拒绝且理由包含命令文本；build 模式下确认理由包含命令文本和替代方案；
    非破坏性命令不改变现有执行路径。
