import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { DiscoveredProviderModel } from "@ycode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";

/** 发现结果选择器：只展示候选，确认后才写入 Provider 配置。 */
export function ModelDiscoveryDialog({
  open,
  loading,
  error,
  models,
  existingModelIds,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  models: readonly DiscoveredProviderModel[];
  existingModelIds: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
  onConfirm: (modelIds: readonly string[]) => Promise<void>;
}) {
  const { intl } = useYCodeIntl();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const addable = useMemo(
    () => models.filter((model) => !existingModelIds.has(model.id)),
    [existingModelIds, models],
  );
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return addable;
    return addable.filter(
      (model) =>
        model.id.toLowerCase().includes(normalized) ||
        (model.name?.toLowerCase().includes(normalized) ?? false),
    );
  }, [addable, query]);

  useEffect(() => {
    if (!open) return;
    // 每次打开都按当前候选重置；已存在的模型不默认勾选。
    setSelected(new Set(addable.map((model) => model.id)));
    setQuery("");
  }, [open, addable]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allVisibleSelected = visible.length > 0 && visible.every((model) => selected.has(model.id));
  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) for (const model of visible) next.delete(model.id);
      else for (const model of visible) next.add(model.id);
      return next;
    });
  };
  const invertVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const model of visible) {
        if (next.has(model.id)) next.delete(model.id);
        else next.add(model.id);
      }
      return next;
    });
  };
  const confirm = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    try {
      await onConfirm([...selected]);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100vh-4rem))] max-w-xl grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-clip">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.discovery.title" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.modelProvider.discovery.description" })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={intl.formatMessage({ id: "settings.modelProvider.discovery.search" })}
            aria-label={intl.formatMessage({ id: "settings.modelProvider.discovery.search" })}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="secondary" size="default" onClick={toggleAllVisible}>
              {intl.formatMessage({
                id: allVisibleSelected
                  ? "settings.modelProvider.discovery.deselectAll"
                  : "settings.modelProvider.discovery.selectAll",
              })}
            </Button>
            <Button type="button" variant="secondary" size="default" onClick={invertVisible}>
              {intl.formatMessage({ id: "settings.modelProvider.discovery.invert" })}
            </Button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto rounded-lg border border-input-border">
          {loading ? (
            <div className="flex h-24 items-center justify-center gap-2 text-ui-base text-foreground-subtle">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.discovery.loading" })}
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-ui-base text-destructive">{error}</div>
          ) : visible.length === 0 ? (
            <div className="px-3 py-4 text-ui-base text-foreground-subtle">
              {intl.formatMessage({
                id:
                  addable.length === 0
                    ? "settings.modelProvider.discovery.allAdded"
                    : "settings.modelProvider.discovery.noMatch",
              })}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((model) => (
                <li key={model.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={selected.has(model.id)}
                      onChange={() => toggle(model.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-ui-base text-foreground">
                        {model.id}
                      </span>
                      {model.name && model.name !== model.id ? (
                        <span className="block truncate text-ui-sm text-foreground-subtle">
                          {model.name}
                        </span>
                      ) : null}
                      <span className="flex flex-wrap items-center gap-x-3 text-ui-sm text-foreground-subtle">
                        {model.contextWindow === undefined ? null : (
                          <span>
                            {intl.formatMessage(
                              { id: "settings.modelProvider.discovery.contextWindow" },
                              { value: formatModelContextWindowLabel(model.contextWindow) },
                            )}
                          </span>
                        )}
                        {model.maxOutputTokens === undefined ? null : (
                          <span>
                            {intl.formatMessage(
                              { id: "settings.modelProvider.discovery.maxOutputTokens" },
                              { value: formatModelContextWindowLabel(model.maxOutputTokens) },
                            )}
                          </span>
                        )}
                        {model.contextWindow === undefined ||
                        model.maxOutputTokens === undefined ? (
                          <span className="italic">
                            {intl.formatMessage({
                              id: "settings.modelProvider.discovery.metadataUnavailable",
                            })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "settings.modelProvider.discovery.selected" },
              { count: selected.size },
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              disabled={saving || selected.size === 0}
              onClick={() => void confirm()}
            >
              {saving ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {intl.formatMessage({ id: "settings.modelProvider.discovery.addSelected" })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
