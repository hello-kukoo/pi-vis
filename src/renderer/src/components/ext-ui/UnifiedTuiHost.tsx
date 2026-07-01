/**
 * UnifiedTuiHost — embedded xterm.js for the persistent unified-TUI panel.
 *
 * Rendered (in place of the Composer) when a session has a `unifiedPanel` —
 * i.e. an extension registered a factory `setWidget` and the SDK host built a
 * real pi-tui `TUI` hosting the Editor + widget components. The host writes
 * ANSI to this panel; keystrokes flow back over `session.panelInput` exactly as
 * for a custom() panel, so the TUI's `handleInput` chain (`inputListeners` +
 * the focused Editor) receives them.
 *
 * Sibling of `CustomPanelHost`, but:
 *  - persistent + non-modal (no `done()`/force-close) — the extension owns the
 *    lifecycle via `setWidget(key, undefined)` → `panel_close`;
 *  - reads `unifiedPanel` (not `panel`), so it never collides with a custom()
 *    overlay and `extensionUiActive` doesn't treat it as a blocking dialog.
 *
 * Lifecycle mirrors CustomPanelHost: rebuild xterm only on panel-identity
 * change (not on every streamed frame); live `panel_data` arrives via the
 * `session.panelEvent` subscription.
 */

import type { SessionId } from "@shared/ids.js";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type React from "react";
import { useEffect, useRef } from "react";
import { useEscapeClaim } from "../../hooks/useEscapeClaim.js";
import { useSessionsStore } from "../../stores/sessions-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { getTheme } from "../../theme/registry.js";
import { buildXtermTheme } from "../../theme/xterm.js";
import { createPanelSizer } from "./panel-sizer.js";
import "@xterm/xterm/css/xterm.css";
import "./CustomPanelHost.css";

// ─── Props ───────────────────────────────────────────────────────────────

interface UnifiedTuiHostProps {
  sessionId: SessionId;
}

function resolveMonoFont(): string {
  const fromVar = getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim();
  return fromVar || "ui-monospace, Menlo, monospace";
}

// ─── Component ────────────────────────────────────────────────────────────

export function UnifiedTuiHost({ sessionId }: UnifiedTuiHostProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const panelRef = useRef<{ id: number; buffer: string[]; mode?: "content" | "viewport" } | null>(
    null,
  );
  // The current sizing pass, exposed by the lifecycle effect so the mode-change
  // effect below can re-run it without taking sync's deps.
  const syncRef = useRef<(() => void) | null>(null);
  // Display mode, read live by sync() without being a rebuild dep (mode flips
  // mid-panel must NOT tear down xterm).
  const modeRef = useRef<"content" | "viewport">("content");
  const { unifiedPanel } = useSessionsStore((s) => s.sessions.get(sessionId)) ?? {};
  // Keep panelRef in sync so the lifecycle effect (dep = panelId only) can read
  // the current buffer without taking it as a reactive dep (which would rebuild
  // xterm on every streamed frame).
  panelRef.current = unifiedPanel ?? null;
  const panelId = unifiedPanel?.id;
  const panelMode = unifiedPanel?.mode ?? "content";
  modeRef.current = panelMode;

  // ESC parity with the real TUI: whatever ESC does in pi's terminal, it must
  // do here too. pi's precedence is overlay-close > autocomplete-close >
  // interrupt. The renderer-only global ESC handler supplies the interrupt the
  // host's base Editor can't (see AGENTS.md "ESC-to-interrupt"), but that
  // interrupt must be the LOWEST-priority ESC action — it may fire only when
  // the host TUI would not otherwise consume the key. An open pi-tui overlay
  // (the extension's "ESC to close" box) is signalled to us as viewport mode,
  // so while an overlay is up we CLAIM ESC: the global handler then defers and
  // the keystroke flows through to the host, which closes the overlay instead
  // of the agent being aborted mid-stream. In content mode (no overlay) we
  // stay unclaimed so a streaming ESC still interrupts.
  useEscapeClaim(panelMode === "viewport");

  // Live re-theme: the host emits role-identity ANSI indices, and xterm
  // resolves them against `term.options.theme.extendedAnsi` at paint time, so
  // swapping the palette recolors every buffered cell with no re-emit. The
  // Terminal persists across scheme changes (the lifecycle effect only
  // rebuilds on panel-identity change), so we update its theme in place here.
  const colorScheme = useSettingsStore((s) => s.settings.colorScheme);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = buildXtermTheme(getTheme(colorScheme ?? "mocha"));
  }, [colorScheme]);

  // Re-run the sizing pass when the mode flips (overlay shown/hidden). The
  // lifecycle effect is keyed on panelId only, so it doesn't re-fire here — but
  // viewport↔content needs an immediate re-size, not just on the next frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: panelMode is the trigger; the body deliberately only re-runs the current sync
  useEffect(() => {
    syncRef.current?.();
  }, [panelMode]);

  // One lifecycle effect: build terminal, stream data, handle input, cleanup.
  // Rebuild xterm ONLY when the panel identity changes (NOT on buffer appends).

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild terminal on panel identity change only, not buffer appends
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const currentPanel = panelRef.current;
    if (!currentPanel) return;

    let disposed = false;
    let unsubPanel: (() => void) | null = null;

    const fontFamily = resolveMonoFont();
    const { colorScheme, fonts } = useSettingsStore.getState().settings;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: fonts?.code?.sizePx ?? 14,
      fontFamily,
      theme: buildXtermTheme(getTheme(colorScheme ?? "mocha")),
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    term.open(container);

    // Focus on mount + refocus on click so the TUI's Editor receives keystrokes.
    term.focus();
    const refocus = () => term.focus();
    container.addEventListener("mousedown", refocus);

    // The card (.unified-panel) is the visible box we clip/scroll; the mount
    // (.custom-panel__xterm) holds the terminal grid.
    const panelEl = container.parentElement as HTMLElement;
    const sessionEl = container.closest(".app__session") as HTMLElement | null;

    // Deterministic grid-tracks-content sizing (shared with CustomPanelHost —
    // see panel-sizer.ts). The grid resizes toward the content height, the card
    // hugs it capped at ~half the transcript column, and scrolls only past that
    // cap. `getMode` reads modeRef live so a viewport↔content flip (a pi-tui
    // overlay showing/hiding) reconfigures sizing without tearing down xterm.
    const sizer = createPanelSizer({
      term,
      container,
      panelEl,
      sessionEl,
      fitAddon,
      getMode: () => modeRef.current,
      fallbackFontSize: fonts?.code?.sizePx ?? 14,
      onReportSize: (cols, rows) => {
        void window.pivis
          .invoke("session.panelResize", { sessionId, panelId: currentPanel.id, cols, rows })
          .catch(() => {});
      },
    });
    // Expose the (coalesced) sizing pass so the mode-change effect can re-run it.
    syncRef.current = sizer.scheduleSync;

    // Replay the remount snapshot. Measure in the write CALLBACK (fires after
    // xterm has parsed the bytes) — measuring synchronously read a not-yet-
    // parsed buffer on cold mount, which is why the panel opened too short and
    // only corrected on a later remount.
    for (const chunk of currentPanel.buffer) {
      term.write(chunk);
    }
    term.write("", () => {
      if (!disposed) sizer.scheduleSync();
    });

    unsubPanel = window.pivis.on("session.panelEvent", ({ sessionId: eventSid, event }) => {
      if (eventSid !== sessionId) return;
      if (event.type === "panel_data" && event.panelId === currentPanel.id) {
        term.write(event.data, () => {
          if (!disposed) sizer.scheduleSync();
        });
      }
    });

    // User keystrokes → host TUI (panelInput is shared with custom() panels).
    const onDataDispose = term.onData((data) => {
      void window.pivis
        .invoke("session.panelInput", { sessionId, panelId: currentPanel.id, data })
        .catch(() => {});
    });

    // Re-derive sizing when the transcript column resizes (window resize,
    // sidebar collapse, font change) — both cols and the display cap depend on
    // it. The column is never sized BY us, so this can't feed back.
    const resizeObserver = new ResizeObserver(() => sizer.scheduleSync());
    if (sessionEl) resizeObserver.observe(sessionEl);

    // Wait for the render service to measure cell dimensions before the first
    // sizing pass (double rAF: layout + paint).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        sizer.sync();
      });
    });

    return () => {
      disposed = true;
      syncRef.current = null;
      container.removeEventListener("mousedown", refocus);
      onDataDispose.dispose();
      unsubPanel?.();
      resizeObserver.disconnect();
      sizer.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, panelId]);

  return (
    <div className="custom-panel unified-panel">
      {/* No header/close button: the unified panel is persistent and the
          extension owns its lifecycle (setWidget(key, undefined) → panel_close).
          A modal-style ✕ would contradict that. */}
      <div ref={containerRef} className="custom-panel__xterm" />
    </div>
  );
}
