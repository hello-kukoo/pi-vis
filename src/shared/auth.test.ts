import { describe, expect, it } from "vitest";
import { PROVIDERS, findProvider } from "./auth.js";

describe("Pi provider definitions", () => {
  it("exposes the providers added by Pi 0.84 with their public credential variables", () => {
    expect(findProvider("baseten")).toEqual({
      key: "baseten",
      displayName: "Baseten",
      envVar: "BASETEN_API_KEY",
    });
    expect(findProvider("qwen-token-plan-individual")).toEqual({
      key: "qwen-token-plan-individual",
      displayName: "Qwen Token Plan (Individual)",
      envVar: "QWEN_TOKEN_PLAN_API_KEY",
    });
  });

  it("keeps every provider key unique", () => {
    const keys = PROVIDERS.map((provider) => provider.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
