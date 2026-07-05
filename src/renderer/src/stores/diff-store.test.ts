import { describe, expect, it } from "vitest";
import { useDiffStore } from "./diff-store.js";

describe("diff-store render caps", () => {
  it("bumps a file render cap immutably and never lowers it", () => {
    const before = new Map([
      ["big.ts", { status: "ready" as const, collapsed: false, renderCap: 5_000 }],
    ]);
    useDiffStore.setState({ fileState: before });

    useDiffStore.getState().bumpRenderCap("big.ts", 7_500);
    const raised = useDiffStore.getState().fileState;
    expect(raised).not.toBe(before);
    expect(raised.get("big.ts")?.renderCap).toBe(7_500);

    useDiffStore.getState().bumpRenderCap("big.ts", 6_000);
    expect(useDiffStore.getState().fileState.get("big.ts")?.renderCap).toBe(7_500);
  });
});
