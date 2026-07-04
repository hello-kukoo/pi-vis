import { BUNDLED_THEMES, COLOR_TOKENS, type ColorToken, ThemeSchema } from "@shared/theme";
import glowSticksJson from "@shared/theme/themes/glow-sticks.json";
import { describe, expect, it } from "vitest";
import { getHighlighter } from "./shiki.js";

// WCAG 2.x relative luminance + contrast ratio, used to lock the theme's
// design contract: Glow Sticks targets OLED panels, so its accessibility story
// is computed against literal black rather than eyeballed.
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

const glowSticks = ThemeSchema.parse(glowSticksJson);

describe("glow-sticks theme is valid + loadable", () => {
  it("parses through ThemeSchema", () => {
    expect(glowSticks.id).toBe("glow-sticks");
    expect(glowSticks.appearance).toBe("dark");
  });

  it("is present in BUNDLED_THEMES", () => {
    expect(BUNDLED_THEMES.map((t) => t.id)).toContain("glow-sticks");
  });

  it("loads into the highlighter and colorizes code", async () => {
    const h = await getHighlighter();
    expect(h.getLoadedThemes()).toContain("glow-sticks");
    const r = h.codeToTokens("const x = 1;", { lang: "typescript", theme: "glow-sticks" });
    const flat = r.tokens.flat();
    expect(flat.some((t) => !!t.color)).toBe(true);
  });
});

describe("glow-sticks OLED design contract", () => {
  const c = glowSticks.colors;

  it("transcript background is pure black and primary text pure white", () => {
    expect(c.bg).toBe("#000000");
    expect(c["bg-deep"]).toBe("#000000");
    expect(c.text).toBe("#ffffff");
  });

  it("sidebar plane is lighter than the transcript", () => {
    expect(luminance(c["bg-sunken"])).toBeGreaterThan(luminance(c.bg));
  });

  it("every text-bearing accent meets AA (4.5:1) on the black background", () => {
    const accents: ColorToken[] = [
      "accent",
      "success",
      "warning",
      "warning-soft",
      "danger",
      "info",
      "info-soft",
      "cyan",
      "magenta",
    ];
    for (const role of accents) {
      expect(contrast(c[role], c.bg), role).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("accent-fill/accent-soft meet the 3:1 UI-component floor and carry AA on-accent text", () => {
    // Text and fills are split roles here: accent (orange-3) colors labels at
    // AA, while accent-fill (orange-4) is a dimmer plane whose light
    // on-accent text reaches AA — no single orange can do both jobs on black
    // (see the accent-fill rationale in shared/theme/tokens.ts).
    expect(c["accent-fill"]).toBeTruthy();
    expect(c["on-accent"]).toBeTruthy();
    expect(contrast(c["accent-fill"]!, c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(c["accent-soft"], c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(c["on-accent"]!, c["accent-fill"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c["on-accent"]!, c["accent-soft"])).toBeGreaterThanOrEqual(4.5);
  });

  it("workhorse muted text is AAA on black yet clearly muted vs primary text", () => {
    expect(contrast(c["text-muted"], c.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.text, c.bg) / contrast(c["text-muted"], c.bg)).toBeGreaterThan(2);
  });

  it("text-emphasis ramp is strictly ordered faint → strong", () => {
    const ramp: ColorToken[] = [
      "text-ghost",
      "text-faint",
      "text-disabled",
      "text-muted",
      "text-secondary",
      "text",
    ];
    for (let i = 1; i < ramp.length; i++) {
      expect(luminance(c[ramp[i]!])).toBeGreaterThan(luminance(c[ramp[i - 1]!]));
    }
  });

  it("remaining bg-colored text over status fills stays readable", () => {
    // The picker save button paints `color: var(--bg)` over a success fill.
    expect(contrast(c.bg, c.success)).toBeGreaterThanOrEqual(4.5);
    // Current-search-match paints `color: var(--bg-deep)` over warning-soft.
    expect(contrast(c["bg-deep"], c["warning-soft"])).toBeGreaterThanOrEqual(4.5);
  });

  it("defines every semantic token (no silent fallbacks)", () => {
    for (const token of COLOR_TOKENS) {
      expect(c[token], token).toBeTruthy();
    }
  });
});
