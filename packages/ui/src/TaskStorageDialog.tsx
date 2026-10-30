import { useRef, useState } from "react";
import type { SessionStoragePreview } from "@ycode/shared";
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
import { useYCodeIntl } from "@/i18n/IntlProvider.js";

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
  const { intl } = useYCodeIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `taskStorage.${id}` }, values);
  const state = useTaskStorage(target, service);
  const [confirmedPreview, setConfirmedPreview] = useState<SessionStoragePreview | null>(null);
  const [confirmedOptimize, setConfirmedOptimize] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const {
    preview,
    result,
    error,
    busy,
    databaseStats,
    optimization,
    databaseError,
    databaseBusy,
    refreshDatabase,
    optimizeDatabase,
  } = state;
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
  // 整理是全局共享库操作：预览/删除进行中、统计未就绪或用户未确认都不可执行。
  const canOptimize =
    Boolean(databaseStats) && confirmedOptimize && databaseBusy === null && busy !== "purge";
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
                    data-testid="task-storage-delete-confirm"
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
          <div className="space-y-3 rounded-lg border border-card-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-foreground-subtle" aria-hidden="true" />
              <p className="font-medium">{t("database.title")}</p>
            </div>
            <p className="text-foreground-subtle">{t("database.description")}</p>
            {databaseStats ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
                  <div>
                    <p className="text-foreground-subtle">{t("database.size")}</p>
                    <p className="font-medium tabular-nums">{bytes(databaseStats.databaseBytes)}</p>
                    <p className="text-ui-caption text-foreground-subtle">
                      {t("database.wal", { bytes: bytes(databaseStats.walBytes) })}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground-subtle">{t("database.pages")}</p>
                    <p className="font-medium tabular-nums">
                      {t("database.pagesValue", {
                        count: databaseStats.pageCount,
                        size: bytes(databaseStats.pageSize),
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground-subtle">{t("database.freelist")}</p>
                    <p className="font-medium tabular-nums">{bytes(databaseStats.freelistBytes)}</p>
                    <p className="text-ui-caption text-foreground-subtle">
                      {t("database.freelistValue", { count: databaseStats.freelistCount })}
                    </p>
                  </div>
                </div>
                <p className="text-ui-caption text-foreground-subtle">
                  {t("database.mode", {
                    autoVacuum: databaseStats.autoVacuum,
                    journal: databaseStats.journalMode,
                  })}
                </p>
              </div>
            ) : databaseBusy === "load" ? (
              <p role="status" className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                {t("database.loading")}
              </p>
            ) : null}
            {optimization ? (
              <div
                role="status"
                className={
                  optimization.status === "optimized" && !optimization.reason
                    ? "space-y-1 text-success"
                    : "space-y-1 text-warning"
                }
              >
                <p>
                  {optimization.status === "optimized"
                    ? t(`database.action.${optimization.action}`, {
                        reclaimed: bytes(optimization.reclaimedBytes),
                      })
                    : t(`database.refused.${optimization.reason ?? "database-busy"}`)}
                </p>
                {optimization.reason === "freelist-low" ? (
                  <p>{t("database.action.freelist-low")}</p>
                ) : null}
                <p>
                  {t("database.beforeAfter", {
                    before: bytes(optimization.before.databaseBytes),
                    after: bytes(optimization.after.databaseBytes),
                  })}
                </p>
              </div>
            ) : null}
            {databaseError ? (
              <div role="alert" className="space-y-1 text-destructive">
                <p>{t("database.failed")}</p>
                <p className="break-all text-ui-caption">{databaseError}</p>
              </div>
            ) : null}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid="task-storage-optimize-confirm"
                className="mt-0.5 size-4 shrink-0 accent-brand"
                disabled={Boolean(databaseBusy) || busy === "purge"}
                checked={confirmedOptimize}
                onChange={(event) => setConfirmedOptimize(event.target.checked)}
              />
              <span>{t("database.confirm")}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(databaseBusy) || busy === "purge"}
                onClick={() => {
                  setConfirmedOptimize(false);
                  void refreshDatabase();
                }}
              >
                {t("database.refresh")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canOptimize}
                onClick={() => {
                  setConfirmedOptimize(false);
                  void optimizeDatabase();
                }}
              >
                {databaseBusy === "optimize" ? t("database.optimizing") : t("database.optimize")}
              </Button>
            </div>
          </div>
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
