import { describe, expect, it } from "vitest";
import { PiEventSchema } from "./events.js";

describe("PiEventSchema", () => {
  it.each(["start", "toolcall_start", "toolcall_delta", "toolcall_end", "done", "error"])(
    "accepts the %s assistant stream subevent as a known message update",
    (type) => {
      const parsed = PiEventSchema.parse({
        type: "message_update",
        message: { role: "assistant" },
        assistantMessageEvent: { type, contentIndex: 1, delta: "{" },
      });

      expect(parsed.type).toBe("message_update");
      expect(parsed).not.toHaveProperty("__unknown");
    },
  );

  it("retains the forward-compatible marker for a genuinely unknown top-level event", () => {
    expect(PiEventSchema.parse({ type: "future_session_event" })).toMatchObject({
      type: "future_session_event",
      __unknown: true,
    });
  });

  it("retains Pi's estimated post-compaction token count", () => {
    expect(
      PiEventSchema.parse({
        type: "compaction_end",
        reason: "threshold",
        result: {
          summary: "summary",
          tokensBefore: 12_000,
          estimatedTokensAfter: 3_250,
        },
      }),
    ).toMatchObject({ result: { estimatedTokensAfter: 3_250 } });
  });
});
