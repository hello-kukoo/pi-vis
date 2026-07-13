import { describe, expect, it } from "vitest";
import { deriveSearchComponents, normalizeForSearch, normalizeText } from "./text-normalization.js";

describe("text normalization", () => {
  it("uses NFKC and locale-independent lowercase while retaining source", () => {
    expect(normalizeText("ＦＯＯ Café")).toBe("foo café");
    expect(normalizeForSearch("ＦＯＯ").original).toBe("ＦＯＯ");
  });

  it("derives camel, snake, path, dotted, and hyphen components", () => {
    expect(
      deriveSearchComponents("openSessionTab src/foo-bar.ts user_name.api src/sessionRegistry.ts"),
    ).toEqual(
      expect.arrayContaining([
        "opensessiontab",
        "open",
        "session",
        "registry",
        "tab",
        "src",
        "foo",
        "bar",
        "ts",
        "user",
        "name",
        "api",
      ]),
    );
  });
});
