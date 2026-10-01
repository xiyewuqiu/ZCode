import type { ConversationTurnNavigatorItem } from "@/v4/conversationTurnNavigatorHelpers.js";

export function filterConversationOutlineItems(
  items: readonly ConversationTurnNavigatorItem[],
  query: string,
): readonly ConversationTurnNavigatorItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  if (/^#\d+$/.test(normalized)) {
    const ordinal = Number(normalized.slice(1));
    const item = Number.isSafeInteger(ordinal) && ordinal > 0 ? items[ordinal - 1] : undefined;
    return item ? [item] : [];
  }
  const terms = normalized.split(/\s+/);
  return items.filter((item) => {
    const text = `${item.userText}\n${item.assistantPreview}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function resolveConversationOutlineSelection(
  items: readonly ConversationTurnNavigatorItem[],
  selectedKey: string | null,
  currentKey: string | undefined,
): number {
  const selected = selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey);
  if (selected >= 0) return selected;
  const current =
    currentKey === undefined ? -1 : items.findIndex((item) => item.key === currentKey);
  return current >= 0 ? current : items.length ? 0 : -1;
}
