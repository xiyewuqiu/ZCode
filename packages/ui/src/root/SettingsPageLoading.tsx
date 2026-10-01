import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import { DesktopWindowFrame } from "@/DesktopWindowFrame.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SettingsPageLoading({
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  onBack,
}: {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  onBack?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "common.loading" });
  return (
    <DesktopWindowFrame
      title={label}
      isDesktop={isDesktop}
      isMacDesktop={isMacDesktop}
      isWindowsDesktop={isWindowsDesktop}
    >
      <div
        data-testid="settings-page-loading"
        className="relative grid h-full grid-cols-[68px_minmax(0,1fr)] lg:grid-cols-[268px_minmax(0,1fr)]"
      >
        <aside className="min-w-0">
          <div className="h-12 [app-region:drag]" />
          {onBack ? (
            <Button
              data-testid="settings-loading-back"
              variant="ghost"
              size="icon-md"
              className="m-2"
              onClick={onBack}
              aria-label={intl.formatMessage({ id: "workspace.backToWorkspace" })}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
          ) : null}
        </aside>
        <div className="m-1 ml-0 min-w-0 rounded-xl border border-border bg-background">
          <div className="flex h-12 items-center justify-end px-2 [app-region:drag]">
            {isDesktop && !isMacDesktop ? <DesktopWindowControls /> : null}
          </div>
          <div
            role="status"
            aria-busy="true"
            className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8"
          >
            <span className="text-ui-base text-foreground-subtle">{label}</span>
            <div aria-hidden="true" className="space-y-4">
              <div className="h-6 w-2/5 rounded bg-surface" />
              <div className="h-24 rounded-lg bg-surface" />
              <div className="h-24 rounded-lg bg-surface" />
            </div>
          </div>
        </div>
      </div>
    </DesktopWindowFrame>
  );
}
