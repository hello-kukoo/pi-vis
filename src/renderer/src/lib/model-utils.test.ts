import type { ModelInfo } from "@shared/pi-protocol/responses.js";
import { describe, expect, it } from "vitest";
import { findCurrentModel, isCurrentModel, modelDisplayName, modelKey } from "./model-utils.js";

const m = (id: string, provider?: string, name?: string): ModelInfo =>
  ({
    id,
    ...(provider !== undefined ? { provider } : {}),
    ...(name !== undefined ? { name } : {}),
  }) as ModelInfo;

describe("model-utils", () => {
  describe("modelKey", () => {
    it("produces provider/id composite keys", () => {
      expect(modelKey(m("glm-5.2", "zai"))).toBe("zai/glm-5.2");
    });

    it("makes same-id/different-provider keys distinct", () => {
      expect(modelKey(m("llama-4", "groq"))).not.toBe(modelKey(m("llama-4", "together")));
    });

    it("handles a missing provider", () => {
      expect(modelKey(m("legacy-model"))).toBe("/legacy-model");
    });
  });

  describe("modelDisplayName", () => {
    it("appends the provider in brackets, mirroring pi's TUI", () => {
      expect(modelDisplayName(m("glm-5.2", "zai", "GLM 5.2"))).toBe("GLM 5.2 [zai]");
    });

    it("falls back to the id when there is no name", () => {
      expect(modelDisplayName(m("glm-5.2", "zai"))).toBe("glm-5.2 [zai]");
    });

    it("omits the bracket when the provider is unknown", () => {
      expect(modelDisplayName(m("legacy", undefined, "Legacy"))).toBe("Legacy");
    });
  });

  describe("isCurrentModel / findCurrentModel", () => {
    const models = [m("llama-4", "groq"), m("llama-4", "together"), m("glm-5.2", "zai")];

    it("disambiguates same-id entries when the provider is known", () => {
      expect(isCurrentModel(m("llama-4", "groq"), "llama-4", "groq")).toBe(true);
      expect(isCurrentModel(m("llama-4", "together"), "llama-4", "groq")).toBe(false);
    });

    it("finds only the matching provider's copy", () => {
      const found = findCurrentModel(models, "llama-4", "together");
      expect(found?.provider).toBe("together");
    });

    it("returns undefined when no entry matches", () => {
      expect(findCurrentModel(models, "missing")).toBeUndefined();
    });

    it("falls back to id-only matching when the provider is unknown", () => {
      // Legacy pi / data race: currentProvider not yet known.
      expect(isCurrentModel(m("llama-4", "groq"), "llama-4")).toBe(true);
    });

    it("does NOT match a legacy no-provider entry when the current provider is known", () => {
      // Mixed shapes: the active provider (groq) is known, but a same-id
      // entry from a legacy shape omits the provider. Only the real groq
      // entry should highlight — the legacy one must not double-highlight.
      expect(isCurrentModel(m("llama-4", "groq"), "llama-4", "groq")).toBe(true);
      expect(isCurrentModel(m("llama-4", undefined), "llama-4", "groq")).toBe(false);
    });

    it("returns false for an unset currentModel", () => {
      expect(isCurrentModel(m("llama-4", "groq"), undefined)).toBe(false);
    });

    it("findCurrentModel returns at most ONE entry even when the provider is unknown", () => {
      // The provider-unknown window: two same-id copies exist. findCurrentModel
      // resolves to a single (the first) entry so list UIs comparing by key
      // never render two selected rows / two checkmarks.
      const dupes = [m("llama-4", "groq"), m("llama-4", "together")];
      const found = findCurrentModel(dupes, "llama-4", undefined);
      expect(found).toBeDefined();
      expect(found?.provider).toBe("groq");
      // Exactly one entry matches the resolved key — never two highlights.
      const key = found ? modelKey(found) : "";
      expect(dupes.filter((x) => modelKey(x) === key)).toHaveLength(1);
    });
  });
});
