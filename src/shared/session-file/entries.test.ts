import { describe, expect, it } from "vitest";
import { SessionEntrySchema } from "./entries.js";

describe("SessionEntrySchema Pi 0.80.10 public payloads", () => {
  it.each([
    {
      role: "bashExecution",
      command: "npm test",
      output: "ok",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 1,
    },
    {
      role: "custom",
      customType: "artifact",
      content: [{ type: "image", data: "eA==", mimeType: "image/png" }],
      display: true,
      details: null,
      timestamp: 2,
    },
  ])("accepts message role $role without requiring text content", (message) => {
    const parsed = SessionEntrySchema.parse({
      type: "message",
      id: `message-${message.role}`,
      parentId: null,
      timestamp: 0,
      message,
    });

    expect(parsed).toMatchObject({ type: "message", message });
  });

  it.each([
    {
      type: "compaction",
      id: "compaction",
      summary: "summary",
      estimatedTokensAfter: 125,
      details: ["opaque"],
      fromHook: true,
    },
    {
      type: "branch_summary",
      id: "branch",
      summary: "recap",
      fromId: "old-leaf",
      details: null,
      fromHook: false,
    },
    {
      type: "custom",
      id: "custom",
      customType: "state",
      data: 42,
    },
    {
      type: "custom_message",
      id: "custom-message",
      customType: "notice",
      content: [
        { type: "text", text: "shown", textSignature: "signed" },
        { type: "image", data: "eA==", mimeType: "image/png", extensionField: 1 },
      ],
      details: { retained: true },
      display: true,
    },
  ])("preserves arbitrary public payload fields for $type", (entry) => {
    expect(SessionEntrySchema.parse(entry)).toMatchObject(entry);
  });
});
