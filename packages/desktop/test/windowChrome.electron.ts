import assert from "node:assert/strict";
import { app, BrowserWindow, screen } from "electron";
import { once } from "node:events";
import {
  buildWindowsWindowOptions,
  syncWindowControlsOverlayForZoomLevel,
} from "../src/main/desktopWindowButtonPosition.js";
import { resolveDesktopZoomFactorForLevel } from "../src/main/desktopZoom.js";
import { createWindowsDesktopTray } from "../src/main/desktopTray.js";

async function main() {
  assert.equal(process.platform, "win32", "This native smoke test requires Windows");
  const profile = process.env.ZCODE_WINDOW_SMOKE_PROFILE;
  assert.ok(profile, "Use run-window-chrome.mjs to create an isolated profile");
  app.setPath("userData", profile);
  let window: BrowserWindow | undefined;
  try {
    await app.whenReady();
    window = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      ...buildWindowsWindowOptions(0, "light"),
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(
      "data:text/html,<title>Isolated window chrome smoke</title><body>Window chrome test</body>",
    );
    for (const level of [-3, 0, 5]) {
      const factor = resolveDesktopZoomFactorForLevel(level);
      const expectedHeight = Math.round(48 * factor) / factor;
      await window.webContents
        .executeJavaScript(`window.overlayReady = new Promise((resolve, reject) => {
        const overlay = navigator.windowControlsOverlay;
        const timeout = setTimeout(() => reject(new Error('Overlay geometry did not settle')), 5000);
        const changed = () => {
          if (Math.abs(overlay.getTitlebarAreaRect().height - ${expectedHeight}) > 1) return;
          clearTimeout(timeout);
          overlay.removeEventListener('geometrychange', changed);
          resolve(true);
        };
        overlay.addEventListener('geometrychange', changed);
      }); true`);
      window.webContents.setZoomFactor(factor);
      syncWindowControlsOverlayForZoomLevel(window, level);
      await window.webContents.executeJavaScript("window.overlayReady");
      assert.equal(window.webContents.getZoomFactor(), factor);
      const overlay = await window.webContents.executeJavaScript(`({
        available: Boolean(navigator.windowControlsOverlay),
        visible: navigator.windowControlsOverlay?.visible,
        rect: navigator.windowControlsOverlay?.getTitlebarAreaRect().toJSON()
      })`);
      assert.equal(overlay.available, true);
      assert.equal(overlay.visible, true);
      assert.ok(overlay.rect.width > 0);
      assert.ok(Math.abs(overlay.rect.height - expectedHeight) <= 1);
      console.log(JSON.stringify({ level, overlay }));
    }
    const maximized = once(window, "maximize", { signal: AbortSignal.timeout(5000) });
    window.maximize();
    await maximized;
    assert.equal(window.isMaximized(), true);
    const restored = once(window, "unmaximize", { signal: AbortSignal.timeout(5000) });
    window.unmaximize();
    await restored;
    assert.equal(window.isMaximized(), false);
    window.showInactive();
    const hidden = once(window, "hide", { signal: AbortSignal.timeout(5000) });
    window.hide();
    await hidden;
    assert.equal(window.isVisible(), false);
    const tray = createWindowsDesktopTray({
      iconPath: process.env.ZCODE_WINDOW_SMOKE_ICON,
      getLocale: () => "en-US",
      showCurrentWindow: () => window?.showInactive(),
      executeDesktopCommand: async () => {},
      quitApp: () => {},
      logger: { warn: (...args) => console.warn(...args) },
    });
    assert.ok(tray, "Native tray should be created");
    const shown = once(window, "show", { signal: AbortSignal.timeout(5000) });
    tray.emit("click");
    await shown;
    assert.equal(window.isVisible(), true);
    tray.destroy();
    window.webContents.setZoomFactor(1);
    syncWindowControlsOverlayForZoomLevel(window, 0);
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      window.setPosition(display.workArea.x + 10, display.workArea.y + 10);
      const dpr = await window.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(devicePixelRatio))))",
      );
      assert.ok(
        Math.abs(dpr - display.scaleFactor) < 0.1,
        `DPI mismatch: ${dpr} / ${display.scaleFactor}`,
      );
    }
    console.log(
      JSON.stringify({
        displayScaleFactors: displays.map((display) => display.scaleFactor),
        trayRestore: true,
      }),
    );
    const closed = once(window, "closed", { signal: AbortSignal.timeout(5000) });
    window.close();
    await closed;
    assert.equal(window.isDestroyed(), true);
    console.log(
      "PASS native overlay, zoom, maximize, restore, tray, available display DPI and close",
    );
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
}

void main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
