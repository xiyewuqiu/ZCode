import { useEffect, useState } from "react";
import { DesktopCommandIds } from "@zcode/shared";
import { MinusIcon, XIcon } from "lucide-react";
import { WindowMaximizeIcon, WindowRestoreIcon } from "@/components/icons/windowIcons.js";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

export function DesktopWindowControls() {
  const platform = usePlatform();
  const [overlay, setOverlay] = useState(() => platform.getWindowControlsOverlayMetrics?.());
  useEffect(() => {
    const unsubscribe = platform.onWindowControlsOverlayChanged?.(setOverlay);
    setOverlay(platform.getWindowControlsOverlayMetrics?.());
    return unsubscribe;
  }, [platform]);
  if (overlay?.nativeWindowControls) {
    // 统一四个页面入口的避让区；能力来自 preload 同步初态，首帧不闪出第二套按钮。
    return (
      <div
        data-testid="native-window-controls-spacer"
        aria-hidden="true"
        className="h-12 shrink-0 pointer-events-none"
        style={{ width: overlay.rightPaddingPx ?? 136 }}
      />
    );
  }
  return <CustomDesktopWindowControls />;
}

function CustomDesktopWindowControls() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = platform.onDesktopWindowChromeStateChanged?.((state) => {
      receivedEvent = true;
      if (!disposed) setMaximized(state.isMaximized);
    });
    // 订阅后读取初态；较晚返回的初态不能覆盖用户刚触发的最大化事件。
    void platform
      .getDesktopWindowChromeState?.()
      .then((state) => {
        if (!disposed && !receivedEvent) setMaximized(state.isMaximized);
      })
      .catch((error) => logger.warn("读取自绘窗口按钮状态失败", { error }));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [platform]);
  const items = [
    {
      id: "minimize",
      label: "titleBar.window.minimize",
      command: DesktopCommandIds.MinimizeWindow,
      Icon: MinusIcon,
    },
    {
      id: "maximize",
      label: "titleBar.window.toggleMaximize",
      command: DesktopCommandIds.ToggleMaximizeWindow,
      Icon: maximized ? WindowRestoreIcon : WindowMaximizeIcon,
    },
    {
      id: "close",
      label: "titleBar.menu.file.closeWindow",
      command: DesktopCommandIds.CloseWindow,
      Icon: XIcon,
    },
  ] as const;
  return (
    <div
      data-testid="desktop-window-controls"
      className="flex shrink-0 items-center gap-0.5 [app-region:no-drag]"
    >
      {items.map(({ id, label, command, Icon }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="icon-md"
          data-testid={`window-control-${id}`}
          data-maximized={id === "maximize" ? maximized : undefined}
          className={`text-foreground [app-region:no-drag] ${id === "close" ? "hover:bg-destructive hover:text-destructive-foreground" : "hover:bg-hover hover:text-foreground"}`}
          aria-label={intl.formatMessage({ id: label })}
          onClick={() => {
            void platform
              .executeDesktopCommand(command)
              .catch((error) => logger.warn("执行窗口操作失败", { command, error }));
          }}
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}
