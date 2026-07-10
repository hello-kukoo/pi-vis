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
 * In SDK mode the host installs a pi `Theme` whose per-role values are STABLE
 * ANSI palette INDICES (not hex), so `theme.fg(role)` emits an indexed escape
 * like `[38;5;42m` that carries role identity rather than RGB. The renderer
 * (xterm's `extendedAnsi` palette + AnsiText's index→token map) resolves each
 * index to the active colorscheme's color AT PAINT TIME, so a scheme change
 * recolors every cell — including ones already in the buffer — with zero
 * re-emit and zero host involvement. The host is color-agnostic; the renderer
 * is the single source of color truth. `buildPiThemeColorIndices()` produces
 * the `{fg, bg}` index maps the host passes to `new pi.Theme(...)`, and
 * `buildPiThemeColors(theme)` produces the role→hex maps the renderer uses to
 * fill the palette for the active scheme:
 *
 *  - Each pi role resolves from the palette-agnostic default mapping
 *    `PI_THEME_DEFAULTS` (pi-role → one of the 26 semantic tokens, resolved
 *    against the theme's own `colors`). Because the mapping is token-based
 *    (never a swatch name), a theme renders coherently on pi's surfaces for
 *    EVERY palette — Gruvbox's syntax comes out Gruvbox-flavored via its own
 *    `accent`/`success`/`warning`.
 *
 * The output is ALWAYS a valid 6-digit hex per role (token-refs that fail to
 * resolve cascade through the default then `text`), so pi's `Theme` constructor
 * (`fgAnsi`) can never throw on a malformed value — and the host wraps the whole
 * install in try/catch anyway, falling back to pi's base theme on any failure.
 */

import type { ColorToken, Theme, ThemeColors } from "./tokens.js";

/**
 * The base of the stable per-role ANSI palette index range. xterm.js exposes
 * indices 16–255 as a customizable palette via `ITheme.extendedAnsi` (and the
 * 16 named slots 0–15 separately). We assign each pi role a FIXED index in
 * this range so the byte stream pi emits carries role IDENTITY, not RGB —
 * which is what makes live re-theming possible (see "Indexed semantic
 * colors" below).
 */
const PI_ROLE_INDEX_BASE = 16;

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
  // Appended in Pi 0.80.6 rather than inserted beside thinkingXhigh so every
  // pre-existing role keeps its stable host↔renderer ANSI index.
  "thinkingMax",
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
 * not Catppuccin's). This is the SOLE source of per-role resolution; every
 * colorscheme's pi surfaces derive from it.
 *
 * The syntax defaults deliberately mirror the conventions both Catppuccin and
 * Gruvbox ship (mauve/accent keywords, green strings, peach/yellow numbers,
 * blue functions, faint comments), so the unified-TUI code surface reads as
 * that palette's native syntax coloring.
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
  thinkingMax: "magenta",
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
 * Looks up the role's palette-agnostic DEFAULT token ({@link PI_THEME_DEFAULTS})
 * in the theme's `colors` and returns its hex. Falls back to `text` (a required
 * token in every theme), so the result is ALWAYS a valid hex and pi's `Theme`
 * constructor can never throw.
 */
function resolveRole(role: string, colors: ThemeColors): string {
  const palette = colors as Record<string, string>;
  for (const token of [PI_THEME_DEFAULTS[role], "text"]) {
    if (!token) continue;
    const hex = normalizeHex(palette[token] ?? "");
    if (hex) return hex;
  }
  // Unreachable: "text" is a required token in every theme. Keep a sane literal
  // so a degenerate theme can still never break pi's Theme constructor.
  return "#cdd6f4";
}

/**
 * Build the `{fgColors, bgColors}` hex maps (role → 6-digit hex) used by the
 * RENDERER to resolve each role's color for the current scheme (xterm's
 * `extendedAnsi` palette, filled from these hexes). Every role in
 * {@link PI_ROLES} is present and split into fg/bg by {@link PI_BG_ROLES}.
 */
export function buildPiThemeColors(theme: Theme): {
  fgColors: Record<string, string>;
  bgColors: Record<string, string>;
} {
  const fgColors: Record<string, string> = {};
  const bgColors: Record<string, string> = {};
  for (const role of PI_ROLES) {
    const hex = resolveRole(role, theme.colors);
    if (PI_BG_ROLES.has(role)) {
      bgColors[role] = hex;
    } else {
      fgColors[role] = hex;
    }
  }
  return { fgColors, bgColors };
}

/**
 * Stable pi-role → ANSI palette index assignment. Each role gets a fixed index
 * in the xterm extended range (16+), assigned once in {@link PI_ROLES} order.
 * This map is the SINGLE contract between the host (which emits these indices
 * into the byte stream) and the renderer (which resolves each index to the
 * active scheme's color at paint time). It is scheme-independent and constant
 * for the lifetime of the app.
 */
export const PI_ROLE_INDEX: Record<string, number> = Object.fromEntries(
  PI_ROLES.map((role, i) => [role, PI_ROLE_INDEX_BASE + i]),
);

/** Reverse lookup: ANSI palette index → pi role. */
export const PI_INDEX_ROLE: Map<number, string> = new Map(
  Object.entries(PI_ROLE_INDEX).map(([role, index]) => [index, role]),
);

/**
 * ANSI palette index → pi-vis semantic token (via {@link PI_THEME_DEFAULTS}),
 * precomputed for the renderer's AnsiText path. AnsiText maps each emitted
 * index to `var(--<token>)`; since CSS variables resolve live at paint, widget
 * text recolors automatically on a scheme change with no re-render. Indices
 * outside this map (e.g. an extension hardcoding its own 256-color) fall
 * through to the standard cube ramp.
 */
export const PI_INDEX_TOKEN: Map<number, ColorToken> = new Map(
  Object.entries(PI_ROLE_INDEX).map(([role, index]) => [index, PI_THEME_DEFAULTS[role] ?? "text"]),
);

/**
 * Build the `{fg, bg}` INDEX maps (role → stable palette index) the SDK host
 * hands to `new pi.Theme(...)`. Because the values are NUMBERS, pi's
 * `fgAnsi`/`bgAnsi` emits a stable `[38;5;<index>m` / `[48;5;<index>m`
 * escape that carries role identity — NOT RGB — so the byte stream is
 * color-agnostic. The scheme is applied only at the renderer, which resolves
 * these indices against the active palette. This is scheme-independent and
 * constant; the host never needs re-theming on a scheme change.
 */
export function buildPiThemeColorIndices(): {
  fg: Record<string, number>;
  bg: Record<string, number>;
} {
  const fg: Record<string, number> = {};
  const bg: Record<string, number> = {};
  for (const role of PI_ROLES) {
    const index = PI_ROLE_INDEX[role]!;
    if (PI_BG_ROLES.has(role)) {
      bg[role] = index;
    } else {
      fg[role] = index;
    }
  }
  return { fg, bg };
}
