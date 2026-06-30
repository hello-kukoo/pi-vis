import { z } from "zod";

/**
 * The semantic color vocabulary every theme speaks.
 *
 * This is the load-bearing contract of the theming system: a theme is a flat
 * map from these role names to color strings. The app NEVER references a
 * palette-specific swatch name (the old `--ctp-mauve`, `--ctp-surface0`, …);
 * every component reaches for a role here, exposed as a `--<token>` CSS custom
 * property (e.g. `--accent`, `--surface`, `--danger`). A new colorscheme is
 * therefore a single file that fills in these roles — nothing Catppuccin-,
 * Gruvbox-, or otherwise palette-specific leaks into the components.
 *
 * The roles are grouped into four ramps so a theme author can reason about
 * them as ramps, not 26 unrelated colors:
 *
 *  - **Backgrounds** — the page planes, deepest → base.
 *  - **Surfaces** — raised planes (cards, pills, borders), low → high.
 *  - **Text** — the foreground emphasis ramp, faintest → strongest.
 *  - **Accents / status** — the functional + decorative accent colors, plus
 *    the terminal-cursor and the three non-color UI knobs (shadow/scrim/input).
 *
 * Order is irrelevant to correctness but kept brightness-ordered within each
 * ramp for readability.
 */
export const COLOR_TOKENS = [
  // ── Backgrounds (page planes) ──────────────────────────────────────────
  "bg-deep", // deepest well (was crust)
  "bg-sunken", // sidebar + titlebar + inset wells (was mantle). A theme places
  //              this lighter or darker than `bg` to set the sidebar/transcript
  //              relationship (Catppuccin: darker; Gruvbox: lighter).
  "bg", // app/transcript background (was base)

  // ── Surfaces (raised planes) ───────────────────────────────────────────
  "surface", // raised panels, cards, pills, resting borders (was surface0)
  "surface-2", // hover, structural borders, scrollbar thumb (was surface1)
  "surface-3", // strongest surface, selection bg (was surface2)

  // ── Text (foreground emphasis ramp, faint → strong) ────────────────────
  "text-ghost", // faintest UI hints (was overlay0)
  "text-faint", // faint labels (was overlay1)
  "text-disabled", // disabled / decorative dim (was overlay2)
  "text-muted", // secondary content — the workhorse "muted" (was subtext0)
  "text-secondary", // slightly de-emphasized body (was subtext1)
  "text", // primary text (was text)

  // ── Accents / status ───────────────────────────────────────────────────
  "accent", // primary brand accent (was mauve)
  "accent-soft", // soft accent: primary-action button fills (was lavender)
  "success", // positive / diff-add (was green)
  "warning", // caution (was yellow)
  "warning-soft", // attention / modified marker (was peach)
  "danger", // error / diff-del (was red)
  "info", // links, user accent (was blue)
  "info-soft", // secondary informational accent (was sapphire)
  "cyan", // terminal cyan + cyan-ish accent (was teal)
  "magenta", // terminal magenta (was pink)

  // ── Misc UI ────────────────────────────────────────────────────────────
  "cursor", // terminal caret (was rosewater)
  "shadow", // drop-shadow color, tuned per theme luminance
  "scrim", // modal backdrop, tuned per theme luminance
  "input-bg", // composer text-field background
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** A theme's color map: every semantic role → a CSS color string. */
export type ThemeColors = Record<ColorToken, string>;

// Build the Zod object shape from COLOR_TOKENS so the schema can never drift
// from the canonical list. Each token is a non-empty string (any CSS color
// form: hex, rgb(), rgba(), etc.).
const colorsShape = Object.fromEntries(COLOR_TOKENS.map((t) => [t, z.string().min(1)])) as Record<
  ColorToken,
  z.ZodString
>;

export const ThemeColorsSchema = z.object(colorsShape).strict();

/**
 * How a theme drives the syntax highlighter (Shiki) and, by extension, the
 * pi-tui code surfaces. Optionality between the two routes (the user's ask):
 *
 *  - `{ ref }`     — reuse a Shiki-bundled TextMate theme by name
 *                    (e.g. "catppuccin-mocha", "nord"). NOTE: only names that
 *                    actually ship with Shiki resolve at runtime; the Gruvbox
 *                    theme ships an `inline` grammar because no Gruvbox theme
 *                    is bundled with Shiki.
 *  - `{ inline }`  — ship a full TextMate theme object inline.
 *
 * `inline` is intentionally loosely typed (`record(unknown)`): it's a TextMate
 * theme blob handed straight to Shiki's `loadTheme`, which does its own
 * validation. We only guarantee it's an object with a `name`.
 */
export const SyntaxSpecSchema = z.union([
  z.object({ ref: z.string().min(1) }).strict(),
  z.object({ inline: z.record(z.string(), z.unknown()).and(z.object({ name: z.string() })) }),
]);

export type SyntaxSpec = z.infer<typeof SyntaxSpecSchema>;

/**
 * A complete theme. This is exactly the on-disk format for user-droppable
 * theme files (`<userData>/themes/<id>.json`) and the in-repo bundled themes.
 *
 *  - `id`         — stable key persisted in settings.colorScheme; filename stem
 *                   for user themes. Lowercase kebab.
 *  - `name`       — human label shown in the settings picker.
 *  - `appearance` — "dark" | "light"; drives the pi-tui/extension light/dark
 *                   mapping (pi ships only those two), the same role the old
 *                   `piThemeForColorScheme` luminance check served.
 *  - `colors`     — the semantic role map.
 *  - `syntax`     — Shiki theme (ref or inline).
 *  - `piTheme`    — OPTIONAL per-theme overrides for pi's OWN theme vocabulary.
 *                   pi's TUI/extension surfaces speak a DIFFERENT color
 *                   vocabulary than this app (~50 roles: `muted`, `dim`,
 *                   `borderMuted`, `syntaxKeyword`, `mdHeading`, …) and pi
 *                   ships only two built-in themes (`dark`/`light`), so by
 *                   default those surfaces can't track a specific pi-vis
 *                   colorscheme. The SDK host builds a pi `Theme` from this
 *                   app's palette (see shared/theme/pi-theme.ts): each pi role
 *                   resolves to either a hex literal or a token NAME (one of
 *                   the 26 roles above, resolved against THIS theme's palette)
 *                   from `piTheme`, falling back to a palette-agnostic default
 *                   mapping for any role not listed. Because the defaults are
 *                   token-based (not swatch-based), a theme with no `piTheme`
 *                   block still renders coherently on pi's surfaces for ANY
 *                   palette — Gruvbox gets Gruvbox-flavored syntax via its own
 *                   `accent`/`success`/`warning`, Catppuccin gets mauve/green.
 *                   A `piTheme` block lets a theme author fine-tune the roles
 *                   that genuinely vary (syntax/markdown/thinking) per palette.
 */
export const ThemeSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be lowercase kebab-case"),
  name: z.string().min(1),
  appearance: z.enum(["dark", "light"]),
  colors: ThemeColorsSchema,
  syntax: SyntaxSpecSchema,
  piTheme: z.record(z.string(), z.string().min(1)).optional(),
});

export type Theme = z.infer<typeof ThemeSchema>;
