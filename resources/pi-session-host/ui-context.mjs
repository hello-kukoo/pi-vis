/**
 * pi-session-host: ExtensionUIContext implementation (mode:"tui").
 *
 * Provides the full ~30-method interface that extensions use.
 *
 * Working methods (pi-vis renders these):
 *   select, confirm, input, editor → dialogs (routed to main process)
 *   notify, setStatus, setWidget, setTitle, setEditorText → fire-and-forget
 *
 * TUI-only methods (safe no-ops — must not throw):
 *   setFooter, setHeader, onTerminalInput, setWorkingIndicator,
 *   setEditorComponent, addAutocompleteProvider, setWorkingMessage,
 *   setWorkingVisible, setHiddenThinkingLabel, pasteToEditor,
 *   getEditorText, getEditorComponent, getToolsExpanded, setToolsExpanded
 *
 * custom() → the panel bridge (writes ANSI to main process)
 */

// ─── Dialog resolver (promise-based, one-at-a-time) ───────────────────────────

export function createDialogResolver(sendToMain) {
  // P3-b: queue outstanding dialogs by id (not a single-slot) so a second
  // dialog overlapping the first can't silently overwrite its resolver.
  // Trust resolution is serial today (init is a serial await chain), so this
  // is hardening — but the single-slot was a latent hang if pi ever issues
  // concurrent selects. The id comes from createDialog's `${method}_${Date.now()}`
  // and is echoed back inside the ExtensionUiResponse (response.id), so resolve
  // matches the right promise regardless of completion order.
  /** @type {Map<string, { resolve: (r: unknown) => void }>} */
  const pending = new Map();

  const resolve = (response) => {
    const id = response?.id;
    // Match by id; fall back to the single in-flight dialog if absent (defensive).
    const d = id ? pending.get(id) : pending.size ? [...pending.values()][0] : null;
    if (!d) return;
    if (id) pending.delete(id);
    else pending.clear();
    d.resolve(response);
  };

  const createDialog = (method, title, { message, options, placeholder, prefill, opts } = {}) => {
    return new Promise((resolveFn) => {
      const id = `${method}_${Date.now()}`;
      pending.set(id, { resolve: resolveFn });
      sendToMain({
        type: "extension_ui_request",
        id,
        method,
        title,
        ...(message !== undefined ? { message } : {}),
        ...(options !== undefined ? { options } : {}),
        ...(placeholder !== undefined ? { placeholder } : {}),
        ...(prefill !== undefined ? { prefill } : {}),
        ...(opts?.timeout !== undefined ? { timeout: opts.timeout } : {}),
      });
    });
  };

  return { resolve, createDialog };
}

// ─── Main uiContext factory ───────────────────────────────────────────────────

/**
 * Create a full ExtensionUIContext for mode:"tui".
 *
 * @param {object} deps
 * @param {object} deps.theme - pi's theme singleton (from initHostTheme)
 * @param {object} deps.panelBridge - { openPanel, writePanel, closePanel } for custom()
 * @param {function} deps.createDialog - (method, title, opts) => Promise
 * @param {function} deps.sendToMain - sends messages to the Electron main process
 * @param {object} deps.tuiModules - { TUI, KeybindingsManager, TUI_KEYBINDINGS } from pi-tui
 */
export function createUIContext({ theme, panelBridge, createDialog, sendToMain, tuiModules }) {
  return {
    // ── Dialogs (blocking — pi-vis renders UI) ──
    //
    // createDialog resolves with the raw ExtensionUiResponse wire object
    // ({type,id,value} | {confirmed} | {cancelled}). pi's ExtensionUIContext
    // contract, however, hands extensions UNWRAPPED values — a chosen string,
    // a boolean, or undefined on cancel. Returning the raw object instead made
    // extensions that compare the result (`choice === "Settings"`,
    // `choice.startsWith(...)`) throw or silently mismatch — e.g. pi-subagents
    // `/agents → Settings` died on `choice.startsWith` before opening the menu.
    // Unwrap here so the host is indistinguishable from pi's own uiContext.
    select: async (title, options, opts) => {
      const r = await createDialog("select", title, { options, opts });
      return r?.cancelled ? undefined : r?.value;
    },
    confirm: async (title, message, opts) => {
      const r = await createDialog("confirm", title, { message, opts });
      return r?.confirmed === true; // cancel / anything else → false
    },
    input: async (title, placeholder, opts) => {
      const r = await createDialog("input", title, { placeholder, opts });
      return r?.cancelled ? undefined : r?.value;
    },
    editor: async (title, prefill) => {
      const r = await createDialog("editor", title, { prefill });
      return r?.cancelled ? undefined : r?.value;
    },

    // ── Fire-and-forget notifications ──
    notify: (message, notifyType) => {
      sendToMain({
        type: "extension_ui_request",
        method: "notify",
        message,
        notifyType,
      });
    },
    setStatus: (key, text) => {
      sendToMain({
        type: "extension_ui_request",
        method: "setStatus",
        statusKey: key,
        statusText: text,
      });
    },
    setTitle: (title) => {
      sendToMain({
        type: "extension_ui_request",
        method: "setTitle",
        title,
      });
    },
    setEditorText: (text) => {
      sendToMain({
        type: "extension_ui_request",
        method: "set_editor_text",
        text,
      });
    },

    // ── Widgets ──
    setWidget: (key, content, options) => {
      sendToMain({
        type: "extension_ui_request",
        method: "setWidget",
        widgetKey: key,
        widgetLines: Array.isArray(content) ? content : undefined,
        widgetPlacement: options?.placement,
      });
    },

    // ── Theme ──
    get theme() {
      return theme;
    },
    getAllThemes: () => [],
    getTheme: (_name) => undefined,
    setTheme: (_theme) => ({ success: false, error: "Theme switching not available in pi-vis" }),

    // ── TUI-only methods (safe no-ops) ──
    setFooter: (_factory) => {},
    setHeader: (_factory) => {},
    onTerminalInput: (_handler) => () => {},
    setWorkingMessage: (_message) => {},
    setWorkingVisible: (_visible) => {},
    setWorkingIndicator: (_options) => {},
    setHiddenThinkingLabel: (_label) => {},
    pasteToEditor: (_text) => {},
    getEditorText: () => "",
    addAutocompleteProvider: (_factory) => {},
    setEditorComponent: (_factory) => {},
    getEditorComponent: () => undefined,
    getToolsExpanded: () => false,
    setToolsExpanded: (_expanded) => {},

    // ── custom() — the panel bridge ──
    //
    // Mirrors InteractiveMode.showExtensionCustom: construct a TUI over our
    // HostTerminal, call factory(tui, theme, keybindings, done), show the
    // returned component as an overlay, and resolve with whatever `done(result)`
    // receives. pi-vis has no inline layout, so the component is ALWAYS shown as
    // an overlay (the only way to make it visible in the xterm.js panel).
    //
    // Critical correctness points (all bugs in the prior version):
    //  - tui.start() MUST be called: it wires terminal.start() → input handler
    //    (so xterm.js keystrokes reach the component) and kicks the render loop.
    //  - KeybindingsManager needs the REAL TUI_KEYBINDINGS, not {} — an empty
    //    set means Enter/Ctrl+C/arrows don't work inside the panel.
    //  - On close, tui.stop() must stop the render timer (else it keeps writing
    //    to a closed panel forever) and terminal.stop() clears the input handler.
    //  - The promise settles exactly once: `closed` guards both done() and the
    //    factory-error path (the old code could resolve via done() then reject).
    custom: async (factory, options) => {
      const isOverlay = options?.overlay ?? false;
      const panelId = panelBridge.openPanel({ overlay: isOverlay });
      const hostTerminal = createHostTerminal(panelId, panelBridge);
      const { TUI, KeybindingsManager, TUI_KEYBINDINGS } = tuiModules;
      const tui = new TUI(hostTerminal);
      const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
      // Start the TUI: wires HostTerminal.start (input handler) + begins the
      // render loop that composites overlays and writes ANSI to hostTerminal.
      tui.start();

      // Keep the TUI's layout in sync with the actual xterm.js panel size.
      // The renderer sends panel_resize whenever the FitAddon recomputes cols/rows.
      panelBridge.setResizeHandler(panelId, (cols, rows) => {
        hostTerminal.resize(cols, rows);
        tui.requestRender();
      });

      return new Promise((resolve, reject) => {
        let component = null;
        let closed = false;

        const teardown = () => {
          try {
            tui.hideOverlay();
          } catch {
            /* no overlay shown yet */
          }
          try {
            tui.stop();
          } catch {
            /* already stopped */
          }
          try {
            component?.dispose?.();
          } catch {
            /* ignore dispose errors */
          }
          panelBridge.closePanel(panelId);
        };

        const done = (result) => {
          if (closed) return;
          closed = true;
          teardown();
          resolve(result);
        };

        // Let the host force-close this panel (resolve undefined + tear down)
        // if the session is replaced while the panel is still open.
        panelBridge.setCanceller(panelId, () => done(undefined));

        Promise.resolve(factory(tui, theme, keybindings, done))
          .then((c) => {
            if (closed) return;
            component = c;
            // overlayOptions may be static or a function (dynamic sizing).
            const overlayOpts =
              typeof options?.overlayOptions === "function"
                ? options.overlayOptions()
                : (options?.overlayOptions ?? (c?.width ? { width: c.width } : {}));
            const handle = tui.showOverlay(component, overlayOpts);
            options?.onHandle?.(handle);
          })
          .catch((err) => {
            if (closed) return;
            closed = true;
            teardown();
            reject(err);
          });
      });
    },
  };
}

// ─── HostTerminal ─────────────────────────────────────────────────────────────

/**
 * Implements pi-tui's Terminal interface.
 * Writes all output to the panel (via panelBridge) for display in xterm.js.
 */
function createHostTerminal(panelId, panelBridge) {
  // Mutable dimensions — read by the TUI via the getters below and written by
  // resize(). Stored in closure scope (not `this`) so the getters always return
  // current values regardless of how the terminal is referenced.
  let cols = 80;
  let rows = 24;

  return {
    get columns() {
      return cols;
    },
    get rows() {
      return rows;
    },
    kittyProtocolActive: false,

    start(onInput, _onResize) {
      // Store input handler so panelBridge can feed keystrokes to it.
      // (_onResize — the TUI's requestRender-on-resize — is unused: pi-vis
      // drives resizes explicitly via resize(), which calls requestRender.)
      panelBridge.setInputHandler(panelId, onInput);
    },

    stop() {
      panelBridge.clearInputHandler(panelId);
    },

    drainInput(_maxMs, _idleMs) {
      return Promise.resolve();
    },

    write(data) {
      panelBridge.writePanel(panelId, data);
    },

    // Called by panelBridge when the renderer reports a new xterm.js size —
    // keeps the TUI's layout in sync with the actual panel dimensions.
    resize(newCols, newRows) {
      cols = newCols;
      rows = newRows;
    },

    moveBy(_lines) {},
    // pi-tui calls hideCursor() when it shows an overlay (and our panels are
    // always overlays), and showCursor() when a component wants a visible caret
    // (e.g. a text field). The real terminal honors these by writing DECTCEM;
    // ours must too, or xterm renders its own block cursor that the TUI never
    // shows. Emit the escape so xterm matches the TUI.
    hideCursor() {
      panelBridge.writePanel(panelId, "\x1b[?25l");
    },
    showCursor() {
      panelBridge.writePanel(panelId, "\x1b[?25h");
    },
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle(_title) {},
    setProgress(_active) {},
  };
}
