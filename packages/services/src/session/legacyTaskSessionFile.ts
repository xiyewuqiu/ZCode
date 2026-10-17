import type { YCodeSessionFile, YCodeTaskMeta } from "@ycode/shared";
import { ycodeSessionFileSchema, ycodeTaskMetaSchema, ycodeTaskModeSchema } from "@ycode/shared";

export type LegacyTaskSessionFile = Omit<YCodeSessionFile, "meta"> & {
  meta: Omit<YCodeTaskMeta, "mode"> & { mode?: YCodeTaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = ycodeSessionFileSchema.extend({
  // Claude 原生迁移会按清洗路径删除 meta.mode。
  // legacy snapshot 读取/写入仍要校验其它必需字段，但不能再强制把被过滤字段补回文件。
  meta: ycodeTaskMetaSchema.extend({
    mode: ycodeTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
