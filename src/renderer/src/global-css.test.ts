import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("global CSS", () => {
  it("themes browser text selection with semantic accent tokens", () => {
    const css = readFileSync(join(__dirname, "global.css"), "utf8");

    expect(css).toMatch(
      /::selection\s*{[^}]*color:\s*var\(--on-accent\);[^}]*background:\s*var\(--accent-fill\);[^}]*}/s,
    );
  });
});
