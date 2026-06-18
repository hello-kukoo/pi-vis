// A failed assistant turn is recorded by pi as a `message_end` (live) or a
// stored assistant message entry (on reload) with `stopReason: "error"` and
// usually an `errorMessage`, plus empty content. Both the live transcript
// reducer and the history loader need to detect this and surface a visible
// error block, so the detection + fallback copy lives here in one place — if
// pi changes how it records a failed turn, there's a single site to update.

const GENERIC_TURN_ERROR_MESSAGE = "The model response ended with an error.";

/**
 * Inspect a pi assistant message snapshot for a provider/model failure.
 * Returns `isError: false` for a normal turn, or `isError: true` with a
 * user-facing `message` (the message's `errorMessage` if present, else a
 * generic fallback) for a failed one.
 */
export function detectTurnError(message: unknown): { isError: boolean; message: string } {
  const msg = (message ?? {}) as { stopReason?: unknown; errorMessage?: unknown };
  const errMsg = typeof msg.errorMessage === "string" && msg.errorMessage ? msg.errorMessage : "";
  const isError = msg.stopReason === "error" || errMsg.length > 0;
  if (!isError) return { isError: false, message: "" };
  return { isError: true, message: errMsg || GENERIC_TURN_ERROR_MESSAGE };
}
