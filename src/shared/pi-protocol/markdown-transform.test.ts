import { describe, expect, it } from "vitest";
import {
  MARKDOWN_TRANSFORM_MAX_INPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES,
  MarkdownTransformBatchSchema,
  MarkdownTransformResultDataSchema,
  markdownTransformJsonBytes,
  markdownTransformUtf8Bytes,
} from "./markdown-transform.js";

function requestItem(markdown: string, requestId = "markdown-a") {
  return {
    requestId,
    markdown,
    messageType: "assistant" as const,
    isStreaming: false,
    availableWidth: 80,
  };
}

describe("Markdown transform byte bounds", () => {
  it("counts UTF-8 bytes rather than JavaScript code units", () => {
    expect(markdownTransformUtf8Bytes("plain")).toBe(5);
    expect(markdownTransformUtf8Bytes("🙂")).toBe(4);

    const exact = "🙂".repeat(MARKDOWN_TRANSFORM_MAX_INPUT_BYTES / 4);
    expect(MarkdownTransformBatchSchema.safeParse([requestItem(exact)]).success).toBe(true);
    expect(MarkdownTransformBatchSchema.safeParse([requestItem(`${exact}🙂`)]).success).toBe(false);
  });

  it("bounds request IDs by UTF-8 bytes and requires uniqueness", () => {
    expect(
      MarkdownTransformBatchSchema.safeParse([requestItem("ok", "é".repeat(64))]).success,
    ).toBe(true);
    expect(
      MarkdownTransformBatchSchema.safeParse([requestItem("ok", "é".repeat(65))]).success,
    ).toBe(false);
    expect(
      MarkdownTransformBatchSchema.safeParse([
        requestItem("first", "duplicate"),
        requestItem("second", "duplicate"),
      ]).success,
    ).toBe(false);
  });

  it("bounds the serialized request batch including JSON escaping", () => {
    const escaped = "\0".repeat(90 * 1024);
    const items = [requestItem(escaped, "a"), requestItem(escaped, "b")];
    expect(items.every((item) => markdownTransformUtf8Bytes(item.markdown) < 256 * 1024)).toBe(
      true,
    );
    expect(markdownTransformJsonBytes(items)).toBeGreaterThan(
      MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES,
    );
    expect(MarkdownTransformBatchSchema.safeParse(items).success).toBe(false);
  });

  it("bounds extension output per item and across the serialized response", () => {
    const exactMultibyte = "🙂".repeat(MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES / 4);
    expect(
      MarkdownTransformResultDataSchema.safeParse({
        items: [{ requestId: "exact", markdown: exactMultibyte }],
      }).success,
    ).toBe(true);
    expect(
      MarkdownTransformResultDataSchema.safeParse({
        items: [{ requestId: "large", markdown: `${exactMultibyte}🙂` }],
      }).success,
    ).toBe(false);

    const expanded = "x".repeat(450 * 1024);
    const items = Array.from({ length: 5 }, (_, index) => ({
      requestId: `expanded-${index}`,
      markdown: expanded,
    }));
    expect(items.every((item) => markdownTransformUtf8Bytes(item.markdown) < 512 * 1024)).toBe(
      true,
    );
    expect(MarkdownTransformResultDataSchema.safeParse({ items }).success).toBe(false);
  });
});
