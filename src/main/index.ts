import path from "node:path";
import { BrowserWindow, app, session, shell } from "electron";
import { initIpc, stopAllSessions, triggerBackgroundUpdateCheck } from "./ipc.js";
import { loadSettings, saveSettings } from "./settings-store.js";

app.setName("Pi-Vis");

function createWindow(): BrowserWindow {
  const settings = loadSettings();
  const bounds = settings.window;

  const winOpts = {
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    ...(bounds?.x !== undefined ? { x: bounds.x } : {}),
    ...(bounds?.y !== undefined ? { y: bounds.y } : {}),
    show: false,
  };
  const win = new BrowserWindow({
    ...winOpts,
    backgroundColor: "#1e1e2e",
    // `hiddenInset` (not `hidden`) — the traffic lights stay visible
    // and macOS positions them natively as part of the window frame,
    // so they remain perfectly centered regardless of the renderer's
    // font size, zoom, or layout. Requires `frame: true` (the default;
    // do NOT set frame: false, which would strip the frame architecture
    // that hiddenInset needs to position the lights). The
    // `trafficLightPosition` option is ignored under `hiddenInset` and
    // is therefore omitted.
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  // Allow queryLocalFonts (permission name "local-fonts" may not be in Electron's typed union)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(String(permission) === "local-fonts");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return String(permission) === "local-fonts";
  });

  initIpc(win);

  // External links open in the OS browser; never open new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  // Prevent the app window from ever navigating away from the renderer.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    }
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("close", () => {
    const b = win.getBounds();
    saveSettings({ window: b });
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  // Strict CSP for the packaged (file://) app. Skipped in dev: the Vite dev
  // server needs inline/eval/websocket for HMR. 'wasm-unsafe-eval' is required
  // by Shiki's WASM highlighter; 'unsafe-inline' style is required by Shiki and
  // React inline styles.
  if (!process.env["ELECTRON_RENDERER_URL"]) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'wasm-unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: file: https:; " +
              "font-src 'self' data:; " +
              "connect-src 'self'; " +
              "object-src 'none'; base-uri 'none'; frame-src 'none'",
          ],
        },
      });
    });
  }

  createWindow();

  // Background update check (3s delay, non-blocking)
  triggerBackgroundUpdateCheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopAllSessions();
});
