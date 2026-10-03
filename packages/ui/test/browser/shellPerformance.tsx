import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Group, Panel } from "react-resizable-panels";
import type { IPlatformService, WindowControlsOverlayMetrics } from "@zcode/shared";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { DesktopWindowControls } from "../../src/DesktopWindowControls.js";
import { SettingsPageLoading } from "../../src/root/SettingsPageLoading.js";
import { useAnimatedResizablePanel } from "../../src/app-shell/useAnimatedResizablePanel.js";
import { useConversationProjection } from "../../src/v4/useConversationProjection.js";
import type { SessionLease } from "../../src/v4/sessionDataLayer.js";
import type { ConversationStoreState } from "../../src/v4/conversationProjectionStore.js";
import "../../src/styles.css";

const counters = { subscribes: 0, unsubscribes: 0 };
function makeLease(id: string) {
  let state: ConversationStoreState = {
    status: "live",
    snapshot: null,
    subscriptionId: id,
    lastError: null,
    optimisticCommands: [],
    loadingOlder: false,
    sessionPlans: [],
    planDirectoryRevision: 0,
    plansLoading: false,
    turnNavigatorDirectoryRevision: 0,
  };
  const listeners = new Set<() => void>();
  return {
    lease: {
      store: {
        getState: () => state,
        subscribe: (listener: () => void) => {
          counters.subscribes++;
          listeners.add(listener);
          return () => {
            counters.unsubscribes++;
            listeners.delete(listener);
          };
        },
      },
    } as SessionLease,
    emit() {
      state = { ...state, planDirectoryRevision: state.planDirectoryRevision + 1 };
      listeners.forEach((listener) => listener());
    },
  };
}
const stores = [makeLease("first"), makeLease("second")];
let overlay: WindowControlsOverlayMetrics = { nativeWindowControls: true, rightPaddingPx: 136 };
const overlayListeners = new Set<(metrics: WindowControlsOverlayMetrics) => void>();
const platform = {
  getWindowControlsOverlayMetrics: () => overlay,
  onWindowControlsOverlayChanged: (listener: (metrics: WindowControlsOverlayMetrics) => void) => {
    overlayListeners.add(listener);
    return () => {
      overlayListeners.delete(listener);
    };
  },
} as IPlatformService;

function ProjectionFixture({ storeIndex }: { storeIndex: number }) {
  const state = useConversationProjection(stores[storeIndex]!.lease);
  return <output data-testid="revision">{state.planDirectoryRevision}</output>;
}

function Fixture() {
  const [storeIndex, setStoreIndex] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panel = useAnimatedResizablePanel({
    open,
    expandedSize: "30%",
    rememberExpandedSize: true,
  });
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground text-ui-base">
      {loading ? (
        <SettingsPageLoading isDesktop isWindowsDesktop onBack={() => setLoading(false)} />
      ) : (
        <>
          <div className="flex h-12 shrink-0 items-center justify-between px-2">
            <button data-testid="loading" onClick={() => setLoading(true)}>
              Settings
            </button>
            <DesktopWindowControls />
          </div>
          <button data-testid="store" onClick={() => setStoreIndex(1)}>
            Switch store
          </button>
          <button data-testid="emit" onClick={() => stores[storeIndex]!.emit()}>
            Emit
          </button>
          <button data-testid="unmount" onClick={() => setMounted(false)}>
            Unmount session
          </button>
          <button
            data-testid="zoom"
            onClick={() => {
              overlay = { nativeWindowControls: true, rightPaddingPx: 84 };
              overlayListeners.forEach((listener) => listener(overlay));
            }}
          >
            Zoom
          </button>
          <button data-testid="panel" onClick={() => setOpen(!open)}>
            Panel
          </button>
          {mounted ? <ProjectionFixture storeIndex={storeIndex} /> : null}
          <div className="min-h-0 flex-1">
            <Group orientation="horizontal">
              <Panel id="main" defaultSize="100%">
                Workspace
              </Panel>
              <Panel
                id="animated-panel"
                panelRef={panel.panelRef}
                elementRef={panel.panelElementRef}
                defaultSize="0%"
                minSize="10%"
                collapsedSize="0%"
                collapsible
              >
                <div className="h-full bg-surface">Side pane</div>
              </Panel>
            </Group>
          </div>
        </>
      )}
    </main>
  );
}

Object.assign(window, { shellCounters: counters });
const root = createRoot(document.getElementById("root")!);
root.render(
  <PlatformProvider platform={platform}>
    <ZCodeIntlProvider initialLocale="en-US">
      <Fixture />
    </ZCodeIntlProvider>
  </PlatformProvider>,
);
import.meta.hot?.dispose(() => root.unmount());
