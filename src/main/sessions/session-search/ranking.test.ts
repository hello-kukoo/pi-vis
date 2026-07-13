import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./query-parser.js";
import {
  boundCandidates,
  boundedEditDistance,
  findTypoAlternatives,
  rankSearchCandidates,
} from "./ranking.js";

const candidate = (
  id: string,
  overrides: Partial<{
    role:
      | "session-name"
      | "user"
      | "assistant"
      | "error"
      | "custom-message"
      | "compaction-summary"
      | "branch-summary";
    normalizedText: string;
    derivedComponents: string[];
    fileOrdinal: number;
    pinned: boolean;
    neighboringTermCount: number;
  }> = {},
) => ({
  id,
  sessionId: "s",
  role: "assistant" as const,
  normalizedText: "",
  fileOrdinal: 1,
  ...overrides,
});

describe("ranking", () => {
  it("keeps old exact evidence above recent weak derived evidence", () => {
    const results = rankSearchCandidates(
      [
        candidate("weak", {
          normalizedText: "unrelated",
          derivedComponents: ["lifecycle"],
          fileOrdinal: 9999999,
        }),
        candidate("exact", { role: "user", normalizedText: "fix lifecycle now", fileOrdinal: 1 }),
      ],
      parseSearchQuery("lifecycle"),
    );
    expect(results.map((item) => item.segment.id)).toEqual(["exact", "weak"]);
  });

  it("supports final prefix and identifier components", () => {
    const results = rankSearchCandidates(
      [
        candidate("code", {
          normalizedText: "opensessiontab",
          derivedComponents: ["open", "session", "tab"],
        }),
      ],
      parseSearchQuery("sess"),
    );
    expect(results[0]?.segment.id).toBe("code");
  });

  it("uses conservative typo matching and never corrects code syntax", () => {
    expect(boundedEditDistance("lifecycle", "lifecyle", 2)).toBe(1);
    expect(findTypoAlternatives("lifecyle", ["lifecycle", "other"])).toEqual(["lifecycle"]);
    expect(findTypoAlternatives("foo.ts", ["food.ts"])).toEqual([]);
    const results = rankSearchCandidates(
      [candidate("typo", { normalizedText: "lifecycle" })],
      parseSearchQuery("lifecyle"),
    );
    expect(results[0]?.closeMatchTerms).toEqual(["lifecyle"]);
  });

  it("bounds expensive candidate stages", () => {
    expect(boundCandidates([1, 2, 3], 2)).toEqual([1, 2]);
  });
});
