import type { SessionId } from "@shared/ids.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Composer } from "./components/composer/Composer.js";
import { ExtensionDialogHost, ToastHost } from "./components/ext-ui/ExtensionDialogHost.js";
import { SessionHeader } from "./components/session-header/SessionHeader.js";
import { SettingsView } from "./components/settings/SettingsView.js";
import { PiNotFound } from "./components/setup/PiNotFound.js";
import { Sidebar } from "./components/shell/Sidebar.js";
import { StatusBar } from "./components/shell/StatusBar.js";
import { TitleBar } from "./components/shell/TitleBar.js";
import { TranscriptView } from "./components/transcript/TranscriptView.js";
import { useSessionsStore } from "./stores/sessions-store.js";
import { useSettingsStore } from "./stores/settings-store.js";
import "./App.css";

export function App(): React.ReactElement {
  const { activeSessionId, setSessionStatus, applyEvent, addUiRequest } = useSessionsStore();
  const { load: loadSettings } = useSettingsStore();
  const [piFound, setPiFound] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);

  // Boot: load settings and check for pi
  useEffect(() => {
    loadSettings();
    window.pivis.invoke("pi.locate", undefined).then((info) => {
      setPiFound(info !== null);
    });
  }, [loadSettings]);

  // Subscribe to IPC events
  useEffect(() => {
    const unsubEvent = window.pivis.on("session.event", ({ sessionId, event }) => {
      applyEvent(sessionId as SessionId, event);
    });

    const unsubUiReq = window.pivis.on("session.uiRequest", ({ sessionId, request }) => {
      addUiRequest(sessionId as SessionId, request);
    });

    const unsubStatus = window.pivis.on("session.statusChanged", ({ sessionId, status, error }) => {
      setSessionStatus(sessionId as SessionId, status, error);
    });

    return () => {
      unsubEvent();
      unsubUiReq();
      unsubStatus();
    };
  }, [applyEvent, addUiRequest, setSessionStatus]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handlePiRecheck = useCallback(async () => {
    const info = await window.pivis.invoke("pi.locate", undefined);
    setPiFound(info !== null);
  }, []);

  if (piFound === null) {
    return (
      <div className="app-loading">
        <span className="app-loading__text">Loading…</span>
      </div>
    );
  }

  if (piFound === false) {
    return (
      <div className="app app--setup">
        <PiNotFound onRecheck={handlePiRecheck} />
      </div>
    );
  }

  return (
    <div
      className="app"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          gridTemplateColumns: `${sidebarWidth}px 1fr`,
        } as React.CSSProperties
      }
    >
      <TitleBar />
      <Sidebar
        onOpenSettings={() => setShowSettings(true)}
        width={sidebarWidth}
        onResize={setSidebarWidth}
      />
      <main className="app__main">
        {activeSessionId ? (
          <div className="app__session" style={{ position: "relative" }}>
            <SessionHeader sessionId={activeSessionId} />
            <TranscriptView sessionId={activeSessionId} />
            <Composer sessionId={activeSessionId} />
            <StatusBar sessionId={activeSessionId} />
            <ExtensionDialogHost sessionId={activeSessionId} />
            <ToastHost sessionId={activeSessionId} />
          </div>
        ) : (
          <div className="app__empty">
            <div className="app__empty-hint">Select a workspace and open or resume a session</div>
          </div>
        )}
      </main>
      {showSettings && <SettingsView onClose={() => setShowSettings(false)} />}
    </div>
  );
}
