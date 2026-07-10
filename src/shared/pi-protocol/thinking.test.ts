import { describe, expect, it } from "vitest";
import { AppSettingsSchema } from "../settings.js";
import { SetThinkingLevelCommandSchema } from "./commands.js";
import { ThinkingLevelSchema } from "./thinking.js";

describe("Pi 0.80.6 max thinking level", () => {
  it("accepts max in events, commands, and persisted settings", () => {
    expect(ThinkingLevelSchema.parse("max")).toBe("max");
    expect(
      SetThinkingLevelCommandSchema.parse({ type: "set_thinking_level", level: "max" }),
    ).toEqual({
      type: "set_thinking_level",
      level: "max",
    });
    expect(AppSettingsSchema.parse({ lastUsedThinkingLevel: "max" }).lastUsedThinkingLevel).toBe(
      "max",
    );
  });
});
