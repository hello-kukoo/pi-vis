import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./query-parser.js";

describe("parseSearchQuery", () => {
  it("folds terms, preserves quoted phrases, and prefixes only final plain text", () => {
    expect(parseSearchQuery('Fix "Exact Phrase" Lifecy')).toMatchObject({
      terms: [
        { text: "fix", quoted: false, prefix: false },
        { text: "exact phrase", quoted: true, prefix: false },
        { text: "lifecy", quoted: false, prefix: true },
      ],
    });
  });

  it("does not treat operators as query language", () => {
    expect(parseSearchQuery("OR -ignored").terms.map((term) => term.text)).toEqual([
      "or",
      "-ignored",
    ]);
  });
});
