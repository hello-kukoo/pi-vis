import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard: the pi-session-host must depend ONLY on pi's public surface.
 *
 * The host imports the user's INSTALLED pi via three allowlisted targets:
 *   - pi's public entry: `dist/index.js`
 *   - public pi-tui:      `@earendil-works/pi-tui/dist/index.js`
 *   - bundled undici:     `undici/index.js`
 *
 * It must NOT deep-import pi internals (`dist/core/**`, `dist/modes/**`, etc.).
 * Such imports are the fragility the architecture was designed to avoid: they
 * break without warning on pi's frequent releases. This test fails the build
 * if any host file reaches into a private path, so the constraint can't
 * silently regress (e.g. the theme singleton that used to be deep-imported).
 */
describe("pi-session-host import discipline", () => {
  const hostDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "resources",
    "pi-session-host",
  );
  const files = ["host.mjs", "bootstrap.mjs", "ui-context.mjs", "bridge.mjs"];

  // Private pi paths the host must never reference.
  const forbidden = [
    /dist\/core\//,
    /dist\/modes\//,
    /\/core\/extensions/,
    /interactive\/theme/,
    /Symbol\.for\([^)]*theme/i,
    /globalThis\[[^\]]*theme/i,
  ];

  for (const file of files) {
    it(`${file} references no private pi paths`, () => {
      const src = readFileSync(path.join(hostDir, file), "utf8");
      for (const pattern of forbidden) {
        expect(src, `${file} must not reference ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});
