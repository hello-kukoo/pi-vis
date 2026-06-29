import { afterEach, describe, expect, it } from "vitest";
import { hasClaim, useOverlayStore } from "./overlay-store.js";

describe("overlay-store — O1, O2", () => {
  afterEach(() => {
    // Reset the counter to a clean slate between tests.
    useOverlayStore.setState({ count: 0 });
  });

  it("acquire then release -> hasClaim false (O1)", () => {
    expect(hasClaim()).toBe(false);
    useOverlayStore.getState()._acquire();
    expect(hasClaim()).toBe(true);
    useOverlayStore.getState()._release();
    expect(hasClaim()).toBe(false);
  });

  it("two acquires, one release -> still claimed (ref-count, O2)", () => {
    useOverlayStore.getState()._acquire();
    useOverlayStore.getState()._acquire();
    expect(hasClaim()).toBe(true);
    useOverlayStore.getState()._release();
    expect(hasClaim()).toBe(true);
    useOverlayStore.getState()._release();
    expect(hasClaim()).toBe(false);
  });

  it("release with count 0 clamps at 0 (no negative)", () => {
    expect(hasClaim()).toBe(false);
    useOverlayStore.getState()._release();
    useOverlayStore.getState()._release();
    expect(useOverlayStore.getState().count).toBe(0);
    expect(hasClaim()).toBe(false);
  });
});
