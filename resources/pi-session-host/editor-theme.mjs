/**
 * editor-theme — reconstruct pi's getEditorTheme() from pi's PUBLIC surface.
 *
 * pi-tui's base `Editor` (components/editor.js) requires an **EditorTheme**:
 *
 *   interface EditorTheme {
 *     borderColor: (str: string) => string;
 *     selectList: SelectListTheme;
 *   }
 *
 * It stores `this.borderColor = theme.borderColor` in its constructor and calls
 * `this.borderColor("─")` on every render. pi's full Theme instance (returned
 * by `initTheme()` / read by extensions as `ctx.ui.theme`) is NOT an
 * EditorTheme — it has `fg(name, text)` but no `borderColor` function. Passing
 * the full Theme makes `Editor.render()` throw `this.borderColor is not a
 * function` on the FIRST render tick, so the unified-TUI panel opens (replacing
 * the Composer) but never paints — and the throw inside pi-tui's render timer
 * can crash the host process, leaving the renderer with a disabled Composer and
 * a dead panel. That was the original "fleet view disables the composer and
 * nothing else happens" bug.
 *
 * pi builds the right object via its own (non-exported) getEditorTheme():
 *   { borderColor: (t) => theme.fg("borderMuted", t), selectList: getSelectListTheme() }
 * We reconstruct it from the PUBLIC surface (`theme.fg` + the exported
 * `getSelectListTheme`) so the host stays free of private pi imports
 * (host-imports.test.ts).
 *
 * @param {object} pi    - pi's public module (from importPi); used for getSelectListTheme.
 * @param {object} theme - pi's local Theme instance (from initHostTheme); used for fg.
 * @returns {{ borderColor: (s: string) => string, selectList: unknown }}
 */
export function buildEditorTheme(pi, theme) {
  // Degrade gracefully: a pi too old to export getSelectListTheme, or a theme
  // without fg(), yields a working unstyled editor rather than a crash. The
  // load-bearing invariant is only that borderColor is a FUNCTION.
  const borderColor =
    typeof theme?.fg === "function" ? (t) => theme.fg("borderMuted", t) : (t) => t;
  let selectList;
  try {
    selectList = pi?.getSelectListTheme?.();
  } catch {
    selectList = undefined;
  }
  return { borderColor, selectList };
}
