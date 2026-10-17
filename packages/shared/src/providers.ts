import { z } from "zod";

/**
 * YCode agent 提供方的单一真源。
 *
 * 类型 YCodeProvider、运行时 schema ycodeProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / ycode-protocol 等无环引用。
 */
const YCODE_PROVIDERS = ["glm"] as const;

export const ycodeProviderSchema = z.enum(YCODE_PROVIDERS);

export type YCodeProvider = (typeof YCODE_PROVIDERS)[number];
