import { describe, expect, it } from "vitest";
import { TOOL_RESULT_TEXT_SEPARATOR, extractToolResult } from "./tool-result.js";

describe("extractToolResult", () => {
  it("keeps live and persisted content snapshots at the same helper boundary", () => {
    const result = {
      content: [
        { type: "text", text: "first line" },
        { type: "text", text: "second line" },
      ],
      details: { exitCode: 0 },
    };

    const liveEndResult = extractToolResult(result);
    const persistedToolResultMessage = extractToolResult({ ...result, role: "toolResult" });

    expect(TOOL_RESULT_TEXT_SEPARATOR).toBe("\n");
    expect(liveEndResult).toEqual({
      text: "first line\nsecond line",
      details: { exitCode: 0 },
      diff: undefined,
    });
    expect(persistedToolResultMessage).toEqual(liveEndResult);
  });

  it("accepts string results and falls back to output without text parts", () => {
    expect(extractToolResult("plain output")).toEqual({
      text: "plain output",
      details: undefined,
      diff: undefined,
    });
    expect(extractToolResult({ content: [{ type: "image" }], output: "fallback output" })).toEqual({
      text: "fallback output",
      details: undefined,
      diff: undefined,
    });
  });

  it("preserves deterministic details and diff from a final result", () => {
    const details = { diff: "-before\n+after", fullOutputPath: "/tmp/result" };
    expect(extractToolResult({ content: [], details, diff: "ignored direct diff" })).toEqual({
      text: "",
      details,
      diff: "-before\n+after",
    });
    expect(extractToolResult({ output: "done", diff: "direct diff" })).toEqual({
      text: "done",
      details: undefined,
      diff: "direct diff",
    });
  });

  it("safely ignores malformed result, content, and details values", () => {
    expect(extractToolResult(null)).toEqual({ text: "", details: undefined, diff: undefined });
    expect(extractToolResult([])).toEqual({ text: "", details: undefined, diff: undefined });
    expect(
      extractToolResult({
        content: [null, { type: "text", text: 1 }, { type: "text", text: "valid" }],
        details: ["not details"],
        diff: 1,
      }),
    ).toEqual({ text: "valid", details: undefined, diff: undefined });
  });
});
