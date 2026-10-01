import { useRef, useState } from "react";
import type { SessionStoragePreview } from "@zcode/shared";
import { Database, HardDrive, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.js";
import {
  useTaskStorage,
  type TaskStorageTarget,
  type TaskStorageService,
} from "@/hooks/useTaskStorage.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 ** 2 ? 1 : value < 1024 ** 3 ? 2 : 3;
  return `${(value / 1024 ** unit).toFixed(1)} ${["", "KiB", "MiB", "GiB"][unit]}`;
}

export function TaskStorageDialog({
  target,
  title,
  service,
  onClose,
}: {
  target: TaskStorageTarget;
  title: string;
  service: TaskStorageService;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `taskStorage.${id}` }, values);
  const state = useTaskStorage(target, service);
  const [confirmedPreview, setConfirmedPreview] = useState<SessionStoragePreview | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { preview, result, error, busy } = state;
  const complete = result?.state === "purged";
  const retry =
    result?.state === "cleanup-pending" ||
    preview?.state === "cleanup-pending" ||
    preview?.state === "purged";
  const canDelete =
    preview &&
    !preview.blockers.length &&
    preview.state !== "missing" &&
    confirmedPreview === preview &&
    !busy &&
    !complete;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && busy !== "purge") onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        showCloseButton={busy !== "purge"}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="break-all">{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-ui-base">
          <p className="break-all text-foreground-subtle">{target.workspacePath}</p>
          {busy === "preview" ? (
            <p role="status" className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              {t("loading")}
            </p>
          ) : null}
          {preview && !complete ? (
            <>
              <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                <div className="rounded-lg border border-card-border bg-surface p-3">
                  <Database className="mb-2 size-4 text-foreground-subtle" />
                  <p>{t("records")}</p>
                  <p className="mt-1 text-ui-lg font-medium tabular-nums">
                    {bytes(preview.logicalBytes)}
                  </p>
                  <p className="text-foreground-subtle">
                    {t("recordCount", { count: preview.recordCount })}
                  </p>
                </div>
                <div className="rounded-lg border border-card-border bg-surface p-3">
                  <HardDrive className="mb-2 size-4 text-foreground-subtle" />
                  <p>{t("files")}</p>
                  <p className="mt-1 text-ui-lg font-medium tabular-nums">
                    {bytes(preview.ownedFileBytes)}
                  </p>
                  <p className="text-foreground-subtle">
                    {t("fileCount", { count: preview.ownedFileCount })}
                  </p>
                </div>
              </div>
              <p className="text-foreground-subtle">{t("scope")}</p>
              <p className="text-foreground-subtle">{t("sqlite")}</p>
              {preview.blockers.length ? (
                <ul role="alert" className="list-disc space-y-1 pl-5 text-warning">
                  {preview.blockers.map((blocker) => (
                    <li key={blocker}>{t(`blocker.${blocker}`)}</li>
                  ))}
                </ul>
              ) : (
                <label className="flex items-start gap-2 rounded-lg border border-card-border p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-destructive"
                    disabled={Boolean(busy)}
                    checked={confirmedPreview === preview}
                    onChange={(event) => setConfirmedPreview(event.target.checked ? preview : null)}
                  />
                  <span>{t("confirm")}</span>
                </label>
              )}
            </>
          ) : null}
          {result ? (
            <div role="status" className={complete ? "text-success" : "text-warning"}>
              <p>{t(complete ? "complete" : "pending", { count: result.pendingFileCount })}</p>
              <p>
                {t("removed", {
                  records: result.deletedRecords,
                  bytes: bytes(result.removedFileBytes),
                })}
              </p>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="space-y-1 text-destructive">
              <p>{t("error")}</p>
              <p className="break-all text-ui-caption">{error}</p>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button ref={cancelRef} variant="outline" disabled={busy === "purge"} onClick={onClose}>
            {t("close")}
          </Button>
          {!complete ? (
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => {
                setConfirmedPreview(null);
                void state.refresh();
              }}
            >
              {t("refresh")}
            </Button>
          ) : null}
          {!complete ? (
            <Button variant="destructive" disabled={!canDelete} onClick={() => void state.purge()}>
              {busy === "purge" ? t("deleting") : retry ? t("retry") : t("delete")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
