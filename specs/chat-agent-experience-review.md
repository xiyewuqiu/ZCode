# 聊天与 Agent 体验：首轮研究记录

日期：2026-10-02。范围为当前工作区的聊天投影、目录、队列操作与界面约束；
不是全仓审计，也不代表已经完成界面实机验收。

## 当前结构

| 路径                                               | 当前职责                                 | 迭代约束                                     |
| -------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `packages/ui/src/v4/ConversationTimeline.tsx`      | 虚拟列表、历史加载、滚动锚定、回合投影   | 保留回合引用复用、历史前插锚定与会话滚动记忆 |
| `packages/ui/src/v4/ConversationTurnNavigator.tsx` | 导航轨道、当前问题定位、目录入口         | 用户问题是导航粒度，不能用 turn 数替代问题数 |
| `packages/ui/src/v4/ConversationOutline.tsx`       | 虚拟化目录、延迟搜索、键盘导航、加载历史 | 保留中文输入法保护与移动端安全字号           |
| `packages/ui/src/v4/ConversationQueuePanel.tsx`    | 权威队列的展示、排序与操作入口           | 不在 UI 维护第二份已接受队列                 |
| `packages/ui/src/v4/SessionPane.tsx`               | 命令提交、ACK 处理、撤回到输入框         | 撤回先等删除确认，异步返回不得串入新会话     |

## 优先级与证据

1. **工作分工**：用户已明确另一个 agent 负责代码清理；本轮专注体验、界面流转性能和 Agent 操作。
   清理中的类型与依赖问题仅记录验证状态，不作为本轮推进前置条件。
2. **长会话目录投影（本轮已实现）**：流式更新让导航对全部回合重新生成摘要。
   现改为组件独立的弱引用缓存，保留历史项引用，前插位置和配置变化会失效。
   详见 `chat-navigation-performance.md`。
3. **队列键盘排序（已复现并修复）**：原先仅注册 PointerSensor，浏览器中空格与方向键不改变顺序，
   但已有读屏提示声称可用空格排序。现复用项目已有 KeyboardSensor 与 sortableKeyboardCoordinates，
   补齐中英说明、位置播报、取消、焦点保持及锁定保护。手机按钮最小高度改为 40px。
4. **队列拒绝反馈（第三轮已实现）**：删除、立即发送、排序和恢复队列统一接入结果处理。
   拒绝展示操作对应提示，传输失败/duplicate 提示结果暂不能确认；不重发、不修改权威队列。
   迟到回包仍记录日志，已切换或卸载的会话不弹提示。五项定向测试与真实队列/toast 浏览器场景通过；
   完整 SessionPane 与真实 Host/Agent 联调尚未执行。
5. **滚动目录扫描（已修复）**：每个 scroll 都重建全历史 Map；现利用已有 unitIndex 有序契约二分查询。
   1 万条目录、500 次滚动的首次对照为 242.5 ms → 0.4 ms；另有读取次数断言，
   确认不再读取全部 1 万条目录，语义与原算法对照一致。
6. **切任务标题首帧（第三轮已复现并修复）**：原 hook 在 effect 内才清理旧 meta。
   浏览器 layout effect 记录确认切 B 首次 commit 仍返回 Task A；现 render 按请求身份过滤结果，
   同时隔离 taskId、workspace identity、路径、连接和 service 实例。列表已有 meta 时不再进行无用 state 清理。
   首帧、同 taskId 跨 identity、同 identity 换连接、乱序回包、列表来源、草稿和失败回归通过。
7. **Shell 订阅范围（待测量）**：`useWorkspaceShellZCodeState` 已用浅比较裁剪字段，
   但 `useWorkspaceActiveTaskState` 仍订阅整个 workspaceState。不能据此直接认定真实卡顿，
   需要以无关任务更新时的 Header/Shell 渲染次数验证收益。

## 界面迭代准则

沿用 `DESIGN.md` 的紧凑工作区、语义颜色和 `text-ui-*` 字号。
优先让用户看清当前任务、等待原因、下一步操作与失败恢复，再调整视觉细节。
评估应覆盖 Zai Light/Dark、长中文/英文标签、窄屏目录、键盘焦点与减少动画设置。
本轮没有进行界面重新设计或声称实测帧率提升。

## 验证记录

- freshness：通过，main 相对 origin/main ahead 2 / behind 0。
- 架构检查：修改前后均为 0 violations；`ui` 当前为 unmanaged，工具没有发现受控契约，
  因而结果不能证明全部 UI 依赖与状态边界合理。
- 首轮 Lint 为 0 errors / 39 warnings；第二轮并行清理期间为 0 errors / 55 warnings。
- 类型检查：修改前已有失败，修改后仍失败；新改导航源码未出现在错误列表中。
- 目录合成基准：1000 回合、50 次末尾变化，首次测得完整计算 99.0 ms，缓存计算 1.8 ms。
  这是预热后的纯计算测试，不能外推为整页加速倍率或首屏收益。
- 本轮使用本机 Node 26.10.0、pnpm 10.33.2；仓库要求 Node 24.14.0，该版本未验证。
- 第二轮队列浏览器场景通过：真实组件与 CSS、模拟命令回传，覆盖键盘移动与取消、无移动不提交、
  焦点、锁定/编辑中的行、无排序权限、中英文说明、390px 尺寸、暗色与 reduced-motion。
  场景和运行方法位于 `packages/ui/test/browser/README.md`，证据位于 `.tmp/queue-e2e`。
- 滚动导航 3 项定向测试通过；缓存/目录关联套件重跑时被并行清理中的 shared validation 未定义符号阻断。
  不改清理文件来绕过错误，也不将本轮关联套件写成全部通过。
- 没有执行真实 Host/Agent/远控全链路；未测整页帧率。
- feature graph 未覆盖本次导航缓存边界；没有据此扩大图谱或恢复缺失的文档。

## 下一轮验收顺序

接下来测长会话输出期间的输入响应、Header/Shell 渲染次数和 DOM 数量，并在完整应用中验证本轮交互。
清理由另一个 agent 独立推进；本轮通过组件场景隔离无关依赖，不改业务清理范围。

## 第三轮验证补充

- 新增队列结果测试 5 项通过；连同滚动导航共 8 项定向测试通过。
- `run-task-switch.mjs` 与 `run-queue-feedback.mjs` 通过，均为真实 UI 逻辑配合受控服务的浏览器场景。
- 修改文件 Lint：0 errors / 1 处既有 locale unused warning；架构检查仍为 0 violations。
- 全仓检查时 Lint 为 48 warnings / 1 error，错误位于另一 agent 清理中的 `packages/services/src/node.ts`；
  类型检查仍有清理相关失败，本轮修改的 hook、队列结果模块和 SessionPane 未出现在类型错误列表中。
- 本轮生产变更集中在 UI hook 和 SessionPane，加一个小型队列结果处理模块；未改 Host 或运行时。
