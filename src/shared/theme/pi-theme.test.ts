import { describe, expect, it } from "vitest";
import { BUNDLED_THEMES, type Theme, ThemeSchema } from "./index.js";
import { PI_BG_ROLES, PI_ROLES, buildPiThemeColors } from "./pi-theme.js";

const mocha = BUNDLED_THEMES.find((t) => t.id === "mocha")!;
const gruvbox = BUNDLED_THEMES.find((t) => t.id === "gruvbox-material-dark")!;

function withPiTheme(theme: Theme, piTheme: Record<string, string>): Theme {
  return ThemeSchema.parse({ ...theme, piTheme });
}

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

describe("buildPiThemeColors — per-theme overrides", () => {
  it("a hex-literal override passes straight through (6-digit)", () => {
    const t = withPiTheme(mocha, { error: "#ff0000" });
    expect(buildPiThemeColors(t).fgColors.error).toBe("#ff0000");
  });

  it("expands a 3-digit hex override to 6 digits (pi's hexToRgb needs 6)", () => {
    const t = withPiTheme(mocha, { error: "#f00" });
    expect(buildPiThemeColors(t).fgColors.error).toBe("#ff0000");
  });

  it("a token-ref override resolves against THIS theme's palette", () => {
    const t = withPiTheme(mocha, { syntaxKeyword: "info" });
    expect(buildPiThemeColors(t).fgColors.syntaxKeyword).toBe(mocha.colors.info);
  });

  it("a non-overridden role still uses the palette-agnostic default", () => {
    const t = withPiTheme(mocha, { error: "#ff0000" });
    expect(buildPiThemeColors(t).fgColors.syntaxString).toBe(mocha.colors.success);
  });

  it("an unknown token-ref degrades to the default for that role (never throws)", () => {
    const t = withPiTheme(mocha, { syntaxKeyword: "no-such-token" });
    expect(buildPiThemeColors(t).fgColors.syntaxKeyword).toBe(mocha.colors.accent);
  });

  it("a non-hex literal degrades to the default for that role", () => {
    const t = withPiTheme(mocha, { error: "not-a-color" });
    expect(buildPiThemeColors(t).fgColors.error).toBe(mocha.colors.danger);
  });
});
