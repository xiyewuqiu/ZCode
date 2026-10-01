const WHITESPACE = /\s/u;

/** 仅生成可见摘要；Iterable 允许在摘要已足够时停止读取后续回复块。 */
export function buildConversationPreview({
  texts,
  fallback,
  maxChars = 220,
  maxParagraphs = 2,
}: {
  texts: Iterable<string>;
  fallback: string;
  maxChars?: number;
  maxParagraphs?: number;
}): string {
  const limit = Math.max(8, maxChars);
  const paragraphLimit = Math.max(1, maxParagraphs);
  let value = "";
  let paragraphs = 1;
  let pendingWhitespace = false;
  let newlines = 0;

  const finish = () => {
    if (value.length <= limit) return value || fallback;
    let prefix = value.slice(0, limit - 3).trimEnd();
    // 原先直接 slice 可能把 emoji 拦腰截断，留下不可显示的高代理项。
    const last = prefix.charCodeAt(prefix.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
    return `${prefix}...`;
  };

  for (const text of texts) {
    for (let index = 0; index < text.length; index++) {
      const character = text[index]!;
      if (WHITESPACE.test(character)) {
        pendingWhitespace = true;
        if (character === "\n") newlines++;
        continue;
      }
      if (value && pendingWhitespace) {
        if (newlines >= 2) {
          if (paragraphs >= paragraphLimit) return finish();
          paragraphs++;
          value += "\n";
        } else {
          value += " ";
        }
      }
      value += character;
      pendingWhitespace = false;
      newlines = 0;
      // 旧实现先 join/split 全文再截断，长工具回复会在每次目录刷新时制造大字符串。
      if (value.length > limit) return finish();
    }
    pendingWhitespace = true;
    newlines += 2;
  }
  return finish();
}
