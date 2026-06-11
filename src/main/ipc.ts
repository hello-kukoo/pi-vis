import { ipcMain, app } from "electron";
import type { BrowserWindow } from "electron";
import { locatePi, clearPiLocationCache } from "./pi/locate-pi.js";
import { SessionRegistry } from "./sessions/session-registry.js";
import { listSessionsForWorkspace } from "./sessions/session-discovery.js";
import { loadHistory } from "./sessions/history-loader.js";
import { getSettings, saveSettings } from "./settings-store.js";
import { pickWorkspace, getRecentWorkspaces } from "./workspaces.js";
import type { SessionId } from "@shared/ids.js";
import type { PiEvent } from "@shared/pi-protocol/events.js";
import type { ExtensionUiRequest, ExtensionUiResponse } from "@shared/pi-protocol/extension-ui.js";
import type { SessionStatus } from "@shared/ipc-contract.js";
import type { PiRpcCommand } from "@shared/pi-protocol/commands.js";

let registry: SessionRegistry | null = null;
let mainWindow: BrowserWindow | null = null;

export function initIpc(win: BrowserWindow): void {
  mainWindow = win;

  // During quit, pi processes are SIGTERMed and emit final events/exits after
  // the window is gone — sending to a destroyed webContents throws.
  const safeSend = (channel: string, payload: unknown): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };

  registry = new SessionRegistry(
    (sessionId: SessionId, event: PiEvent) => {
      safeSend("session.event", { sessionId, event });
    },
    (sessionId: SessionId, req: ExtensionUiRequest) => {
      safeSend("session.uiRequest", { sessionId, request: req });
    },
    (sessionId: SessionId, status: SessionStatus, error?: string) => {
      safeSend("session.statusChanged", { sessionId, status, error });
    },
  );

  ipcMain.handle("pi.locate", async () => {
    clearPiLocationCache();
    const settings = getSettings();
    return locatePi(settings.piBinaryPath);
  });

  ipcMain.handle("workspace.pick", async () => {
    return pickWorkspace();
  });

  ipcMain.handle("workspace.recents", async () => {
    return getRecentWorkspaces();
  });

  ipcMain.handle("workspace.listSessions", async (_evt, args: { workspacePath: string }) => {
    return listSessionsForWorkspace(args.workspacePath);
  });

  ipcMain.handle(
    "session.start",
    async (_evt, args: { workspacePath: string; resumeFile?: string }) => {
      const settings = getSettings();
      const piInfo = await locatePi(settings.piBinaryPath);
      if (!piInfo) throw new Error("pi binary not found. Please install pi or set the path in settings.");

      if (!registry) throw new Error("Registry not initialized");
      const sessionId = registry.startSession(piInfo.path, args.workspacePath, args.resumeFile);
      return sessionId;
    },
  );

  ipcMain.handle("session.loadHistory", async (_evt, args: { sessionId: SessionId }) => {
    const rec = registry?.getSession(args.sessionId);
    if (!rec?.sessionFile) return [];
    return loadHistory(rec.sessionFile);
  });

  ipcMain.handle(
    "session.sendCommand",
    async (_evt, args: { sessionId: SessionId; command: PiRpcCommand }) => {
      const rec = registry?.getSession(args.sessionId);
      if (!rec?.proc) throw new Error(`No active process for session ${args.sessionId}`);
      return rec.proc.sendCommand(args.command);
    },
  );

  ipcMain.handle(
    "session.respondToUiRequest",
    async (_evt, args: { sessionId: SessionId; response: ExtensionUiResponse }) => {
      const rec = registry?.getSession(args.sessionId);
      if (!rec?.proc) return;
      rec.proc.sendUiResponse(JSON.stringify(args.response));
    },
  );

  ipcMain.handle("session.stop", async (_evt, args: { sessionId: SessionId }) => {
    registry?.stopSession(args.sessionId);
  });

  ipcMain.handle("settings.get", async () => {
    return getSettings();
  });

  ipcMain.handle("settings.set", async (_evt, updates: Partial<ReturnType<typeof getSettings>>) => {
    return saveSettings(updates);
  });

  ipcMain.handle("app.versions", async () => {
    return {
      app: app.getVersion(),
      electron: process.versions["electron"] ?? "",
      node: process.versions["node"] ?? "",
    };
  });
}

export function stopAllSessions(): void {
  registry?.stopAll();
}

export { mainWindow };
