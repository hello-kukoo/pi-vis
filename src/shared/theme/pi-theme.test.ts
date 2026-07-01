import { describe, expect, it } from "vitest";
import { BUNDLED_THEMES } from "./index.js";
import {
  PI_BG_ROLES,
  PI_INDEX_ROLE,
  PI_INDEX_TOKEN,
  PI_ROLE_INDEX,
  PI_ROLES,
  PI_THEME_DEFAULTS,
  buildPiThemeColorIndices,
  buildPiThemeColors,
} from "./pi-theme.js";

const mocha = BUNDLED_THEMES.find((t) => t.id === "mocha")!;
const gruvbox = BUNDLED_THEMES.find((t) => t.id === "gruvbox-material-dark")!;

describe("buildPiThemeColors — completeness & split", () => {
  const { fgColors, bgColors } = buildPiThemeColors(mocha);

  it("provides a hex for EVERY pi role (no role may be missing)", () => {
    for (const role of PI_ROLES) {
      expect(fgColors[role] ?? bgColors[role], `${role} must be present`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("splits fg/bg exactly like pi's createTheme (6 bg roles, rest fg)", () => {
    expect(Object.keys(bgColors).sort()).toEqual([...PI_BG_ROLES].sort());
    const fgRoles = PI_ROLES.filter((r) => !PI_BG_ROLES.has(r));
    expect(Object.keys(fgColors).sort()).toEqual(fgRoles.sort());
    // no overlap
    for (const r of Object.keys(fgColors)) expect(bgColors[r]).toBeUndefined();
  });
});

describe("buildPiThemeColors — palette-agnostic defaults", () => {
  it("resolves roles through the ACTIVE theme's palette (mocha)", () => {
    const { fgColors } = buildPiThemeColors(mocha);
    expect(fgColors.text).toBe(mocha.colors.text);
    expect(fgColors.error).toBe(mocha.colors.danger); // pi error → pi-vis danger
    expect(fgColors.syntaxKeyword).toBe(mocha.colors.accent);
    expect(fgColors.syntaxString).toBe(mocha.colors.success);
  });

  it("resolves the SAME roles through Gruvbox's palette (not Catppuccin)", () => {
    const { fgColors } = buildPiThemeColors(gruvbox);
    expect(fgColors.text).toBe(gruvbox.colors.text);
    expect(fgColors.error).toBe(gruvbox.colors.danger);
    expect(fgColors.syntaxKeyword).toBe(gruvbox.colors.accent);
    // Crucially: Gruvbox's syntaxKeyword is Gruvbox's accent, NOT Mocha's mauve.
    expect(fgColors.syntaxKeyword).not.toBe(mocha.colors.accent);
  });
});

describe("buildPiThemeColorIndices — stable index contract (live re-theming)", () => {
  it("assigns every role a unique index in the xterm extended range (16+)", () => {
    const indices = Object.values(PI_ROLE_INDEX);
    for (const role of PI_ROLES) {
      const idx = PI_ROLE_INDEX[role];
      expect(idx, `${role} needs an index`).toBeGreaterThanOrEqual(16);
      expect(idx, `${role} must stay < 256`).toBeLessThan(256);
    }
    // Uniqueness: two roles must NEVER share an index (or the renderer would
    // be unable to color them distinctly).
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("is scheme-INDEPENDENT and constant (the host is color-agnostic)", () => {
    const a = buildPiThemeColorIndices();
    const b = buildPiThemeColorIndices();
    expect(a).toEqual(b);
    // Same values regardless of any theme input (indices, not derived colors).
    expect(a.fg.text).toEqual(b.fg.text);
  });

  it("splits fg/bg exactly like the hex builder (6 bg roles, rest fg)", () => {
    const { fg, bg } = buildPiThemeColorIndices();
    expect(Object.keys(bg).sort()).toEqual([...PI_BG_ROLES].sort());
    const fgRoles = PI_ROLES.filter((r) => !PI_BG_ROLES.has(r));
    expect(Object.keys(fg).sort()).toEqual(fgRoles.sort());
    for (const r of Object.keys(fg)) expect(bg[r]).toBeUndefined();
    for (const r of Object.keys(bg)) expect(fg[r]).toBeUndefined();
  });

  it("every index value is a NUMBER (so pi's fgAnsi emits \u001b[38;5;N m, never RGB)", () => {
    const { fg, bg } = buildPiThemeColorIndices();
    for (const v of [...Object.values(fg), ...Object.values(bg)]) {
      expect(typeof v).toBe("number");
    }
  });

  it("PI_INDEX_ROLE / PI_INDEX_TOKEN round-trip every role", () => {
    for (const role of PI_ROLES) {
      const idx = PI_ROLE_INDEX[role]!;
      expect(PI_INDEX_ROLE.get(idx)).toBe(role);
      expect(PI_INDEX_TOKEN.get(idx)).toBe(PI_THEME_DEFAULTS[role] ?? "text");
    }
  });

  it("index 16+i maps to PI_ROLES[i] (extendedAnsi[i] alignment with buildXtermTheme)", () => {
    // buildXtermTheme packs extendedAnsi in PI_ROLES order starting at index 16;
    // this invariant is what lets xterm resolve an emitted \u001b[38;5;N m to the
    // active scheme's color for the role at position N-16.
    PI_ROLES.forEach((role, i) => {
      expect(PI_ROLE_INDEX[role]).toBe(16 + i);
    });
  });
});
