import { BUNDLED_THEMES, PI_BG_ROLES, PI_ROLES, buildPiThemeColors } from "@shared/theme";
import { describe, expect, it } from "vitest";
import { buildXtermTheme } from "./xterm.js";

const mocha = BUNDLED_THEMES.find((t) => t.id === "mocha")!;
const gruvbox = BUNDLED_THEMES.find((t) => t.id === "gruvbox-material-dark")!;

describe("buildXtermTheme — extendedAnsi (live re-theming palette)", () => {
  it("packs one entry per pi role, in PI_ROLES order (extendedAnsi[0] === index 16)", () => {
    const theme = buildXtermTheme(mocha);
    const ext = theme.extendedAnsi as string[];
    expect(Array.isArray(ext)).toBe(true);
    expect(ext.length).toBe(PI_ROLES.length);
  });

  it("each entry equals the active scheme's resolved hex for that role", () => {
    const { fgColors, bgColors } = buildPiThemeColors(mocha);
    const ext = buildXtermTheme(mocha).extendedAnsi as string[];
    PI_ROLES.forEach((role, i) => {
      const expected = PI_BG_ROLES.has(role) ? bgColors[role] : fgColors[role];
      expect(ext[i], `${role} (index ${16 + i})`).toBe(expected);
    });
  });

  it("the SAME index resolves to a DIFFERENT hex per scheme (renderer is color truth)", () => {
    // The host emits a fixed index; the renderer resolves it differently per
    // scheme. Index 16 (accent) must resolve to each scheme's own accent.
    const mochaExt = buildXtermTheme(mocha).extendedAnsi as string[];
    const gruvExt = buildXtermTheme(gruvbox).extendedAnsi as string[];
    expect(mochaExt[0]).toBe(mocha.colors.accent);
    expect(gruvExt[0]).toBe(gruvbox.colors.accent);
    expect(mochaExt[0]).not.toBe(gruvExt[0]);
  });

  it("still maps the 16 named ANSI slots from the semantic roles", () => {
    const theme = buildXtermTheme(mocha);
    expect(theme.green).toBe(mocha.colors.success);
    expect(theme.red).toBe(mocha.colors.danger);
    expect(theme.background).toBe(mocha.colors.bg);
  });
});
