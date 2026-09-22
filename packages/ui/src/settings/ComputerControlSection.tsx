// 设置页「电脑控制 (Computer Control)」分区：
//  - 总开关与权限模式落在 AppSettings.computerControl（经 useSettings().update 持久化）。
//  - 开启后展示权限模式三选一（standard / bounded / unrestricted）与 cua-driver 驱动状态；
//    关闭时只留一行禁用态说明，避免展示一堆无效配置项。
//  - 驱动状态来自 services 层的可选探测方法（见 ComputerControlDriverStatusProvider）；
//    方法缺失时按「当前环境未提供驱动状态接口」展示，不影响开关与权限模式的读写。
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ListChecks, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { AppSettings } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { StatusDot, type StatusDotTone } from "@/settings/StatusDot.js";

/** 权限模式联合类型直接取自 AppSettings，避免 UI 与 shared 各写一份字面量导致漂移。 */
type ComputerControlPermissionMode = NonNullable<AppSettings["computerControl"]>["permissionMode"];

type ComputerControlSettings = NonNullable<AppSettings["computerControl"]>;

/** settings 尚未加载完成时的兜底值，与 appSettingsSchema 的默认值保持一致。 */
const DEFAULT_COMPUTER_CONTROL_SETTINGS: ComputerControlSettings = {
  enabled: false,
  permissionMode: "standard",
};

const PERMISSION_MODE_OPTIONS: ReadonlyArray<{
  value: ComputerControlPermissionMode;
  Icon: typeof ShieldCheck;
}> = [
  { value: "standard", Icon: ShieldCheck },
  { value: "bounded", Icon: ListChecks },
  { value: "unrestricted", Icon: ShieldAlert },
];

/**
 * cua-driver 驱动状态契约：由后续 services 任务实现的 getComputerControlDriverStatus 返回。
 * 本组件只按可选能力调用，不假设该接口已经存在。
 */
interface ComputerControlDriverStatus {
  /** ready = 驱动可用；missing = 未安装；其余取值按未知处理。 */
  state: "ready" | "missing" | "unknown";
  /** state = ready 时的驱动版本号。 */
  version?: string;
}

interface ComputerControlDriverStatusProvider {
  getComputerControlDriverStatus?: () => Promise<ComputerControlDriverStatus>;
}

type DriverViewKind = "checking" | "ready" | "missing" | "unknown" | "unavailable";

/** version 仅 kind = ready 时可能出现。 */
type DriverView = { kind: DriverViewKind; version?: string };

/** 各驱动状态的展示口径：圆点色、徽章文案与说明文案同源，避免颜色和文案不一致。 */
const DRIVER_KEY_PREFIX = "settings.computerControl.driver";
const DRIVER_VIEW_PRESENTATION: Record<
  DriverViewKind,
  { tone: StatusDotTone; spinning: boolean; badgeId: string; descriptionId: string }
> = {
  checking: {
    tone: "muted",
    spinning: true,
    badgeId: `${DRIVER_KEY_PREFIX}.checking`,
    descriptionId: `${DRIVER_KEY_PREFIX}.checkingDescription`,
  },
  ready: {
    tone: "green",
    spinning: false,
    badgeId: `${DRIVER_KEY_PREFIX}.ready`,
    descriptionId: `${DRIVER_KEY_PREFIX}.readyDescription`,
  },
  missing: {
    tone: "amber",
    spinning: false,
    badgeId: `${DRIVER_KEY_PREFIX}.missing`,
    descriptionId: `${DRIVER_KEY_PREFIX}.missingDescription`,
  },
  unknown: {
    tone: "muted",
    spinning: false,
    badgeId: `${DRIVER_KEY_PREFIX}.unknown`,
    descriptionId: `${DRIVER_KEY_PREFIX}.unknownDescription`,
  },
  unavailable: {
    tone: "muted",
    spinning: false,
    badgeId: `${DRIVER_KEY_PREFIX}.unknown`,
    descriptionId: `${DRIVER_KEY_PREFIX}.unavailableDescription`,
  },
};

type SaveErrorScope = "toggle" | "permission";

/** 探测方法缺失时要区分「没实现」和「查询失败」，前者不提供重检按钮（重检也调不到）。 */
function resolveDriverStatusProbe(
  services: IServiceAccessor,
): (() => Promise<ComputerControlDriverStatus>) | undefined {
  const candidate = services as IServiceAccessor & ComputerControlDriverStatusProvider;
  const probe = candidate.getComputerControlDriverStatus;
  if (typeof probe !== "function") {
    return undefined;
  }
  // 绑定接收者：方法将来若挂在类实例上，解构出来直接调用会丢 this。
  return () => probe.call(candidate);
}

/** 跨 RPC 返回的状态按不可信数据处理：非法形状一律落「未知」，不让坏值穿透到渲染。 */
function resolveDriverView(status: unknown): DriverView {
  if (typeof status !== "object" || status === null) {
    return { kind: "unknown" };
  }
  const raw = status as Record<string, unknown>;
  const state = typeof raw.state === "string" ? raw.state : "";
  if (state === "ready") {
    const version = typeof raw.version === "string" ? raw.version.trim() : "";
    return version ? { kind: "ready", version } : { kind: "ready" };
  }
  return state === "missing" ? { kind: "missing" } : { kind: "unknown" };
}

export function ComputerControlSection({ isDesktop = false }: { isDesktop?: boolean }) {
  const { intl } = useZCodeIntl();
  const services = useServices();
  const { settings, update } = useSettings();

  const persistedSettings = settings?.computerControl ?? DEFAULT_COMPUTER_CONTROL_SETTINGS;
  // 乐观覆盖：点击后立刻反映用户意图，落盘成功（或失败回滚）后由下面的同步 effect 归还事实源。
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const [modeOverride, setModeOverride] = useState<ComputerControlPermissionMode | null>(null);
  const enabled = enabledOverride ?? persistedSettings.enabled;
  const permissionMode = modeOverride ?? persistedSettings.permissionMode;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ scope: SaveErrorScope; message: string } | null>(
    null,
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 两个覆盖共用一次比对：只要共享 snapshot 已经追上用户选择，就归还事实源（含失败后被回滚的情况）。
  useEffect(() => {
    if (enabledOverride !== null && persistedSettings.enabled === enabledOverride) {
      setEnabledOverride(null);
    }
    if (modeOverride !== null && persistedSettings.permissionMode === modeOverride) {
      setModeOverride(null);
    }
  }, [enabledOverride, modeOverride, persistedSettings.enabled, persistedSettings.permissionMode]);

  // 驱动状态只按「能力是否可用 + 用户显式重检」触发：services 对象身份不参与 effect 依赖，
  // 否则一次探测引发的重渲染会再次进入 effect，形成探测循环。
  const driverProbe = isDesktop ? resolveDriverStatusProbe(services) : undefined;
  const probeRef = useRef<typeof driverProbe>(driverProbe);
  probeRef.current = driverProbe;
  const driverProbeAvailable = driverProbe !== undefined;
  const [driverCheckNonce, setDriverCheckNonce] = useState(0);
  const [driverView, setDriverView] = useState<DriverView>({ kind: "checking" });
  const driverCheckTokenRef = useRef<symbol | null>(null);

  const runDriverProbe = useCallback(async () => {
    const probe = probeRef.current;
    if (!probe) {
      setDriverView({ kind: "unavailable" });
      return;
    }
    // 每次探测换一个 token：迟到的旧结果直接丢弃，不会覆盖用户刚触发的新结果。
    const token = Symbol("computer-control-driver-status");
    driverCheckTokenRef.current = token;
    setDriverView({ kind: "checking" });
    try {
      const status = await probe();
      if (driverCheckTokenRef.current !== token || !mountedRef.current) return;
      setDriverView(resolveDriverView(status));
    } catch {
      // 驱动探测失败（含驱动未安装时的报错）本身不是错误状态，回落「未知」并允许重检。
      if (driverCheckTokenRef.current !== token || !mountedRef.current) return;
      setDriverView({ kind: "unknown" });
    }
  }, []);

  useEffect(() => {
    void runDriverProbe();
  }, [driverProbeAvailable, driverCheckNonce, runDriverProbe]);

  const persist = useCallback(
    async (
      next: ComputerControlSettings,
      successMessageId: string,
      failureScope: SaveErrorScope,
    ): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      try {
        await update({ computerControl: next });
        if (!mountedRef.current) return true;
        toast(intl.formatMessage({ id: successMessageId }));
        return true;
      } catch (error) {
        if (!mountedRef.current) return false;
        // 写入失败必须清掉乐观覆盖，否则界面会一直停在一个没落盘的状态。
        setEnabledOverride(null);
        setModeOverride(null);
        setSaveError({
          scope: failureScope,
          message: intl.formatMessage(
            { id: "settings.computerControl.saveFailed" },
            { error: error instanceof Error ? error.message : String(error) },
          ),
        });
        return false;
      } finally {
        if (mountedRef.current) {
          setSaving(false);
        }
      }
    },
    [intl, update],
  );

  const handleToggle = useCallback(
    async (nextEnabled: boolean) => {
      setEnabledOverride(nextEnabled);
      const saved = await persist(
        { enabled: nextEnabled, permissionMode },
        nextEnabled
          ? "settings.computerControl.enabledToast"
          : "settings.computerControl.disabledToast",
        "toggle",
      );
      // 刚开启时驱动状态往往还没被查过，顺手探测一次，避免用户看到过期的「未检测」。
      if (saved && nextEnabled) setDriverCheckNonce((nonce) => nonce + 1);
    },
    [persist, permissionMode],
  );

  const handlePermissionModeChange = useCallback(
    (nextMode: ComputerControlPermissionMode) => {
      if (nextMode === permissionMode) return;
      setModeOverride(nextMode);
      void persist(
        { enabled, permissionMode: nextMode },
        "settings.computerControl.permission.saved",
        "permission",
      );
    },
    [enabled, persist, permissionMode],
  );

  const handleRecheckDriver = useCallback(() => {
    setDriverCheckNonce((nonce) => nonce + 1);
    toast(intl.formatMessage({ id: "settings.computerControl.driver.recheckDone" }));
  }, [intl]);

  const renderSaveError = (scope: SaveErrorScope) =>
    saveError?.scope === scope ? (
      <div className="text-ui-base text-destructive">{saveError.message}</div>
    ) : undefined;

  const sectionDescription = (
    <p className="text-ui-base leading-6 text-foreground-subtle">
      {intl.formatMessage({ id: "settings.computerControlDescription" })}
    </p>
  );

  if (!isDesktop) {
    // 直接 return null 会让用户误以为页面坏了；明确写出能力边界，且不渲染任何会写设置的控件。
    return (
      <div className="space-y-5" data-testid="computer-control-settings-section">
        {sectionDescription}
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.computerControl.desktopOnly.title" })}
          </p>
          <p className="mt-1 text-ui-sm leading-5 text-foreground-subtle">
            {intl.formatMessage({ id: "settings.computerControl.desktopOnly.description" })}
          </p>
        </div>
      </div>
    );
  }

  const driver = DRIVER_VIEW_PRESENTATION[driverView.kind];
  const driverChecking = driverView.kind === "checking";
  const driverDescriptionId =
    driverView.kind === "ready" && !driverView.version
      ? "settings.computerControl.driver.readyDescriptionNoVersion"
      : driver.descriptionId;
  const toggleLabel = intl.formatMessage({ id: "settings.computerControl.toggleLabel" });
  const permissionTitle = intl.formatMessage({ id: "settings.computerControl.permission.title" });
  const permissionModeKeyPrefix = "settings.computerControl.permission";

  return (
    <div className="space-y-5" data-testid="computer-control-settings-section">
      {sectionDescription}

      {/* settings 未加载完成时禁用写入：patch 是整对象替换，用兜底默认值落盘会把用户已存的权限模式抹成 standard。 */}
      <SettingsGroupCard>
        <SettingsRow
          label={toggleLabel}
          description={intl.formatMessage({ id: "settings.computerControl.toggleDescription" })}
          control={
            <Switch
              aria-label={toggleLabel}
              checked={enabled}
              disabled={saving || settings === null}
              onCheckedChange={handleToggle}
            />
          }
          detail={renderSaveError("toggle")}
        />
      </SettingsGroupCard>

      {enabled ? (
        <>
          <section className="space-y-3">
            <div className="space-y-1">
              <div className="text-ui-base font-medium text-foreground-subtle">
                {permissionTitle}
              </div>
              <p className="text-ui-sm leading-5 text-foreground-subtle">
                {intl.formatMessage({
                  id: `${permissionModeKeyPrefix}.description`,
                })}
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label={permissionTitle}
              className="space-y-2"
              data-testid="computer-control-permission-modes"
            >
              {PERMISSION_MODE_OPTIONS.map(({ value, Icon }) => {
                const selected = permissionMode === value;
                const title = intl.formatMessage({
                  id: `${permissionModeKeyPrefix}.${value}.title`,
                });
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={title}
                    data-permission-mode={value}
                    disabled={saving || settings === null}
                    onClick={() => handlePermissionModeChange(value)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused disabled:cursor-not-allowed disabled:opacity-60",
                      selected
                        ? "border-foreground/60 bg-card-selected dark:border-foreground/50"
                        : "border-card-border bg-card hover:border-border-hover hover:bg-surface-hover dark:border-border/60 dark:bg-transparent dark:hover:bg-surface/60",
                    )}
                  >
                    <Icon
                      className="mt-0.5 size-5 shrink-0 text-foreground-subtle"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui-base font-medium text-foreground">
                        {title}
                      </span>
                      <span className="mt-1 block text-ui-sm leading-5 text-foreground-subtle">
                        {intl.formatMessage({
                          id: `${permissionModeKeyPrefix}.${value}.description`,
                        })}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {selected ? <Check className="size-3" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* 完全放开是真实风险状态，选中时给一条 warning 提示，而不是把整张卡片染红。 */}
            {permissionMode === "unrestricted" ? (
              <div role="note" className="flex items-start gap-1.5 text-warning">
                <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-ui-sm leading-5">
                  {intl.formatMessage({
                    id: `${permissionModeKeyPrefix}.unrestrictedWarning`,
                  })}
                </p>
              </div>
            ) : null}
            {renderSaveError("permission")}
          </section>

          <section className="space-y-3">
            <div className="text-ui-base font-medium text-foreground-subtle">
              {intl.formatMessage({ id: "settings.computerControl.driver.title" })}
            </div>
            <SettingsGroupCard>
              <SettingsRow
                controlLayout="wide"
                label={<span className="font-mono">cua-driver</span>}
                description={intl.formatMessage(
                  { id: driverDescriptionId },
                  driverView.version ? { version: driverView.version } : undefined,
                )}
                control={
                  <SettingsBadge>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot tone={driver.tone} spinning={driver.spinning} />
                      {intl.formatMessage({ id: driver.badgeId })}
                    </span>
                  </SettingsBadge>
                }
                detail={
                  // 「接口未接入」时重检也调不到东西，此时不给按钮，避免一个点了没反应的入口。
                  driverView.kind === "unavailable" ? undefined : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={driverChecking}
                      onClick={handleRecheckDriver}
                    >
                      {driverChecking ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden="true" />
                      )}
                      {intl.formatMessage({ id: "settings.computerControl.driver.recheck" })}
                    </Button>
                  )
                }
              />
            </SettingsGroupCard>
          </section>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface px-4 py-3 text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.computerControl.disabledNotice" })}
        </div>
      )}
    </div>
  );
}
