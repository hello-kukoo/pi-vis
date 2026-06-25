import { describe, expect, it } from "vitest";
import { buildDiffModel } from "./diff-model.js";
import type { AnyDiffModel, DiffModel, GapState } from "./diff-model.js";
import { computeMatches, findOccurrences } from "./search.js";

function okModel(oldText: string, newText: string): { model: DiffModel; gapState: GapState[] } {
  const m: AnyDiffModel = buildDiffModel(oldText, newText);
  if (m.kind !== "ok") throw new Error("expected ok model");
  return { model: m, gapState: m.gaps.map(() => ({ top: 0, bottom: 0 })) };
}

describe("findOccurrences", () => {
  it("finds all non-overlapping occurrences in order", () => {
    expect(findOccurrences("a.b.a.b", "a", false)).toEqual([
      [0, 1],
      [4, 5],
    ]);
  });

  it("is case-insensitive by default", () => {
    expect(findOccurrences("FooBarfoo", "foo", false)).toEqual([
      [0, 3],
      [6, 9],
    ]);
  });

  it("honors case-sensitive matching", () => {
    expect(findOccurrences("FooBarfoo", "foo", true)).toEqual([[6, 9]]);
  });

  it("does not overlap repeated runs", () => {
    // "aa" in "aaaa" → [0,2] then [2,4], not [1,3].
    expect(findOccurrences("aaaa", "aa", false)).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("returns nothing for an empty query or empty text", () => {
    expect(findOccurrences("abc", "", false)).toEqual([]);
    expect(findOccurrences("", "a", false)).toEqual([]);
  });
});

describe("computeMatches", () => {
  it("matches across added, removed, and context lines with stable order", () => {
    // old: keep / remove-foo ; new: keep / add-foo
    const { model, gapState } = okModel("foo keep\nremove foo\n", "foo keep\nadd foo\n");
    const matches = computeMatches([{ path: "a.ts", model, gapState }], "foo", false);
    // Context "foo keep" (foo), del "remove foo" (foo), add "add foo" (foo).
    expect(matches.map((m) => m.side)).toEqual(["context", "old", "new"]);
    expect(matches.length).toBe(3);
    // ids are unique and stable.
    expect(new Set(matches.map((m) => m.id)).size).toBe(3);
  });

  it("orders matches by file, then row, then occurrence", () => {
    const a = okModel("xx\n", "xx\n"); // unchanged → no visible rows, no matches
    const b = okModel("zz x\n", "x zz x\n");
    const matches = computeMatches(
      [
        { path: "a.ts", model: a.model, gapState: a.gapState },
        { path: "b.ts", model: b.model, gapState: b.gapState },
      ],
      "x",
      false,
    );
    // All matches are in b.ts (a.ts is unchanged → fully collapsed gap, not scanned).
    expect(matches.every((m) => m.path === "b.ts")).toBe(true);
    // Occurrence indices within a line increase.
    const occs = matches.filter((m) => m.side === "new").map((m) => m.occ);
    expect(occs).toEqual([...occs].sort((p, q) => p - q));
  });

  it("does not scan lines hidden inside a collapsed gap", () => {
    // A large unchanged region with the needle only in the hidden middle.
    const lines = ["change-me"];
    for (let i = 0; i < 40; i++) lines.push(i === 20 ? "needle here" : `ctx ${i}`);
    const text = `${lines.join("\n")}\n`;
    const { model, gapState } = okModel(text, text.replace("change-me", "changed"));
    // The "needle here" line sits deep in the trailing gap → not visible → no match.
    const matches = computeMatches([{ path: "f.ts", model, gapState }], "needle", false);
    expect(matches).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    const { model, gapState } = okModel("a\n", "b\n");
    expect(computeMatches([{ path: "f.ts", model, gapState }], "", false)).toEqual([]);
  });
});
