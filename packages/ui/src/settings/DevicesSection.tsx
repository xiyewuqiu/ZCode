import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceServerManagementSnapshot } from "@ycode/shared";
import type { RemoteProjectDirectory } from "@ycode/services";
import { AlertCircle, Cloud, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useOptionalRemoteWorkspaceController } from "@/remote/useRemoteWorkspaceController.js";
import { SourceServerManagementPanel } from "@/settings/SourceServerManagementPanel.js";
import { SourceDeviceCard, connectionBadgeVariant } from "@/settings/SourceDeviceCard.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";

function RemoteDirectoryFallbackCard({ host }: { host: RemoteProjectDirectory["hosts"][number] }) {
  const { intl } = useYCodeIntl();
  const connectionStatus = host.connectionStatus ?? "offline";
  const target = host.target;
  const targetLabel = target
    ? target.kind === "ssh"
      ? `${target.username}@${target.sshConfigAlias || target.host}`
      : target.kind === "wsl"
        ? `WSL ${target.distro ?? ""}`.trim()
        : target.kind === "docker"
          ? `Docker ${target.container}`
          : target.name || target.url
    : host.kind;
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <Cloud className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-base font-medium text-foreground">{targetLabel}</div>
        {host.lastConnectionError ? (
          <div className="truncate text-ui-xs text-foreground-subtle">
            {host.lastConnectionError}
          </div>
        ) : null}
      </div>
      <Badge variant={connectionBadgeVariant(connectionStatus)}>
        {intl.formatMessage({ id: `projects.connectionStatus.${connectionStatus}` })}
      </Badge>
    </li>
  );
}

export function DevicesSection() {
  const { intl } = useYCodeIntl();
  const services = useBaseWorkspaceServices();
  const management = services.sourceServerManagementService;
  const controller = useOptionalRemoteWorkspaceController();
  const { settings } = useSettings();
  const workspaceTabs = useTabStore((state) => state.tabs.filter(isWorkspaceTab));
  const [snapshot, setSnapshot] = useState<SourceServerManagementSnapshot | null>(null);
  const [remoteDirectory, setRemoteDirectory] = useState<RemoteProjectDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const reload = useCallback(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (management) {
          const next = await management.getSnapshot({ refreshMigrationCounts: true });
          if (requestVersionRef.current === requestVersion) {
            setSnapshot(next);
            setRemoteDirectory(null);
          }
          return;
        }
        if (services.remoteProjectService) {
          const next = await services.remoteProjectService.readDirectory();
          if (requestVersionRef.current === requestVersion) {
            setRemoteDirectory(next);
            setSnapshot(null);
          }
          return;
        }
        if (requestVersionRef.current === requestVersion) {
          setRemoteDirectory(null);
          setSnapshot(null);
        }
      } catch (loadError) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        logger.warn("[settings] 读取来源与设备状态失败", { error: message });
        setError(message);
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setLoading(false);
        }
      }
    })();
  }, [management, services.remoteProjectService]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!management) {
      return;
    }
    const stateSubscription = management.onDidChangeState(() => reload());
    const directorySubscription = management.onDidChangeDirectory(() => reload());
    return () => {
      stateSubscription.dispose();
      directorySubscription.dispose();
    };
  }, [management, reload]);

  const servers = snapshot?.servers ?? [];
  const hosts = remoteDirectory?.hosts ?? [];
  const hasDevices = servers.length > 0 || hosts.length > 0;

  // Desktop Host 提供完整 Source 管理面时，直接复用统一面板：连接、升级、迁移报告
  // 与更新日志都由同一个 owner 驱动，避免设置页再维护一套并行的刷新/操作逻辑。
  if (management) {
    return (
      <SourceServerManagementPanel
        management={management}
        workspaceTabs={workspaceTabs}
        settings={settings}
        onUpdateSettings={(patch) => services.settingService.update(patch)}
        onConnectProfile={async (profileId) => {
          await controller?.dispatch({
            type: "connect-device",
            profileId,
            effect: "select-project",
          });
        }}
        onDisconnectSource={async (sourceServerId) => {
          await controller?.dispatch({ type: "disconnect-device", sourceServerId });
        }}
        onOpenProject={async (sourceServerId, path, profileId) => {
          await controller?.dispatch({
            type: "open-project",
            sourceServerId,
            path,
            ...(profileId ? { profileId } : {}),
          });
        }}
        onShowUpdateDetails={() => {
          // 更新详情由 Root 的全局更新通知 owner 展示；设置页保持当前分区。
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.devices.description" })}
        </p>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={reload}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
          {intl.formatMessage({ id: "settings.devices.refresh" })}
        </Button>
      </div>

      {error ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui-base"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button type="button" size="xs" variant="ghost" onClick={reload}>
            {intl.formatMessage({ id: "settings.devices.retry" })}
          </Button>
        </div>
      ) : null}

      {loading && !hasDevices ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-4 text-ui-base text-foreground-subtle">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.devices.loading" })}
        </div>
      ) : !hasDevices ? (
        <div className="rounded-xl border border-border bg-card px-3 py-4 text-ui-base text-foreground-subtle">
          {management
            ? intl.formatMessage({ id: "settings.devices.empty" })
            : intl.formatMessage({ id: "settings.devices.unavailable" })}
        </div>
      ) : (
        <ul className="space-y-2">
          {servers.map((server) =>
            snapshot ? (
              <SourceDeviceCard
                key={server.sourceServerId}
                server={server}
                snapshot={snapshot}
                onReload={reload}
              />
            ) : null,
          )}
          {hosts.map((host) => (
            <RemoteDirectoryFallbackCard key={host.id} host={host} />
          ))}
        </ul>
      )}
    </div>
  );
}
