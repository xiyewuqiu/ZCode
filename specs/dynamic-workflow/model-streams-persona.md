# Dynamic Workflow 模型绑定、Streams 与 Persona

状态：第三切片，对应上游 ZCode v3.15.1（aac47556）/ 0a1fc56d 的模型绑定、流水线原语与 persona 模型部分。
范围：`model()` / `ModelRef` / `script_models` 的编译期规则、lowering、launch 解析、运行期绑定表、子代理模型选择、确认窗设置调整的契约与 core 侧应用逻辑、`channel` / `future` 的 cell 语义、阶段流投影、冷回放载荷，以及 persona 规范化与缓存身份。
不包含：确认窗与时间线的 JSX/交互实现（归 UI agent）、holes/deltas/concurrency（已在 `workflow-holes-run-deltas.md`、`concurrency-retune.md` 中实现）、ToolSearch、MCP Apps、compaction。

## 1. 模型绑定

### 1.1 脚本面

```ts
const fast = model("GLM-5.3-Flash$high");       // ModelRef，运行期就是名字串
const a = agent("reviewer", { model: fast });   // persona 点名模型
const b = agent("writer", { model: "glm-b" });  // 字符串字面量也可以
```

- `ModelRef` 只存在于类型系统：facade 中它是私有构造器、私有成员的 `declare class`，脚本无法 `new`，也无法用对象字面量伪造。
- `model(id)` 的实参必须是**非空字符串字面量**（无洞）。运行期 `model("x")` 被 lowering 抹成 `"x"`，沙箱里没有 `model`，也不产生 `__host` 调用或 journal 行。
- persona 的 `model` 属性的**类型**必须是 `ModelRef`、字符串字面量类型或它们的联合。检查类型而非语法，因此 `const` 绑定、三目、`as const` 联合都合法；被拓宽成 `string` 的值（`let`、参数、带洞模板、先存变量的 persona 对象）不合法。
- 内联 persona 对象字面量取 `model` 初值表达式本身的类型（避免 `AgentPersona` 上下文把属性拓宽成 `string`）。

诊断：

| 码 | 来源 | 含义 |
| --- | --- | --- |
| 9010 `MODEL_REFERENCE_CODE` | `analysis/actor-models.ts` | 模型名集合不封闭：`model()` 实参非字面量、persona `model` 类型被拓宽、在值位置引用 `ModelRef` |
| 9011 `MODEL_UNRESOLVED_CODE` | `core` 的 Create/Amend/Fill | 编译器给的封闭名字在宿主模型目录里解析不出来（不存在、歧义、被停用、档位不合法、跨 provider 裸名） |

分析结果 `AnalyzeResult.modelReferences` 每处出现一条（`{name, line, column}`，`name` 逐字保留），`ok === false` 时为空数组；authoring 诊断在场时照常给出。

### 1.2 名字 → 绑定表

事件顺序（两个工具的 `resolveInput` 与确认窗）：

```text
script 归一化（inline / saved / path，都有 script）
  -> withScriptModelBindingsResolved：analyzeScript(script) 取 modelReferences
  -> resolveScriptModelBindings：每个名字按宿主 ModelCatalogPort 解析
  -> 写入入参 model_bindings = { 脚本逐字名 -> providerId/modelId[$level] }
  -> prepareApproval：有名字没绑定则不开窗（与编不过同一姿态）
  -> handler：没绑定的名字报 9011；否则把绑定表拆回结构化选择交给 run 端口
```

- 绑定表**无条件覆盖**模型伪造的值；脚本编不过或没点名模型时整个键缺席。
- 名字解析规则（`core/tool/handlers/model-reference.ts`）：全称 `providerId/modelId` 精确命中 → 裸名在当前会话 provider 下命中 → 裸名只在别的 provider 下则 `other_provider` 失败并列出全称。裸名绝不跨 provider。
- `AmendWorkflow`：同名名字**沿用前驱 `run-launched.modelBindings`** 里的规范串（用户在前驱确认窗里换过的模型留得住）；新名字重新解析。解析发生在 `amend-workflow-resolve.ts`，绑定落定之后再计算 `predecessor.introduces_providers`（会话与前驱都没用过的 provider，去重按字母序）。该键在场即退出「本会话 run 免确认」，必须照常开窗。
- `FillWorkflowHole`：补全不开确认窗，所以只能使用本 run 已有的绑定表；表里没有的名字报 9011（`unboundFillModelDiagnostics`），并提示用 AmendWorkflow 增加模型。

### 1.3 运行期与读面

`run-launched` 事件新增 `modelBindings?: Record<string, string>`，与 `subagentModel` 同一条宿主元数据路：提交方给出、建 run 那一世记一次、引擎从不读、零 SQL。

数据副本链：

```text
SubmitRequest.modelBindings (结构化 ModelSelection)
  -> run-submit formatModelBindings：唯一归一点，选择 -> 规范串
  -> RunLaunch.modelBindings -> harness -> EngineConfig.launch -> run-launched 事件
  -> RunRegistryEntry.modelBindings（journal 行之前的间隙副本）
  -> 快照 / 详情 / 冷回放从条目读；冷行读 run-launched
```

子代理模型优先级（`bootstrap/app/workflow-actor-model.ts`）：

1. persona `model`：按本 run 绑定表逐字查成整条选择（含 reasoning 档位）。表里没有该名字抛 `WorkflowActorModelUnboundError`，该次 ask 以 DriverError 失败，绝不静默退回缺省模型。
2. 本 run `subagent_model`。
3. resume pin（journal 的 `resolvedModel`）。
4. 父会话当前模型。

进度载荷在 `actor-created` 上派生 `payload.model`（规范串），live 与冷回放使用同一张绑定表，两侧载荷逐字节相等。

### 1.4 确认窗设置调整（契约 + core）

契约 `contracts/src/tools/workflow-settings.ts` 提供：

- `WorkflowAdjustableSettingsSchema`：`resolveInput` 回填入参的 `adjustable_settings`，告诉窗口本宿主能调什么（`subagent_model` 是否可调、默认并发 `concurrency_ceiling`）。
- `WorkflowSettingsAdjustmentSchema`：Allow 应答 `content` 里的三态调整。

core 侧：

- `ToolEntry.applyInputAdjustments` 与 `ToolExecutionContext.inputAdjustments`。
- `WorkflowSettingsAdjustment` 在权限通过之后、handler 之前应用（`tool/executor/permission-input-adjustments.ts`）；模型在窗里选的模型重新对着**同一份**模型目录解析，解不出来整次调用失败，什么都不启动。
- `CreateWorkflow` / `AmendWorkflow` 共用 `workflow-settings-adjustment.ts`：回填块、应用改动、结果文案（「批准之前，用户在确认窗里调整了设置」）。Amend 只在会开窗的形状（有 `script`）上回填。
- broker 从 v4 应答 `content` 读调整（`bootstrap/src/ycode-protocol/workflow-settings-answer.ts`），只有 Allow 且工具是 Create/Amend 时才携带 `inputAdjustments`。

UI-only：确认窗的 JSX、模型选择器、步进器与文案排版。

## 2. Streams（channel / future）

### 2.1 语义

```ts
const facts = channel<Fact>("facts");   // 无界、FIFO、每项恰好一个接收者
const research = future(async () => {   // 立即启动，返回其 promise
  try { for (const f of found) facts.send(f); }
  finally { facts.close(); }
});
const verify = future(async () => {
  const out = [];
  for await (const f of facts) out.push(await review(f));
  return out;
});
await research;
return await verify;
```

- `send` 同步入队，close 后抛 `ChannelClosed`；`close` 幂等，接收者取完剩余项后循环退出。
- `future(body)` 立即调用 `body` 并返回其 promise；同步抛出转成拒绝，让阶段失败走 join 路径。
- 两者都是**沙箱内的纯 promise 机制**：无站点、无 journal 行、不过线。lowering 只把调用改写成 `__host.channel(...)` / `__host.future(...)`，类型实参丢弃。
- 实现位于 `dynamic-workflow-runtime/src/child-cell-streams.ts`（cell 的第二段引导脚本），只依赖 BOOTSTRAP 建下的 `__pending` / `__settled` / `__complete` / `__host`。
- 停滞检测：每条 host response 投递后与脚本起步后，`setImmediate` 上询问 cell「无在飞请求且未完成」。有接收者停在 channel 上报 `ChannelDeadlock`（点名通道与等待数），否则报 `ScriptStalled`；两者都以 error-complete 结束 run，而不是永远挂起。
- 确定性：channel 的每次投递都是 host 结算顺序的后果，因此不落 journal、不需要回放；resume 重放的是 host 响应，channel 随之重建出相同顺序。

### 2.2 编译期分析

- `send` 与 `push` / `Map.set` 同规：把参数的 taint 并入容器 place；`for await` 从 place 读出，于是每个生产者到每个消费者各有一条 `data` 边。
- `future(body)` 是唯一带回调的 facade 函数：`once` + `entered` + 不延迟；ordering walk 在调用点内联其函数体，异步体成为 strand。
- `channel` / `future` 不产生站点，`analyzeWorkflowScript` 的 `lowered.siteIds` 中没有它们。
- 片段 facade（`SNIPPET_FACADE_DTS`）保留 `channel` / `future`：流水线逻辑正是片段要排练的内容。

### 2.3 阶段流投影（只出数据）

`CreateWorkflowCausalityGraph.phaseStreams?: {from,to}[]`：因果图阶段商里两端互为 `alongside` 的 `data` 边。它**不是** runs after，不进 `phaseEdges`、不带 `back`；上界与 `phaseEdges` 相同（`CREATE_WORKFLOW_GRAPH_MAX_PHASE_EDGES`），与阶段词汇表同进同退。

UI-only：时间线如何把 `phaseStreams` 画成流轨、从并行带里取出流水线阶段。

## 3. Persona

### 3.1 规范化

`engine/persona.ts`：

- `normalizePersona(name, persona)`：字符串视为 `system`；对象只收 `name` / `system` / `model` 三个字符串字段，其余键丢弃；`name` 缺席时落到 persona.name。
- `personaIdentity(persona)`：缓存身份只含名字与 system prompt，**不含 `model`**。换模型不是改身份：Amend 带 `subagent_model` 时已完成的活照常导入，下一次 live ask 跑在新模型上。

引擎在 `createActor` 时同步冻结 `PersonaSpec`（含 `model`），写入 `actor-created` 事件与 `dwf_actor` 行；`imported-cache` 的 `matchImportedActor` 用 `personaIdentity` 比对，因此改一个裁判的模型不会让它整段重跑。

### 3.2 宿主侧

- `agent(..., { model })` 在 `resolveActorPersonaModel` 查表（第 1.3 节优先级）。
- `run-launched.modelBindings` 是唯一查表来源；宿主只做逐字查找，不再重新解析目录。

## 4. 验证与遗留

已实现并自测：

- 模型名收集（`model()`、内联字面量、三目联合）、9010 拒绝拓宽类型、lowering 抹除 `model()`。
- persona 规范化保留 `model`、缓存身份剔除 `model`。
- cell 内 `channel` / `future` 的投递、close、future 兑现、两次独立运行顺序一致、死锁点名。
- `channel` / `future` lowering 到 `__host.*` 且无站点 id。
- `pnpm typecheck`（dynamic-workflow、dynamic-workflow-runtime、contracts、core、bootstrap、adapters）与 `oxlint`、`architecture:check --changed` 通过。

有意未移植（上游同批但不在本切片）：

- 引擎 resume / cached-ask-facts / replay-order / engine-config / errors / hash-mismatch / engine-phase-stamp / engine-artifacts-primary 等与模型、streams、persona 无关的引擎重构。
- `node-dispatched` 的富出生事实（`actor` / `actorName` / `actorPhaseName` / `actorPersonaModel`）：本地读面仍从 `actor-created` 取 persona 与模型；该重复出生事实属于 delta/有界表切片。
- 确认窗、时间线流轨与模型选择器的 UI 实现。
- 上游未涉及的 holes/deltas/concurrency 以及 ToolSearch、MCP Apps、compaction。
