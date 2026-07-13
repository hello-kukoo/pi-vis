import { describe, expect, it } from "vitest";
import { createSnippet, findOriginalMatchRanges } from "./snippet.js";

describe("snippet", () => {
  it("maps folded matches back to original source offsets", () => {
    const source = "Use ＦＯＯ now";
    expect(findOriginalMatchRanges(source, "foo")).toEqual([{ start: 4, end: 7 }]);
    expect(findOriginalMatchRanges("Cafe\u0301", "café")).toEqual([{ start: 0, end: 5 }]);
  });

  it("keeps repeated occurrences distinct and can center the second occurrence", () => {
    const source = "first needle then needle last";
    const ranges = findOriginalMatchRanges(source, "needle");
    expect(ranges).toEqual([
      { start: 6, end: 12 },
      { start: 18, end: 24 },
    ]);
    const snippet = createSnippet(source, ranges, { occurrence: 1, context: 7 });
    expect(snippet.sourceStart).toBe(11);
    expect(snippet.matchRanges).toEqual([{ start: 7, end: 13 }]);
  });
});
