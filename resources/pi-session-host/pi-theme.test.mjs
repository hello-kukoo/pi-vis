/**
 * Host-side pi-theme install — the regression gate for "widget/TUI text uses
 * pi-vis's exact palette, not pi's generic dark/light."
 *
 * The palette→hex resolution (`buildPiThemeColors`) is unit-tested in TS
 * (src/shared/theme/pi-theme.test.ts) without pi. THIS test is the layer that
 * TS can't reach: it drives the REAL public `new pi.Theme(...)` constructor and
 * the symbol-global install (`applyPiVisTheme`), then asserts the installed
 * theme's `fg(role)` emits the EXACT truecolor escape for the hex we passed —
 * i.e. the host's install actually re-points pi's theme singleton at pi-vis's
 * palette. It needs a real pi install and SKIPS (like the PI_E2E gate) when pi
 * can't be resolved, so it never fails CI on a pi-less runner.
 */
import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyPiVisTheme, importPi, initHostTheme } from "./bootstrap.mjs";

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

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

// Run/serialize helper: vitest's describe.skip is evaluated at collection time,
// so gate the whole suite on the resolved PI_BIN.
const suite = PI_BIN ? describe : describe.skip;

suite("applyPiVisTheme (real pi)", () => {
  let pi;
  it("imports pi", async () => {
    pi = await importPi(PI_BIN);
    expect(typeof pi.Theme).toBe("function");
  });

  it("installs a pi-vis-palette Theme as the active singleton", async () => {
    pi = pi ?? (await importPi(PI_BIN));
    // Populate the global with a valid base theme first (as host.mjs does).
    initHostTheme(pi, "dark");

    const fg = { text: "#abcdef", error: "#112233" };
    const installed = applyPiVisTheme(pi, fg, {});
    expect(installed).toBe(globalThis[THEME_KEY]);
    expect(globalThis[THEME_KEY_OLD]).toBe(installed);
  });

  it("emits the EXACT truecolor escape for the installed palette hex", async () => {
    pi = pi ?? (await importPi(PI_BIN));
    initHostTheme(pi, "dark");
    applyPiVisTheme(pi, { text: "#abcdef", error: "#112233" }, {});

    // #abcdef → rgb(171,205,239); #112233 → rgb(17,34,51)
    const theme = globalThis[THEME_KEY];
    expect(theme.fg("text", "X")).toContain("\x1b[38;2;171;205;239m");
    expect(theme.fg("error", "Y")).toContain("\x1b[38;2;17;34;51m");
    expect(theme.getColorMode()).toBe("truecolor");
  });
});
