/**
 * panel-sizer — the deterministic grid-tracks-content sizing engine shared by
 * the two inline xterm.js panels (UnifiedTuiHost + CustomPanelHost).
 *
 * The load-bearing fact both panels share: pi-tui writes ALL of its rendered
 * lines (joined by \r\n) with NO clamp to the terminal `rows`. When content is
 * taller than the grid, the terminal SCROLLS and bottom-anchors, pushing the
 * top into scrollback (the "cut-off line" bug) with no way to scroll back. So
 * the grid is not a fixed budget — it must TRACK the content height. The
 * invariant this engine maintains:
 *
 *   • grid `rows` = contentRows + 1  (a one-row blank "sentinel" so we can tell
 *     "content fits" from "content filled the grid and may be clipped"). Reported
 *     to the host so its TUI lays out into exactly this grid — every line stays
 *     in the viewport, top-anchored, nothing scrolls into scrollback.
 *   • mount height = grid height (rows × cell).
 *   • card height  = min(contentRows, maxDisplayRows) × cell — the box hugs the
 *     content, capped at a deterministic max derived from the transcript column
 *     (NOT from window-resize history). Trailing blanks (incl. the sentinel) are
 *     clipped.
 *   • card overflows (scrolls) ONLY when contentRows > maxDisplayRows — then the
 *     card scrolls through the content, top-anchored (the spec's "scrollbar only
 *     past the max").
 *
 * Determinism: the size is a pure function of the transcript-column height
 * (sessionEl) and the content. Growing the window re-derives a larger cap and
 * re-expands; shrinking re-derives a smaller one. There is no hysteresis — the
 * path taken to reach the current window size never affects the result.
 *
 * Convergence: a height change makes pi-tui fullRender(true) (clears scrollback
 * + re-lays-out), so growing the grid brings a clipped top back and shrinking
 * removes trailing blanks. Settles in ≤2 resizes, then is stable.
 *
 * Two modes:
 *   • "content" (default): track the content as above.
 *   • "viewport": a pi-tui overlay is compositing against `rows`, so its rendered
 *     height is a function of the grid we report — content-tracking and the
 *     overlay would chase each other (the "wiggle"). Pin a FIXED grid (the
 *     display cap) instead and stop tracking.
 *
 * A resize-storm circuit breaker is the defense-in-depth for any grid-coupled
 * content that does NOT signal viewport mode: too many resizes in a short window
 * ⇒ pin to the tallest size seen for a cooldown, then re-evaluate.
 */

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

/** The slice of xterm's private core we read for the exact rendered cell height
 *  (font-metric accurate — the public API doesn't expose it). */
interface XtermCore {
  _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } };
}

export interface PanelSizerOptions {
  /** The xterm terminal whose grid we resize. */
  term: Terminal;
  /** The xterm mount (`.custom-panel__xterm`) — holds the full grid. */
  container: HTMLElement;
  /** The visible card (`.custom-panel` / `.unified-panel`) — clipped/scrolled. */
  panelEl: HTMLElement;
  /** The transcript column the panel sits inside (`.app__session`), or null. */
  sessionEl: HTMLElement | null;
  /** For proposeDimensions() → the mount-width-driven column count. */
  fitAddon: FitAddon;
  /** Live display-mode read (must NOT be a rebuild dep — a mid-panel flip
   *  reconfigures sizing without tearing down xterm). */
  getMode: () => "content" | "viewport";
  /** Live read of the user's preferred panel height as a fraction of the
   *  session column (0–1), overriding the default cap. Omit for the default
   *  (~half). CustomPanelHost passes the drag/persisted override; UnifiedTuiHost
   *  omits it (content-tracks against the default cap). Must NOT be a rebuild
   *  dep (a drag / settings change re-runs sync without rebuilding xterm). */
  getHeightFraction?: () => number;
  /** Font size to fall back to before xterm has measured its cell metrics. */
  fallbackFontSize: number;
  /** Push the current grid size to the host (deduped by the sizer). */
  onReportSize: (cols: number, rows: number) => void;
}

export interface PanelSizer {
  /** Run one sizing pass immediately. */
  sync: () => void;
  /** Coalesce a burst of triggers into at most one pass per animation frame. */
  scheduleSync: () => void;
  /** Tear down: cancel timers and reset the styles the sizer set. */
  dispose: () => void;
}

/** Half the transcript column: the default cap past which the card scrolls
 *  instead of growing. A CustomPanelHost may override this with the user's
 *  drag-resized preference (getHeightFraction); UnifiedTuiHost uses the default. */
export const DEFAULT_HEIGHT_FRACTION = 0.5;

// Resize-storm circuit breaker tuning.
const RESIZE_WINDOW_MS = 400;
const MAX_RESIZES_PER_WINDOW = 6;
const COOLDOWN_MS = 1000;

export function createPanelSizer(opts: PanelSizerOptions): PanelSizer {
  const { term, container, panelEl, sessionEl, fitAddon, getMode, fallbackFontSize, onReportSize } =
    opts;
  const heightFraction: () => number = opts.getHeightFraction ?? (() => DEFAULT_HEIGHT_FRACTION);

  let disposed = false;

  // Real rendered cell height from xterm's render service (font-metric exact,
  // not a fontSize*1.2 guess that would desync the math). Falls back before the
  // first measurement tick.
  const cellHeight = (): number => {
    const core = (term as unknown as { _core?: XtermCore })._core;
    const h = core?._renderService?.dimensions?.css?.cell?.height;
    return typeof h === "number" && h > 0 ? h : fallbackFontSize * 1.2;
  };

  const sessionHeight = (): number => sessionEl?.clientHeight ?? window.innerHeight;

  // The visible cap — a fraction of the transcript column (default ~half,
  // or the user's drag-resized preference). Past this the card scrolls.
  const maxDisplayRows = (): number =>
    Math.max(1, Math.floor((sessionHeight() * heightFraction()) / cellHeight()));

  // Safety ceiling on the grid so a runaway extension can't make a 1000-row
  // terminal. Generous (the full column), well above any real content.
  const hardMaxRows = (): number =>
    Math.max(maxDisplayRows() * 2, Math.floor(sessionHeight() / cellHeight()), 24);

  // Rows occupied by content (last non-blank + 1), and whether the content
  // reached the bottom grid row (no trailing blank → it may be clipped into
  // scrollback, so the grid needs to grow). Never reports below the caret row,
  // so an editor's (possibly blank) input line is always kept.
  const measureContent = (): { rows: number; filled: boolean } => {
    const buf = term.buffer.active;
    let lastNonBlank = -1;
    for (let i = 0; i < term.rows; i++) {
      const line = buf.getLine(buf.baseY + i);
      if (line && line.translateToString(true).length > 0) lastNonBlank = i;
    }
    const rows = Math.max(lastNonBlank + 1, buf.cursorY + 1, 1);
    return { rows, filled: lastNonBlank >= term.rows - 1 };
  };

  // Vertical chrome (padding + border) of the card, so the JS heights produce
  // the intended CONTENT area regardless of box-sizing.
  const cardChrome = (): number => {
    const cs = window.getComputedStyle(panelEl);
    return (
      Number.parseFloat(cs.paddingTop) +
      Number.parseFloat(cs.paddingBottom) +
      Number.parseFloat(cs.borderTopWidth) +
      Number.parseFloat(cs.borderBottomWidth)
    );
  };

  let lastCols = -1;
  let lastRows = -1;

  // Tell the transcript that the Composer slot changed height outside a React
  // layout pass (xterm measures/render-resizes asynchronously). When the feed is
  // bottom-pinned it must re-pin immediately, otherwise the new panel appears to
  // cover the latest transcript lines until another token arrives.
  const notifyComposerSlotResize = (): void => {
    panelEl.dispatchEvent(new CustomEvent("pivis:composer-slot-resize", { bubbles: true }));
  };

  // Push the current grid size to the host (only on change — avoids redundant
  // IPC + host re-renders).
  const reportSize = (cols: number, rows: number): void => {
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    onReportSize(cols, rows);
  };

  // Pin a FIXED grid of `rows` (no content tracking) and size mount + card to
  // match. Used in viewport mode (a pi-tui overlay is up — its geometry tracks
  // the rows we give it, so a stable grid yields a stable render) and as the
  // resize-storm circuit breaker. cols still tracks the mount width.
  const applyFixedViewport = (rows: number, cols: number, cell: number): void => {
    const gridRows = Math.max(1, Math.min(rows, hardMaxRows()));
    if (cols !== term.cols || gridRows !== term.rows) term.resize(cols, gridRows);
    reportSize(cols, gridRows);
    const displayRows = Math.min(gridRows, maxDisplayRows());
    container.style.height = `${gridRows * cell}px`;
    panelEl.style.height = `${displayRows * cell + cardChrome()}px`;
    panelEl.style.overflowY = gridRows > maxDisplayRows() ? "auto" : "hidden";
    notifyComposerSlotResize();
  };

  // ── Resize-storm circuit breaker (damping) ──────────────────────────────
  let resizeTimes: number[] = [];
  let pinnedRows = 0; // > 0 while the breaker is engaged
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  let syncQueued = false;
  const scheduleSync = (): void => {
    if (syncQueued || disposed) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      if (!disposed) sync();
    });
  };

  // Single sizing pass. In content mode resizes the grid toward `contentRows+1`
  // and converges over ≤2 frames; in viewport mode (or while the breaker is
  // engaged) pins a fixed grid instead. Re-runs are coalesced via scheduleSync.
  const sync = (): void => {
    if (disposed) return;
    const cell = cellHeight();

    // Width (cols) tracks the mount; height (rows) tracks the content.
    let cols = term.cols;
    try {
      cols = fitAddon.proposeDimensions()?.cols ?? cols;
    } catch {
      // proposeDimensions throws before the mount has a layout; keep current.
    }

    // Viewport mode: a pi-tui overlay is compositing against `rows`. Give it a
    // steady screen (the display cap) and never chase its height — that chase
    // is the wiggle. cols still tracks width.
    if (getMode() === "viewport") {
      applyFixedViewport(maxDisplayRows(), cols, cell);
      return;
    }

    // Breaker engaged: hold the pinned grid until the cooldown re-opens tracking.
    if (pinnedRows > 0) {
      applyFixedViewport(pinnedRows, cols, cell);
      return;
    }

    const { rows: contentRows, filled } = measureContent();
    const hardMax = hardMaxRows();
    // If the content filled the grid it may be clipped → jump to the ceiling so
    // the next render reveals the true height; otherwise hug content + sentinel.
    const targetRows = filled && term.rows < hardMax ? hardMax : Math.min(contentRows + 1, hardMax);

    if (cols !== term.cols || targetRows !== term.rows) {
      // Trip the breaker if resizes are coming too fast to be a real settle.
      const now = Date.now();
      resizeTimes.push(now);
      resizeTimes = resizeTimes.filter((t) => now - t < RESIZE_WINDOW_MS);
      if (resizeTimes.length > MAX_RESIZES_PER_WINDOW) {
        pinnedRows = Math.min(hardMax, Math.max(term.rows, targetRows));
        resizeTimes = [];
        if (cooldownTimer) clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => {
          cooldownTimer = null;
          pinnedRows = 0; // re-open tracking — content may have settled
          scheduleSync();
        }, COOLDOWN_MS);
        applyFixedViewport(pinnedRows, cols, cell);
        return;
      }

      term.resize(cols, targetRows);
      reportSize(cols, targetRows);
      // The grid changed: xterm reflows the existing buffer into the new
      // dimensions (and the host re-renders a fresh frame too). Re-measure on
      // the next frame to converge — don't depend on a host frame arriving,
      // so this settles in the preview/host-less case as well.
      scheduleSync();
      return;
    }
    reportSize(cols, targetRows);

    // Settled. Mount holds the full grid; the card hugs the content, capped.
    container.style.height = `${term.rows * cell}px`;
    const displayRows = Math.min(contentRows, maxDisplayRows());
    panelEl.style.height = `${displayRows * cell + cardChrome()}px`;
    // Scroll (via the card) only when the content is taller than the cap.
    panelEl.style.overflowY = contentRows > maxDisplayRows() ? "auto" : "hidden";
    notifyComposerSlotResize();
  };

  const dispose = (): void => {
    disposed = true;
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = null;
    panelEl.style.height = "";
    panelEl.style.overflowY = "";
    container.style.height = "";
    notifyComposerSlotResize();
  };

  return { sync, scheduleSync, dispose };
}
