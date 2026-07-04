import { BUNDLED_THEMES, COLOR_TOKENS, type ColorToken, ThemeSchema } from "@shared/theme";
import everforestDarkJson from "@shared/theme/themes/everforest-dark.json";
import everforestLightJson from "@shared/theme/themes/everforest-light.json";
import gruvboxLightJson from "@shared/theme/themes/gruvbox-material-light.json";
import { describe, expect, it } from "vitest";
import { getHighlighter } from "./shiki.js";

const NEW_THEME_JSON = [gruvboxLightJson, everforestDarkJson, everforestLightJson] as const;
const NEW_THEME_IDS = ["gruvbox-material-light", "everforest-dark", "everforest-light"] as const;
const TEXT_TOKENS: ColorToken[] = ["text-muted", "text-secondary", "text"];

const SOURCE_PALETTES: Record<(typeof NEW_THEME_IDS)[number], readonly string[]> = {
  "gruvbox-material-light": [
    // sainnhe/gruvbox-material: medium background + material foreground + light greys
    "#fbf1c7",
    "#f4e8be",
    "#f2e5bc",
    "#eee0b7",
    "#e5d5ad",
    "#ddccab",
    "#654735",
    "#4f3829",
    "#c14a4a",
    "#c35e0a",
    "#b47109",
    "#6c782e",
    "#4c7a5d",
    "#45707a",
    "#945e80",
    "#a89984",
    "#928374",
    "#7c6f64",
  ],
  "everforest-dark": [
    // sainnhe/everforest: medium dark background + foreground palette
    "#232a2e",
    "#2d353b",
    "#343f44",
    "#3d484d",
    "#475258",
    "#4f585e",
    "#56635f",
    "#543a48",
    "#514045",
    "#4d4c43",
    "#425047",
    "#3a515d",
    "#4a444e",
    "#d3c6aa",
    "#e67e80",
    "#e69875",
    "#dbbc7f",
    "#a7c080",
    "#83c092",
    "#7fbbb3",
    "#d699b6",
    "#7a8478",
    "#859289",
    "#9da9a0",
  ],
  "everforest-light": [
    // sainnhe/everforest: medium light background + foreground palette
    "#efebd4",
    "#fdf6e3",
    "#f4f0d9",
    "#e6e2cc",
    "#e0dcc7",
    "#bdc3af",
    "#eaedc8",
    "#fde3da",
    "#faedcd",
    "#f0f1d2",
    "#e9f0e9",
    "#fae8e2",
    "#5c6a72",
    "#f85552",
    "#f57d26",
    "#dfa000",
    "#8da101",
    "#35a77c",
    "#3a94c5",
    "#df69ba",
    "#a6b0a0",
    "#939f91",
    "#829181",
    "#93b259",
    "#708089",
    "#e66868",
  ],
};

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function hexesIn(value: unknown): string[] {
  return (
    JSON.stringify(value)
      .match(/#[0-9a-fA-F]{6}/g)
      ?.map((h) => h.toLowerCase()) ?? []
  );
}

describe("Gruvbox Material light and Everforest bundled themes", () => {
  it("parse through ThemeSchema and are bundled", () => {
    for (const json of NEW_THEME_JSON) {
      const parsed = ThemeSchema.parse(json);
      expect(parsed.syntax).toBeDefined();
      for (const token of COLOR_TOKENS) expect(parsed.colors[token], token).toBeTruthy();
    }

    const bundledIds = BUNDLED_THEMES.map((t) => t.id);
    for (const id of NEW_THEME_IDS) expect(bundledIds).toContain(id);
  });

  it("uses only upstream palette hex values for UI and inline syntax colors", () => {
    for (const json of NEW_THEME_JSON) {
      const parsed = ThemeSchema.parse(json);
      const allowed = new Set(SOURCE_PALETTES[parsed.id as (typeof NEW_THEME_IDS)[number]]);
      for (const hex of hexesIn(parsed)) {
        expect(allowed.has(hex), `${parsed.id}:${hex}`).toBe(true);
      }
    }
  });

  it("load into Shiki and colorize code", async () => {
    const h = await getHighlighter();
    for (const id of NEW_THEME_IDS) {
      expect(h.getLoadedThemes()).toContain(id);
      const r = h.codeToTokens("const evergreen = () => 'ok';", { lang: "typescript", theme: id });
      expect(
        r.tokens.flat().some((t) => !!t.color),
        id,
      ).toBe(true);
    }
  });

  it("keeps the core text ramp readable on the transcript background", () => {
    for (const id of NEW_THEME_IDS) {
      const theme = BUNDLED_THEMES.find((t) => t.id === id)!;
      for (const role of TEXT_TOKENS) {
        expect(
          contrast(theme.colors[role], theme.colors.bg),
          `${id}:${role}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("defines explicit accent fill/on-accent pairs without inventing button colors", () => {
    for (const id of NEW_THEME_IDS) {
      const theme = BUNDLED_THEMES.find((t) => t.id === id)!;
      expect(theme.colors["accent-fill"], id).toBeTruthy();
      expect(theme.colors["on-accent"], id).toBeTruthy();
    }
  });
});
