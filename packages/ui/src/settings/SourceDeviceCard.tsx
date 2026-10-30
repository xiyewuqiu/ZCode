import { useCallback, useRef, useState } from "react";
import type { SourceServerManagementSnapshot, SourceServerMigrationReport } from "@ycode/shared";
import { AlertCircle, ChevronRight, Loader2, RefreshCw, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

export type ManagementServer = SourceServerManagementSnapshot["servers"][number];
export type ManagementState = SourceServerManagementSnapshot["states"][number];

export function connectionBadgeVariant(
  state: ManagementState["state"] | "online" | "connecting" | "offline" | undefined,
): "secondary" | "destructive" | "outline" {
  if (state === "online") {
    return "secondary";
  }
  if (state === "failed" || state === "offline" || state === "needs-install") {
    return "destructive";
  }
  return "outline";
}

function resolveTargetLabel(server: ManagementServer): string {
  return server.osUser || server.hostname || server.displayName;
}

function resolveServerState(
  server: ManagementServer,
  snapshot: SourceServerManagementSnapshot,
): ManagementState | undefined {
  const profiles = snapshot.profiles.filter(
    (profile) => profile.sourceServerId === server.sourceServerId,
  );
  const preferred =
    profiles.find((profile) => profile.profileId === server.preferredProfileId) ?? profiles[0];
  return snapshot.states.find((state) => state.profileId === preferred?.profileId);
}

function resolveMigrationCount(
  server: ManagementServer,
  snapshot: SourceServerManagementSnapshot,
): SourceServerManagementSnapshot["migrationCounts"][number] | undefined {
  return snapshot.migrationCounts.find((count) => count.sourceServerId === server.sourceServerId);
}

function formatTimestamp(value: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  } catch {
    return String(value);
  }
}

function MigrationReportRows({
  report,
  locale,
}: {
  report: SourceServerMigrationReport;
  locale: string;
}) {
  const { intl } = useYCodeIntl();
  if (report.rows.length === 0) {
    return (
      <div className="px-3 py-2 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.devices.migration.empty" })}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border border-t border-border">
      {report.rows.map((row) => (
        <li key={row.migrationId} className="space-y-0.5 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={row.status === "failed" ? "destructive" : "outline"}>
              {intl.formatMessage({ id: `settings.devices.migration.status.${row.status}` })}
            </Badge>
            <span
              className="min-w-0 flex-1 truncate text-ui-base text-foreground"
              title={row.workspacePath}
            >
              {row.workspacePath}
            </span>
            <span className="shrink-0 text-ui-xs text-foreground-subtle">
              {formatTimestamp(row.updatedAt, locale)}
            </span>
          </div>
          {row.errorCode ? (
            <div className="text-ui-xs text-destructive">{row.errorCode}</div>
          ) : null}
          {row.conflicts.length > 0 ? (
            <div className="text-ui-xs text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.devices.migration.conflicts" },
                { count: row.conflicts.length },
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SourceDeviceCard({
  server,
  snapshot,
  onReload,
}: {
  server: ManagementServer;
  snapshot: SourceServerManagementSnapshot;
  onReload: () => void;
}) {
  const { intl, locale } = useYCodeIntl();
  const services = useBaseWorkspaceServices();
  const management = services.sourceServerManagementService;
  const state = resolveServerState(server, snapshot);
  const migrationCount = resolveMigrationCount(server, snapshot);
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<SourceServerMigrationReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const loadReport = useCallback(async () => {
    if (!management) {
      return;
    }
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setReportLoading(true);
    setReportError(null);
    try {
      const next = await management.getMigrationReport(server.sourceServerId);
      if (requestVersionRef.current === requestVersion) {
        setReport(next);
      }
    } catch (error) {
      if (requestVersionRef.current === requestVersion) {
        setReportError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setReportLoading(false);
      }
    }
  }, [management, server.sourceServerId]);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      if (next && !report) {
        void loadReport();
      }
      return next;
    });
  }, [loadReport, report]);

  const retryConnection = useCallback(async () => {
    if (!management || !state) {
      onReload();
      return;
    }
    const profiles = snapshot.profiles.filter(
      (profile) => profile.sourceServerId === server.sourceServerId,
    );
    const preferred =
      profiles.find((profile) => profile.profileId === server.preferredProfileId) ?? profiles[0];
    if (!preferred) {
      onReload();
      return;
    }
    setRetrying(true);
    setRetryError(null);
    try {
      await management.connectProfile(preferred.profileId, { retainedOnly: true });
      onReload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("[settings] 重试 Source Server 连接失败", { error: message });
      setRetryError(message);
    } finally {
      setRetrying(false);
    }
  }, [management, onReload, server, snapshot.profiles, state]);

  const connectionState = state?.state ?? "offline";
  const canRetry = Boolean(management && state?.retryable);
  const migrationLabel = migrationCount
    ? migrationCount.status === "available"
      ? intl.formatMessage(
          { id: "settings.devices.migration.counts" },
          {
            failed: migrationCount.failedPathCount,
            abandoned: migrationCount.abandonedPathCount,
          },
        )
      : intl.formatMessage({
          id: `settings.devices.migration.countStatus.${migrationCount.status}`,
        })
    : intl.formatMessage({ id: "settings.devices.migration.none" });

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
        <Server className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-base font-medium text-foreground">
            {server.displayName}
          </div>
          <div className="truncate text-ui-xs text-foreground-subtle">
            {resolveTargetLabel(server)}
          </div>
        </div>
        <Badge variant={connectionBadgeVariant(connectionState)}>
          {intl.formatMessage({ id: `settings.devices.state.${connectionState}` })}
        </Badge>
        {canRetry ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={retrying}
            onClick={() => void retryConnection()}
          >
            {retrying ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage({ id: "settings.devices.reconnect" })}
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          <ChevronRight
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
            aria-hidden="true"
          />
          {intl.formatMessage({ id: "settings.devices.migration.title" })}
        </Button>
      </div>

      {state?.error || retryError ? (
        <div
          className="flex items-start gap-1.5 px-3 pb-2 text-ui-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{state?.error ?? retryError}</span>
        </div>
      ) : null}

      <div className="px-3 pb-2 text-ui-xs text-foreground-subtle">{migrationLabel}</div>

      {expanded ? (
        <div>
          {reportLoading ? (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-ui-base text-foreground-subtle">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "common.loading" })}
            </div>
          ) : reportError ? (
            <div className="flex items-start gap-2 border-t border-border px-3 py-2 text-ui-base">
              <AlertCircle
                className="mt-0.5 size-3.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 break-words">{reportError}</span>
              <Button type="button" size="xs" variant="ghost" onClick={() => void loadReport()}>
                <RefreshCw className="size-3" aria-hidden="true" />
                {intl.formatMessage({ id: "projects.retry" })}
              </Button>
            </div>
          ) : report ? (
            <MigrationReportRows report={report} locale={locale} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
