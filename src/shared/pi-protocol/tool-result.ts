/**
 * Separator used when adjacent `content: [{ type: "text" }]` parts form one
 * tool result. This matches the live transcript reducer's display behavior.
 */
export const TOOL_RESULT_TEXT_SEPARATOR = "\n";

export interface ToolResultData {
  text: string;
  details: Record<string, unknown> | undefined;
  diff: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract the renderer-facing fields from a live tool result or its persisted
 * message snapshot. Text parts retain their order and are separated by a
 * newline; `output` is used only when no usable text part exists.
 *
 * Only non-array objects are accepted as result details, so malformed values
 * cannot become renderer-facing metadata. The returned details and diff are
 * always taken from the same final snapshot, making final-result handling
 * deterministic.
 */
export function extractToolResult(value: unknown): ToolResultData {
  if (typeof value === "string") {
    return { text: value, details: undefined, diff: undefined };
  }
  if (!isRecord(value)) {
    return { text: "", details: undefined, diff: undefined };
  }

  const details = isRecord(value.details) ? value.details : undefined;
  const diff =
    typeof details?.diff === "string"
      ? details.diff
      : typeof value.diff === "string"
        ? value.diff
        : undefined;

  if (Array.isArray(value.content)) {
    const textParts: string[] = [];
    for (const part of value.content) {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue;
      textParts.push(part.text);
    }
    if (textParts.length > 0) {
      return { text: textParts.join(TOOL_RESULT_TEXT_SEPARATOR), details, diff };
    }
  }

  return { text: typeof value.output === "string" ? value.output : "", details, diff };
}
