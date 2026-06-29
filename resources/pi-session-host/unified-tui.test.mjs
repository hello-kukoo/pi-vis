/**
 * Unified-TUI host-render integration test — the regression gate for the
 * "factory setWidget opens a panel that never paints" class of bug.
 *
 * WHY THIS LAYER EXISTS
 * ─────────────────────
 * The other two unified-panel tests fake the host's ANSI output:
 *   - tests/render/unified-panel.spec.mts (preview stub) and
 *   - tests/e2e/unified-panel.spec.mts (fake-unified-host.mjs)
 * both emit canned `panel_open{unified}` + `panel_data`. They prove the
 * renderer pipeline (store reducer → UnifiedTuiHost → xterm) works, but they
 * NEVER run resources/pi-session-host/ui-context.mjs's `ensureUnifiedTui()` —
 * the code that builds a REAL pi-tui `TUI` (Editor + widget Containers) and
 * relies on pi's theme. That is exactly where the original bug lived: the host
 * passed pi's Theme singleton to `new Editor(tui, theme)`, but pi-tui's Editor
 * needs an `EditorTheme` ({ borderColor:(s)=>string, selectList }), so
 * `Editor.render()` threw `this.borderColor is not a function` on the first
 * render tick — the panel opened (Composer replaced) but produced no output and
 * could crash the host. No faked-output test can catch that.
 *
 * This test drives the REAL `createUIContext` → REAL pi-tui Editor render with
 * the REAL pi theme, and asserts the editor actually paints (panel_data frames
 * are produced). It needs a real pi install; when pi can't be resolved it
 * SKIPS (like the PI_E2E gate) rather than failing.
 */
import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { importPi, importPiTui } from "./bootstrap.mjs";
import { buildEditorTheme } from "./editor-theme.mjs";
import { createUIContext } from "./ui-context.mjs";

// ── Locate a real pi binary (skip the suite if absent) ──────────────────────
function locatePiBin() {
  const candidates = [];
  if (process.env.PIVIS_TEST_PI_BIN) candidates.push(process.env.PIVIS_TEST_PI_BIN);
  try {
    candidates.push(execSync("command -v pi", { encoding: "utf8" }).trim());
  } catch {
    /* pi not on PATH */
  }
  candidates.push("/opt/homebrew/bin/pi", "/usr/local/bin/pi");
  for (const c of candidates) {
    if (c && existsSync(c)) {
      try {
        return realpathSync(c);
      } catch {
        /* dangling symlink */
      }
    }
  }
  return null;
}

const PI_BIN = locatePiBin();

// THEME_KEY mirrors bootstrap.mjs initHostTheme — read the global theme the
// way the host does, without a private import.
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

// A capturing panel bridge: records the wire messages ensureUnifiedTui() emits.
function makeCapturingBridge() {
  const messages = [];
  let counter = 0;
  return {
    messages,
    openPanel({ overlay, unified }) {
      const id = ++counter;
      messages.push({ type: "panel_open", panelId: id, overlay, unified });
      return id;
    },
    writePanel(panelId, data) {
      messages.push({ type: "panel_data", panelId, data });
    },
    closePanel(panelId) {
      messages.push({ type: "panel_close", panelId });
    },
    setPanelMode(panelId, mode) {
      messages.push({ type: "panel_mode", panelId, mode });
    },
    setInputHandler() {},
    clearInputHandler() {},
    feedInput() {},
    setResizeHandler() {},
    clearResizeHandler() {},
    setCanceller() {},
    cancel() {},
    closeAll() {
      return false;
    },
    resize() {},
  };
}

const describeOrSkip = PI_BIN ? describe : describe.skip;

describeOrSkip("unified-TUI host render (real pi-tui + pi theme)", () => {
  let pi;
  let piTui;
  let theme;
  let controllers;

  afterEach(() => {
    // Tear down any TUI we created so its render timer doesn't outlive the test.
    for (const c of controllers ?? []) {
      try {
        c.dispose();
      } catch {
        /* already disposed */
      }
    }
    controllers = [];
  });

  async function setup() {
    pi = await importPi(PI_BIN);
    piTui = await importPiTui(PI_BIN);
    pi.initTheme();
    theme = globalThis[THEME_KEY] ?? globalThis[THEME_KEY_OLD];
    controllers = [];
  }

  function tuiModules() {
    return {
      TUI: piTui.TUI,
      KeybindingsManager: piTui.KeybindingsManager,
      TUI_KEYBINDINGS: piTui.TUI_KEYBINDINGS,
      Container: piTui.Container,
      Editor: piTui.Editor,
    };
  }

  it("the EditorTheme the host builds satisfies pi-tui's Editor contract (the raw theme does NOT)", async () => {
    await setup();
    const editorTheme = buildEditorTheme(pi, theme);
    // The load-bearing invariant pi-tui's Editor depends on.
    expect(typeof editorTheme.borderColor).toBe("function");
    expect(() => editorTheme.borderColor("─")).not.toThrow();
    // Document the bug: the raw pi theme singleton — what the host used to pass
    // straight into `new Editor(tui, theme)` — is NOT a valid EditorTheme.
    expect(typeof theme.borderColor).not.toBe("function");
  });

  it("a factory setWidget builds a real TUI whose Editor + widgets actually render (panel_data is produced)", async () => {
    await setup();
    const bridge = makeCapturingBridge();
    const editorTheme = buildEditorTheme(pi, theme);

    const { context, unified } = createUIContext({
      theme,
      editorTheme,
      panelBridge: bridge,
      createDialog: async () => ({}),
      sendToMain: () => {},
      tuiModules: tuiModules(),
    });
    controllers.push(unified);

    // A fleet-list-shaped factory: returns a pi-tui component (render → string[]).
    context.setWidget(
      "fleet-list",
      () => ({
        render: () => ["▸ Fleet (2 agents)", "  ● swift-otter   running"],
        invalidate() {},
        dispose() {},
      }),
      { placement: "belowEditor" },
    );

    // A unified panel must have opened.
    const open = bridge.messages.find((m) => m.type === "panel_open");
    expect(open, "ensureUnifiedTui must open a unified panel").toBeTruthy();
    expect(open.unified).toBe(true);

    // Let pi-tui's render loop tick. With the BAD theme this throws inside the
    // render timer (no frames); with the fix it paints repeatedly.
    await new Promise((r) => setTimeout(r, 350));

    const frames = bridge.messages.filter((m) => m.type === "panel_data");
    expect(frames.length, "the Editor + widgets must render at least one frame").toBeGreaterThan(0);

    // The widget content the factory produced must reach the panel output —
    // proves the whole composite tree (widgetBelow + editor) rendered, not just
    // a blank screen-clear.
    const painted = frames.map((f) => f.data).join("");
    expect(painted).toContain("Fleet");
  });

  it("custom() overlay on the unified TUI emits panel_mode viewport→content (the wiggle fix)", async () => {
    await setup();
    const bridge = makeCapturingBridge();
    const editorTheme = buildEditorTheme(pi, theme);

    const { context, unified } = createUIContext({
      theme,
      editorTheme,
      panelBridge: bridge,
      createDialog: async () => ({}),
      sendToMain: () => {},
      tuiModules: tuiModules(),
    });
    controllers.push(unified);

    // Build the unified TUI so custom() takes the REUSE path (overlay on the
    // shared TUI) — the path the pi-subagents "inspect" box exercises.
    context.setWidget(
      "fleet-list",
      () => ({ render: () => ["▸ Fleet"], invalidate() {}, dispose() {} }),
      { placement: "belowEditor" },
    );

    // Open a custom() overlay (the inspector box). Capture done() to close it.
    let closeOverlay;
    const overlay = context.custom((_tui, _theme, _kb, done) => {
      closeOverlay = done;
      return {
        render: () => ["┌─ inspect ─┐", "│ agent     │", "└───────────┘"],
        invalidate() {},
        dispose() {},
      };
    }, {});

    // showOverlay runs after the factory promise resolves — let it tick.
    await new Promise((r) => setTimeout(r, 50));
    const modesWhileOpen = bridge.messages.filter((m) => m.type === "panel_mode");
    expect(
      modesWhileOpen.some((m) => m.mode === "viewport"),
      "showing the overlay must pin the renderer to viewport mode",
    ).toBe(true);

    // Close the overlay → the renderer must be released back to content mode.
    closeOverlay(undefined);
    await overlay;
    const modes = bridge.messages.filter((m) => m.type === "panel_mode");
    expect(modes[modes.length - 1].mode, "closing the overlay must restore content mode").toBe(
      "content",
    );
  });
});

// Surface, at import time, why the suite skipped — so a CI run without pi
// doesn't look like silent green.
if (!PI_BIN) {
  // eslint-disable-next-line no-console
  console.warn(
    "[unified-tui.test] skipped: no pi binary found (set PIVIS_TEST_PI_BIN to run the host-render gate)",
  );
}
