import { describe, expect, it } from "vitest";
import { isRendererReloadShortcut } from "./renderer-navigation.js";

function keyInput(
  overrides: Partial<Parameters<typeof isRendererReloadShortcut>[0]> = {},
): Parameters<typeof isRendererReloadShortcut>[0] {
  return {
    type: "keyDown",
    key: "r",
    meta: false,
    control: false,
    ...overrides,
  };
}

describe("renderer navigation shortcuts", () => {
  it.each([
    keyInput({ meta: true }),
    keyInput({ meta: true, key: "R" }),
    keyInput({ control: true }),
  ])("blocks normal and shifted platform reload accelerators", (input) => {
    expect(isRendererReloadShortcut(input)).toBe(true);
  });

  it("does not consume unrelated or key-up input", () => {
    expect(isRendererReloadShortcut(keyInput({ key: "g", meta: true }))).toBe(false);
    expect(isRendererReloadShortcut(keyInput({ type: "keyUp", meta: true }))).toBe(false);
    expect(isRendererReloadShortcut(keyInput())).toBe(false);
  });
});
