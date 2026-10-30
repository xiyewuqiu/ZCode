# 模型元数据目录补全

## 背景

Provider 的只读模型目录（OpenAI 兼容 `GET /models`、Anthropic `GET /v1/models`）通常只返回
模型 ID，缺少显示名、上下文窗口和最大输出。用户添加模型后仍需手工填写这些字段，容易漏填
或填错。

本规范在现有 Host 侧模型发现链路上增加一层只读的元数据补全：用公开的
[models.dev](https://models.dev) 目录填补端点未提供的字段。补全只影响本次发现结果，不写
Provider 配置。

## 数据源验证

2026-10-29 实测：

- `GET https://models.dev/api.json` 返回 HTTP 200、`Content-Type: application/json`、
  `Content-Length: 5940980`（约 5.7 MiB）、带 `ETag`。沙箱网络未能在超时内完整下载 5.9 MiB，
  但已用响应头和多个 Provider 的正文前缀确认结构。
- 顶层是对象：键为 Provider ID，值为 Provider 记录。
- Provider 记录包含 `id`、`name`、`api`、`env`、`models` 等字段；`models` 是以模型 ID 为键
  的对象。
- 模型记录包含 `id`、`name`、`limit.context`、`limit.output`、可选的 `canonical_model_id`
  与 `type`。
- 目录也提供 `https://models.dev/models.json`（无 Provider 维度的规范化模型表）和
  `https://models.dev/catalog.json`。本实现选择 `api.json`，因为需要 Provider 维度来执行
  “冲突时优先官方 Provider”的匹配规则。

如果未来端点或字段变化，解析失败按失败语义处理：保留端点结果，不回退到猜测数据。

## 产品规则

1. 实时发现结果权威：模型 ID 与端点提供的任何字段都优先。目录只补 `name`、
   `contextWindow`、`maxOutputTokens` 三个缺失字段。
2. 非空实时值不覆盖；本次补全不读取也不修改用户已保存的个人配置。是否写入配置只由用户在
   发现弹窗确认后的现有配置事务决定。
3. 目录只在 Host 进程读取和缓存；Renderer 不发起目录网络请求。
4. 缓存：
   - 位置：`getAppConfigDir()/model-catalog/models.dev.json`（现有用户数据路径 helper，
     不硬编码 home 路径）。
   - 保存精简后的 Provider/模型元数据，不保存 5.9 MiB 原始响应。
   - TTL 7 天。新鲜时直接使用，不发起 HTTP。
   - 过期或缺失时刷新；刷新失败保留上次成功缓存（last-known-good），不受 TTL 限制。
   - 写入使用 `atomicWriteText`（临时文件 + rename + 进程间文件锁）。
   - 单次网络响应上限 8 MiB；超过、非 JSON 或结构不符视为刷新失败。
5. 匹配顺序（确定性）：
   1. 模型 ID 完全相等（区分大小写）；
   2. 模型 ID 忽略大小写相等；
   3. 路径末段忽略大小写相等，且只允许至少一方带 `vendor/` 前缀的 ID，避免两个裸 ID 仅因
      末段相同而误配；
   4. 同一优先级出现多个候选时，Provider ID 等于模型 ID 或 `canonical_model_id` 的
      `vendor` 段者优先（视为官方 Provider）；再按目录顺序、模型 ID、Provider ID 字典序
      稳定排序。
6. `name` 的“缺失”包括空串和发现器用模型 ID 充当的占位名（`name === id`）。此时允许目录
   名称补全；端点提供了不同于 ID 的真实名称时保留端点值。
7. 失败非致命：目录 HTTP、解析、缓存或匹配任一环节失败，返回实时发现结果原文，并记录
   `warn` 日志；不得返回伪造的成功补全。
8. 实时结果不等待目录冷启动：目录补全最多等待 1.5 秒；超时先返回端点结果，目录刷新在
   后台继续，下一次发现命中缓存后再补全。缓存新鲜时没有额外等待。
9. 不新增 RPC channel，不新增配置写入路径，不自动刷新或自动添加模型。目录刷新由下次
   `discoverModels` 调用按 TTL 触发。

## 状态所有者

- `createProviderModelCatalogLoader`（Host services）唯一拥有目录快照、磁盘缓存与刷新时序。
- `createProviderModelDiscoverer`（Host services）拥有“并发取实时列表 + 目录 → fill-only
  合并”的编排；失败时原样返回实时结果。
- `ModelDiscoveryDialog`（Renderer）只展示合并后的 `DiscoveredProviderModel` 字段；关闭弹窗
  即丢弃。
- Provider 配置事务不变：`ProviderSettingsFacade` / `ProviderConfigService` 仍是唯一写入入口。

## 事件顺序

```text
discoverModels(input)
  ├─ catalog.load(): 磁盘缓存 → (过期/缺失) GET models.dev/api.json
  └─ live: GET {baseURL}/models                      (两者并发)
        live 失败 → 返回 live 错误；目录刷新可继续完成并写缓存
        live 成功 → await catalog
            目录不可用 → 返回 live 原文（warn）
            目录可用   → fill-only 合并 → 返回 live ID + 补全字段
```

缓存刷新是串行化的进程内 in-flight promise；并发发现共享同一次刷新。刷新成功后才替换内存
快照并写盘，失败继续使用旧快照。

## 接口

不新增 RPC。`IProviderSettingsService.discoverModels` 的输入输出保持不变：

```ts
interface DiscoveredProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

discoverModels(input): Promise<
  | { ok: true; models: DiscoveredProviderModel[] }
  | { ok: false; error: { code: ...; message: string } }
>;
```

内部新增：

```ts
createProviderModelCatalogLoader(options?): {
  load(): Promise<ProviderModelCatalog | undefined>;
};

enrichModelsWithCatalog(
  models: readonly DiscoveredProviderModel[],
  providers: readonly ProviderCatalogEntry[],
): readonly DiscoveredProviderModel[];
```

## 验收

1. 端点只返回 `{ id: "deepseek-v4-flash" }`，目录命中时补全名称、上下文和最大输出，模型 ID
   与顺序不变。
2. 端点返回 `contextWindow: 64000`，目录为 `128000` 时保留 `64000`；最大输出同理。
3. 端点未给 `name`（发现器以 ID 占位）时使用目录名称；端点给出真实名称时不覆盖。
4. `vendor/model` 与裸 `model` 可通过末段互相匹配；两个裸 ID 不因末段相同而匹配；精确
   匹配优先于末段匹配。
5. 多个 Provider 冲突时官方 Provider 胜出，重复运行结果一致。
6. 缓存新鲜时不发起 HTTP；过期后刷新成功会原子更新缓存；刷新失败继续使用旧缓存。
7. 无缓存且刷新失败、响应超限、非 JSON、结构不符、缓存损坏时，返回实时发现结果并记录
   `warn`，不阻塞添加。
8. 发现弹窗在字段存在时展示上下文/最大输出，字段仍缺失时展示轻量提示；补全不改变
   “确认后写入”的边界，补全本身不写任何配置。
