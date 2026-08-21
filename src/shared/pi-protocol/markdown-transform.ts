import { z } from "zod";
import {
  MARKDOWN_TRANSFORM_MAX_INPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_ITEMS,
  MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES,
  MARKDOWN_TRANSFORM_MAX_REQUEST_ID_BYTES,
  MARKDOWN_TRANSFORM_MAX_RESPONSE_BATCH_BYTES,
  markdownTransformJsonBytes,
  markdownTransformUtf8Bytes,
} from "../../../resources/pi-session-host/markdown-transform-limits.mjs";

export {
  MARKDOWN_TRANSFORM_MAX_INPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_ITEMS,
  MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES,
  MARKDOWN_TRANSFORM_MAX_REQUEST_ID_BYTES,
  MARKDOWN_TRANSFORM_MAX_RESPONSE_BATCH_BYTES,
  markdownTransformJsonBytes,
  markdownTransformUtf8Bytes,
};

function hasUniqueRequestIds(items: readonly { requestId: string }[]): boolean {
  return new Set(items.map(({ requestId }) => requestId)).size === items.length;
}

export const MarkdownTransformMessageTypeSchema = z.enum([
  "user",
  "assistant",
  "assistant-thinking",
]);
export type MarkdownTransformMessageType = z.infer<typeof MarkdownTransformMessageTypeSchema>;

/**
 * One display-only Markdown transformation. Batches keep archived transcript
 * mounting bounded to one owner-fenced host query per cooperative render chunk.
 */
export const MarkdownTransformItemSchema = z
  .object({
    requestId: z
      .string()
      .min(1)
      .refine(
        (value) => markdownTransformUtf8Bytes(value) <= MARKDOWN_TRANSFORM_MAX_REQUEST_ID_BYTES,
        "requestId exceeds UTF-8 byte limit",
      ),
    markdown: z
      .string()
      .refine(
        (value) => markdownTransformUtf8Bytes(value) <= MARKDOWN_TRANSFORM_MAX_INPUT_BYTES,
        "markdown exceeds UTF-8 byte limit",
      ),
    messageType: MarkdownTransformMessageTypeSchema,
    isStreaming: z.boolean(),
    availableWidth: z.number().int().min(20).max(240),
  })
  .strict();
export type MarkdownTransformItem = z.infer<typeof MarkdownTransformItemSchema>;

export const MarkdownTransformBatchSchema = z
  .array(MarkdownTransformItemSchema)
  .min(1)
  .max(MARKDOWN_TRANSFORM_MAX_ITEMS)
  .refine(hasUniqueRequestIds, "requestIds must be unique")
  .refine(
    (items) => markdownTransformJsonBytes(items) <= MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES,
    "Markdown transform request exceeds aggregate byte limit",
  );
export type MarkdownTransformBatch = z.infer<typeof MarkdownTransformBatchSchema>;

export const MarkdownTransformResultItemSchema = z
  .object({
    requestId: MarkdownTransformItemSchema.shape.requestId,
    markdown: z
      .string()
      .refine(
        (value) => markdownTransformUtf8Bytes(value) <= MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES,
        "transformed Markdown exceeds UTF-8 byte limit",
      ),
  })
  .strict();

export const MarkdownTransformResultDataSchema = z
  .object({
    items: z
      .array(MarkdownTransformResultItemSchema)
      .max(MARKDOWN_TRANSFORM_MAX_ITEMS)
      .refine(hasUniqueRequestIds, "requestIds must be unique"),
  })
  .strict()
  .refine(
    (result) => markdownTransformJsonBytes(result) <= MARKDOWN_TRANSFORM_MAX_RESPONSE_BATCH_BYTES,
    "Markdown transform response exceeds aggregate byte limit",
  );
export type MarkdownTransformResultData = z.infer<typeof MarkdownTransformResultDataSchema>;
