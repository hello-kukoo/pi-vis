import path from "path";
import { newSessionId } from "@shared/ids.js";
import type { SessionId } from "@shared/ids.js";
import type { SessionStatus } from "@shared/ipc-contract.js";
import type { PiEvent } from "@shared/pi-protocol/events.js";
import type { ExtensionUiRequest } from "@shared/pi-protocol/extension-ui.js";
import { PiProcess } from "../pi/pi-process.js";

export interface SessionRecord {
  sessionId: SessionId;
  workspacePath: string;
  sessionFile?: string | undefined;
  status: SessionStatus;
  error?: string | undefined;
  proc?: PiProcess | undefined;
}

type SessionEventCallback = (sessionId: SessionId, event: PiEvent) => void;
type UiRequestCallback = (sessionId: SessionId, req: ExtensionUiRequest) => void;
type StatusChangedCallback = (sessionId: SessionId, status: SessionStatus, error?: string) => void;

export class SessionRegistry {
  private sessions = new Map<SessionId, SessionRecord>();
  private byFile = new Map<string, SessionId>(); // resolved file path → SessionId

  private onEvent: SessionEventCallback;
  private onUiRequest: UiRequestCallback;
  private onStatusChanged: StatusChangedCallback;

  constructor(
    onEvent: SessionEventCallback,
    onUiRequest: UiRequestCallback,
    onStatusChanged: StatusChangedCallback,
  ) {
    this.onEvent = onEvent;
    this.onUiRequest = onUiRequest;
    this.onStatusChanged = onStatusChanged;
  }

  startSession(
    piPath: string,
    workspacePath: string,
    sessionFile?: string,
  ): SessionId {
    // Block double-open on same session file
    if (sessionFile) {
      const resolved = path.resolve(sessionFile);
      const existing = this.byFile.get(resolved);
      if (existing) {
        const rec = this.sessions.get(existing);
        if (rec && rec.status !== "exited" && rec.status !== "failed") {
          throw new Error(`Session file already open: ${resolved}`);
        }
        this.byFile.delete(resolved);
      }
    }

    const sessionId = newSessionId();
    const record: SessionRecord = {
      sessionId,
      workspacePath,
      sessionFile,
      status: "starting",
    };
    this.sessions.set(sessionId, record);

    if (sessionFile) {
      this.byFile.set(path.resolve(sessionFile), sessionId);
    }

    this.onStatusChanged(sessionId, "starting");

    try {
      const proc = new PiProcess(piPath, workspacePath, sessionFile);
      record.proc = proc;

      proc.on("event", (event) => {
        if (record.status === "starting") {
          record.status = "ready";
          this.onStatusChanged(sessionId, "ready");
        }
        this.onEvent(sessionId, event);
      });

      proc.on("uiRequest", (req) => {
        this.onUiRequest(sessionId, req);
      });

      proc.on("exit", (code) => {
        clearTimeout(readyTimer);
        record.status = "exited";
        record.error = code !== 0 ? `Exited with code ${code}` : undefined;
        this.onStatusChanged(sessionId, "exited", record.error);
      });

      proc.on("error", (err) => {
        record.status = "failed";
        record.error = err.message;
        this.onStatusChanged(sessionId, "failed", err.message);
      });

      // Mark ready after a brief delay if no events arrive (some pi versions emit nothing initially)
      const readyTimer = setTimeout(() => {
        if (record.status === "starting") {
          record.status = "ready";
          this.onStatusChanged(sessionId, "ready");
        }
      }, 2000);
      readyTimer.unref?.();
    } catch (err) {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      this.onStatusChanged(sessionId, "failed", record.error);
    }

    return sessionId;
  }

  getSession(sessionId: SessionId): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  stopSession(sessionId: SessionId): void {
    const rec = this.sessions.get(sessionId);
    if (rec?.proc) {
      rec.proc.stop();
    }
  }

  stopAll(): void {
    for (const rec of this.sessions.values()) {
      rec.proc?.stop();
    }
  }

  getAll(): SessionRecord[] {
    return Array.from(this.sessions.values());
  }
}
