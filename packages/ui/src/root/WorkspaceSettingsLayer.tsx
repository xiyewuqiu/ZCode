import { lazy, Suspense, useEffect } from "react";
import { ServiceProvider } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import type { WorkspaceSettingsLayerProps } from "@/root/types.js";
// 设置页是低频入口但体积巨大（2MB+），必须懒加载；
// Root.tsx 已懒加载 SettingsPage，这里同样处理，避免设置页被静态依赖链拖进首屏闭包。
const SettingsPage = lazy(() => import("@/SettingsPage.js").then((m) => ({ default: m.SettingsPage })));

export function WorkspaceSettingsLayer({
  workspaceScopedServices,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  windowsWindowControlsRightPaddingPx,
  captionWorkspacePath,
  onBack,
  onCreateTask,
  onOpenWorkspace,
  allowOpenWorkspace,
  onLogin,
  onLogout,
  user,
}: WorkspaceSettingsLayerProps) {
  useEffect(() => {
    logger.info("[Root] settings layer mounted");
    return () => {
      logger.info("[Root] settings layer unmounted");
    };
  }, []);

  const settingsPage = (
    <Suspense fallback={null}>
      <SettingsPage
        isDesktop={isDesktop}
        isMacDesktop={isMacDesktop}
        isWindowsDesktop={isWindowsDesktop}
        windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
        captionWorkspacePath={captionWorkspacePath}
        onBack={onBack}
        onCreateTask={onCreateTask}
        onOpenWorkspace={onOpenWorkspace}
        allowOpenWorkspace={allowOpenWorkspace}
        onLogin={onLogin}
        onLogout={onLogout}
        user={user}
      />
    </Suspense>
  );

  return (
    <div className="absolute inset-0 z-10">
      {workspaceScopedServices ? (
        <ServiceProvider services={workspaceScopedServices}>{settingsPage}</ServiceProvider>
      ) : (
        settingsPage
      )}
    </div>
  );
}
