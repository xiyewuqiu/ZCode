# 每个模型独立的 API 响应格式

## 背景

Provider 目前只有一个 `api.type`，取值 `anthropic-messages`、
`openai-chat-completions`、`openai-responses`。同一个供应商的模型并不总是走同一种
协议：例如同一网关下，部分模型只支持 Chat Completions，另一些模型支持 Responses；
把格式锁在 Provider 上会迫使用户为同一供应商建多个 Provider，重复维护 Base URL、
API Key 和 Header。

## 产品规则

1. **Provider 的 `api.type` 是默认值，不是唯一来源。** 模型可以声明自己的
   `apiFormat`；未声明时继承 Provider。
2. 解析顺序：个人模型精确规则 > 内置推荐规则 / 模板规则 > Provider 默认值。
   空值（缺省或 `null`）一律表示“继承 Provider”。
3. 生效格式只影响三件事：
   - 选择哪个 AI SDK Provider（Anthropic / OpenAI Responses / OpenAI Compatible）；
   - 请求管线里的 `providerOptions.apiFormat`；
   - 消息与工具结果的协议转换分支。
   Base URL、Header、API Key、模型 ID、上下文窗口、能力开关不受影响。
4. 同一个 Provider 下可以同时存在不同格式的模型，且同一会话可以切换使用，不要求
   重建 Provider 或重启 Agent。
5. UI 在模型编辑弹窗提供“继承 Provider / Anthropic Messages / OpenAI Chat
   Completions / OpenAI Responses”。选择“继承”时删除个人配置中的 `apiFormat`，
   不写入 Provider 的默认值；选择具体格式时只写该字段。
6. “跟随推荐配置”和“固定个人配置”两种模式都保留该字段：
   - 跟随模式：未显式选择时保持稀疏，继续继承 Provider；
   - 固定模式：把当前生效格式固化到个人配置，之后 Provider 默认值变化不再影响该模型。
7. 持久化字段可选，缺省即继承。旧配置、旧远程 Host、新远程 Host 互相兼容，不提升
   `provider_config.json` 的 schemaVersion。
8. 校验：只接受三个枚举值；未知值在写入前被 schema 拒绝，并指出模型路径。

## 状态所有者

- `ProviderConfigResolver` 是“有效格式”的唯一解析者：`apiFormat ?? provider.api.type`。
- `ModelConfig` / `ModelConfigRules` 只保存稀疏个人规则，不复制 Provider 默认值。
- `AiSdkModelExecution` 在创建 Model 时冻结有效格式；后续 Provider 热更新不会改变
  已创建 Model 的协议。
- UI 草稿只保存用户意图（继承或显式格式），提交时才物化。

## 接口

- 共享 Schema：`modelApiFormatDataSchema`，由 Provider 与模型配置共同复用。
- 模型配置：`modelConfig.apiFormat?: "anthropic-messages" |
  "openai-chat-completions" | "openai-responses" | null`。
- 执行入口：`bindModel({ ..., apiFormat })`；缺省时回退 `providerConfig.api.type`。

## 验收

1. 模型未配置 `apiFormat` 时，执行行为与改动前完全一致。
2. Provider 默认 `openai-chat-completions`，模型 A 显式 `anthropic-messages`：
   A 使用 Anthropic SDK/路径，模型 B 继续使用 Chat Completions。
3. Provider 默认从 A 改成 B 时，未显式覆盖的模型跟随变化，显式覆盖的模型不变。
4. 选择“继承 Provider”保存后，个人配置里没有 `apiFormat` 字段。
5. 固定个人配置模式下，当前生效格式被写入个人配置，之后不再随 Provider 变化。
6. 旧 `provider_config.json` 不含模型 `apiFormat` 时正常读取并继承。
7. 非法格式在保存前被拒绝，不会写入配置文件。
8. 模型连通性测试与真实请求使用同一个有效格式。
