# Provider 模型目录拉取

## 背景

当前新增模型必须手敲模型 ID，且上下文窗口、最大输出等元数据也要手工填写。Provider
通常暴露只读模型目录（OpenAI 兼容 `GET /models`、Anthropic `GET /v1/models`），
设置页应能拉取候选并一次性添加，但仍由用户确认，不静默改配置。

## 产品规则

1. 拉取只在 Host 进程执行。Renderer 不能直接携带 API Key 请求外部端点。
2. 草稿连接值优先：Base URL、API 格式、API Key、Header 若已在表单中修改，使用草稿值；
   未提供时回退到已保存的 Provider 有效配置。
3. 端点与鉴权：
   - `openai-chat-completions` / `openai-responses`：`{baseURL}/models`，
     `Authorization: Bearer <key>`。
   - `anthropic-messages`：根路径（去掉末尾 `/v1`）拼接 `/v1/models?limit=1000`，
     `x-api-key` + `anthropic-version: 2023-06-01`。
   - 用户自定义 Header 优先；已有同名鉴权 Header 时不覆盖。
4. 响应解析：
   - 优先 `data[]`，其次 `models{}` 映射；映射键是请求 ID。
   - 兼容 `name` / `display_name` / `displayName`；
   - 兼容 `contextWindow` / `context_window` / `context_length` /
     `max_input_tokens` / `limit.context`；
   - 兼容 `maxOutputTokens` / `max_output_tokens` / `maxTokens` / `max_tokens` /
     `limit.output` / `top_provider.max_completion_tokens`。
   - 无可用 ID 的条目跳过；重复 ID 只保留第一次出现；保留端点顺序。
5. 失败语义：
   - 401/403 → `auth`；
   - 网络/超时 → `network`；
   - 非 JSON、错误结构、超过 4 MiB → `protocol`；
   - 没有可用模型 → `empty`；
   - 缺少 Base URL → `unsupported`。
     错误只在弹窗内展示，手工添加始终可用，不发生配置写入。
6. 用户确认后，一次配置事务批量添加所选模型；已存在的模型不重复添加，不产生部分写入。
7. 发现到的上下文窗口与最大输出作为个人稀疏覆盖写入；其他能力仍由推荐规则解析。
8. 拉取结果不持久化，不自动刷新，不自动添加。发现结果可经
   `specs/model-provider/model-metadata-catalog.md` 定义的只读目录做缺失字段补全；该缓存
   仅属于目录数据源，不改变“确认后写入”的边界，也不能覆盖端点值或用户配置。

## 状态所有者

- `IProviderSettingsService.discoverModels` 是唯一入口；Host 实现负责 HTTP 与解析。
- `ProviderSettingsFacade` / `ProviderConfigService` 负责“确认后”的配置事务。
- UI 只持有候选列表与勾选状态；关闭弹窗即丢弃。

## 接口

```ts
discoverModels(input: {
  providerId: string;
  baseURL?: string;
  apiFormat?: "anthropic-messages" | "openai-chat-completions" | "openai-responses";
  apiKey?: string;
  headers?: Record<string, string>;
}): Promise<
  | { ok: true; models: DiscoveredProviderModel[] }
  | { ok: false; error: { code: "auth" | "network" | "protocol" | "unsupported" | "empty"; message: string } }
>;
```

## 验收

1. OpenAI 兼容 Provider 返回 `data[]` 时可拉取、去重、按 ID 添加。
2. Anthropic Base URL 带或不带 `/v1` 都只请求一次 `/v1/models?limit=1000`。
3. `models{}` 映射形态可解析，键作为模型 ID。
4. 401/403 显示鉴权错误；非 JSON、超限、空目录分别显示对应错误。
5. 草稿 Key 优先于已保存 Key；自定义 Header 不被鉴权 Header 覆盖。
6. 已存在模型在弹窗中不重复勾选、不重复添加。
7. 确认添加是一个配置 revision；失败不产生半套模型。
8. 添加后上下文窗口与最大输出来自发现结果（允许经目录补全），其他能力仍走推荐配置。
