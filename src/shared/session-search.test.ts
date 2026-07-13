import { describe, expect, it } from "vitest";
import {
  SEARCH_PAGE_MAX_SIZE,
  SEARCH_QUERY_MAX_LENGTH,
  SessionSearchBatchSchema,
  SessionSearchContextRequestSchema,
  SessionSearchExpandRequestSchema,
  SessionSearchOpenRequestSchema,
  SessionSearchStartRequestSchema,
} from "./session-search.js";

const searchId = "search-capability-123456";
const targetId = "target-capability-123456";

function start(overrides: Record<string, unknown> = {}): unknown {
  return {
    rendererGeneration: 1,
    clientQueryId: "client-1",
    workspacePath: "/workspace",
    query: "exact phrase",
    pageSize: 20,
    ...overrides,
  };
}

describe("session search protocol", () => {
  it("accepts a bounded start request", () => {
    expect(SessionSearchStartRequestSchema.parse(start())).toMatchObject({ pageSize: 20 });
  });

  it("rejects oversized queries, pages, and invalid generations", () => {
    expect(
      SessionSearchStartRequestSchema.safeParse(
        start({ query: "x".repeat(SEARCH_QUERY_MAX_LENGTH + 1) }),
      ).success,
    ).toBe(false);
    expect(
      SessionSearchStartRequestSchema.safeParse(start({ pageSize: SEARCH_PAGE_MAX_SIZE + 1 }))
        .success,
    ).toBe(false);
    expect(
      SessionSearchStartRequestSchema.safeParse(start({ rendererGeneration: -1 })).success,
    ).toBe(false);
  });

  it("bounds context windows and validates opaque capabilities", () => {
    expect(
      SessionSearchContextRequestSchema.safeParse({
        rendererGeneration: 1,
        searchId,
        targetId,
        indexRevision: 2,
        before: 21,
        after: 4,
      }).success,
    ).toBe(false);
    expect(
      SessionSearchOpenRequestSchema.safeParse({ rendererGeneration: 1, targetId: "short" })
        .success,
    ).toBe(false);
    expect(
      SessionSearchExpandRequestSchema.safeParse({ rendererGeneration: 1, searchId, targetId })
        .success,
    ).toBe(true);
  });

  it("rejects malformed result ranges and oversized result batches", () => {
    const result = {
      targetId,
      sessionName: "Session",
      role: "user",
      timestamp: 1,
      snippet: "hello",
      matchRanges: [{ start: 3, end: 3 }],
      branchKind: "latest-persisted-path",
      sourceRevision: "rev",
      additionalMatches: 0,
    };
    expect(
      SessionSearchBatchSchema.safeParse({
        rendererGeneration: 1,
        clientQueryId: "client-1",
        searchId,
        sequence: 0,
        indexRevision: 1,
        disposition: "replace",
        results: [result],
        count: { value: 1, exact: true },
        coverage: { indexedSources: 1, totalSources: 1, skippedSources: 0 },
        done: true,
      }).success,
    ).toBe(false);
  });
});
