/**
 * Bridge from this app's semantic palette to pi's OWN theme vocabulary.
 *
 * WHY THIS EXISTS
 * ───────────────
 * pi's TUI/extension surfaces (`ctx.ui.theme.fg(role)`, the unified-TUI render,
 * `custom()` panels) speak a DIFFERENT color vocabulary than this app — ~50
 * roles (`muted`, `dim`, `borderMuted`, `syntaxKeyword`, `mdHeading`, …) — and
 * pi ships only two built-in themes (`dark`/`light`). Left alone, every such
 * surface resolves to pi's generic dark/light palette regardless of the active
 * pi-vis colorscheme, so e.g. extension widget text reads in Mocha-ish grays on
 * a Macchiato or Gruvbox surface. That mismatch was previously documented as an
 * "accepted fidelity limit."
 *
 * In SDK mode the host constructs a pi `Theme` from THIS app's resolved palette
 * (the hex values of the 26 semantic roles) and installs it as pi's active theme
 * singleton, so `theme.fg(role)` emits the active colorscheme's exact RGB for
 * ANY theme. `buildPiThemeColors(theme)` produces the `{fgColors, bgColors}`
 * hex maps the host passes to `new pi.Theme(...)`:
 *
 *  - Each pi role resolves from the theme's optional `piTheme` block if present
 *    (a hex literal `#…` OR a token NAME resolved against the theme's own
 *    palette — per-theme authoring, nothing Catppuccin-anchored).
 *  - Otherwise it falls back to `PI_THEME_DEFAULTS`: a palette-agnostic mapping
 *    from each pi role to one of the 26 semantic tokens. Because the fallback is
 *    token-based (never a swatch name), a theme with NO `piTheme` block still
 *    renders coherently on pi's surfaces for every palette — Gruvbox's syntax
 *    comes out Gruvbox-flavored via its own `accent`/`success`/`warning`.
 *
 * The output is ALWAYS a valid 6-digit hex per role (token-refs that fail to
 * resolve cascade through the default then `text`), so pi's `Theme` constructor
 * (`fgAnsi`) can never throw on a malformed value — and the host wraps the whole
 * install in try/catch anyway, falling back to pi's base theme on any failure.
 */

import type { ColorToken, Theme, ThemeColors } from "./tokens.js";

/**
 * The complete set of color roles pi's theme defines (mirrors pi's
 * ThemeJsonSchema). The host must provide a value for EVERY role or
 * `theme.fg(role)` throws "Unknown theme color" the first time an extension or
 * pi-tui renderer asks for a missing one — hence the exhaustive list.
 */
export const PI_ROLES = [
  // ── Core UI ──────────────────────────────────────────────────────────
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  // ── Backgrounds & content text ───────────────────────────────────────
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  // ── Markdown ─────────────────────────────────────────────────────────
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  // ── Tool diffs ───────────────────────────────────────────────────────
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  // ── Syntax highlighting ──────────────────────────────────────────────
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  // ── Thinking-level borders (a perceptible ramp) ─────────────────────
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  // ── Bash mode ────────────────────────────────────────────────────────
  "bashMode",
] as const;

/**
 * pi roles that are BACKGROUNDS (the rest are foregrounds). Mirrors pi's own
 * `createTheme` split — the `Theme` constructor takes separate fg/bg maps and
 * emits `\x1b[48;…m` vs `\x1b[38;…m` accordingly.
 */
export const PI_BG_ROLES = new Set<string>([
  "selectedBg",
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
]);

/**
 * Default mapping: pi role → pi-vis semantic token. PALETTE-AGNOSTIC — it never
 * names a swatch, only semantic roles, so it produces coherent results on every
 * colorscheme (Gruvbox's `syntaxKeyword`→`accent` is Gruvbox's mauve-analog,
 * not Catppuccin's). A theme may override any role via its `piTheme` block;
 * this is only the fallback for roles it leaves to the default.
 *
 * The syntax defaults deliberately mirror the conventions both Catppuccin and
 * Gruvbox ship (mauve/accent keywords, green strings, peach/yellow numbers,
 * blue functions, faint comments), so even with no per-theme `piTheme` block
 * the unified-TUI code surface reads as that palette's native syntax coloring.
 */
export const PI_THEME_DEFAULTS: Record<string, ColorToken> = {
  // Core UI
  accent: "accent",
  border: "surface",
  borderAccent: "accent",
  borderMuted: "surface-2",
  success: "success",
  error: "danger",
  warning: "warning",
  muted: "text-muted",
  dim: "text-faint",
  text: "text",
  thinkingText: "text-secondary",
  // Backgrounds & content text
  selectedBg: "surface-2",
  userMessageBg: "surface",
  userMessageText: "text",
  customMessageBg: "surface",
  customMessageText: "text",
  customMessageLabel: "info",
  toolPendingBg: "surface-2",
  toolSuccessBg: "surface",
  toolErrorBg: "surface",
  toolTitle: "text",
  toolOutput: "text-muted",
  // Markdown
  mdHeading: "text",
  mdLink: "info",
  mdLinkUrl: "text-muted",
  mdCode: "cyan",
  mdCodeBlock: "text",
  mdCodeBlockBorder: "surface-2",
  mdQuote: "text-muted",
  mdQuoteBorder: "accent",
  mdHr: "surface-2",
  mdListBullet: "text-muted",
  // Tool diffs
  toolDiffAdded: "success",
  toolDiffRemoved: "danger",
  toolDiffContext: "text-muted",
  // Syntax
  syntaxComment: "text-faint",
  syntaxKeyword: "accent",
  syntaxFunction: "info",
  syntaxVariable: "text",
  syntaxString: "success",
  syntaxNumber: "warning",
  syntaxType: "info-soft",
  syntaxOperator: "text-muted",
  syntaxPunctuation: "text-muted",
  // Thinking-level borders — a ramp across the palette's accent family so each
  // level is visually distinct.
  thinkingOff: "text-faint",
  thinkingMinimal: "text-disabled",
  thinkingLow: "cyan",
  thinkingMedium: "info",
  thinkingHigh: "accent",
  thinkingXhigh: "magenta",
  // Bash mode
  bashMode: "warning",
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize a 3- or 6-digit hex to a lowercased 6-digit hex, or null. */
function normalizeHex(value: string): string | null {
  const m = HEX_RE.exec(value);
  if (!m) return null;
  const h = m[1]!;
  if (h.length === 6) return `#${h.toLowerCase()}`;
  const expanded = Array.from(h, (c) => c + c).join("");
  return `#${expanded.toLowerCase()}`;
}

/**
 * Resolve one pi role to a valid 6-digit hex against a theme's palette.
 *
 * Cascade (first valid hex wins): the explicit value → the palette-agnostic
 * default token → `text`. A value may be a hex literal (`#…`) or a token NAME
 * (resolved through `colors`). An unknown token-ref or non-hex literal just
 * falls through to the next candidate, so a typo'd override can never crash the
 * host — it silently degrades to the default for that role.
 */
function resolveRole(value: string | undefined, role: string, colors: ThemeColors): string {
  const candidates: Array<string | undefined> = [value, PI_THEME_DEFAULTS[role], "text"];
  const palette = colors as Record<string, string>;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const hex = normalizeHex(candidate) ?? normalizeHex(palette[candidate] ?? "");
    if (hex) return hex;
  }
  // Unreachable: "text" is a required token in every theme. Keep a sane literal
  // so a degenerate theme can still never break pi's Theme constructor.
  return "#cdd6f4";
}

/**
 * Build the `{fgColors, bgColors}` hex maps (role → 6-digit hex) the SDK host
 * hands to `new pi.Theme(fgColors, bgColors, "truecolor")`. Every role in
 * {@link PI_ROLES} is present and split into fg/bg by {@link PI_BG_ROLES}.
 */
export function buildPiThemeColors(theme: Theme): {
  fgColors: Record<string, string>;
  bgColors: Record<string, string>;
} {
  const fgColors: Record<string, string> = {};
  const bgColors: Record<string, string> = {};
  const overrides = theme.piTheme;
  for (const role of PI_ROLES) {
    const hex = resolveRole(overrides?.[role], role, theme.colors);
    if (PI_BG_ROLES.has(role)) {
      bgColors[role] = hex;
    } else {
      fgColors[role] = hex;
    }
  }
  return { fgColors, bgColors };
}
