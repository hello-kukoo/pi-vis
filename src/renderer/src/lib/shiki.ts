import { type Highlighter, createHighlighter } from "shiki";

let highlighter: Highlighter | null = null;
let initPromise: Promise<Highlighter> | null = null;

// Active Shiki theme. Defaults to Mocha so SSR / preview-stub paths
// (no settings store yet) still tokenize. settings-store calls
// setShikiScheme on load + update.
let currentTheme = "catppuccin-mocha";

export async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  if (initPromise) return initPromise;

  initPromise = createHighlighter({
    themes: ["catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"],
    langs: [
      "typescript",
      "javascript",
      "tsx",
      "jsx",
      "python",
      "rust",
      "go",
      "bash",
      "sh",
      "json",
      "yaml",
      "markdown",
      "css",
      "html",
      "sql",
      "diff",
    ],
  });

  highlighter = await initPromise;
  return highlighter;
}

/** Set the active Shiki theme to match the chosen Catppuccin flavor. */
export function setShikiScheme(scheme: "latte" | "frappe" | "macchiato" | "mocha"): void {
  currentTheme = `catppuccin-${scheme}`;
}

/** Get the current Shiki theme name (used by diff highlighting). */
export function getShikiTheme(): string {
  return currentTheme;
}

export function highlightCode(code: string, lang: string): string {
  if (!highlighter) return "";
  try {
    return highlighter.codeToHtml(code, {
      lang,
      theme: getShikiTheme(),
    });
  } catch {
    // Fallback for unknown languages
    try {
      return highlighter.codeToHtml(code, { lang: "text", theme: getShikiTheme() });
    } catch {
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
