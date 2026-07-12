import { describe, expect, it } from "vitest";
import { compareVersions } from "./version.mjs";

// The version gate (host.mjs) uses compareVersions(installed, MIN) < 0 to
// reject an incompatible SDK host. The bug it replaced (P3-a) was
// `a.split(".").map(Number)` turning "0-beta" into NaN→0, so a pre-release
// "0.80.0-beta" wrongly satisfied the >= 0.80.0 gate. These guard that.
describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("0.80.0", "0.80.0")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.80.1", "0.80.0")).toBe(1);
    expect(compareVersions("0.79.9", "0.80.0")).toBe(-1);
    expect(compareVersions("0.80.0", "0.81.0")).toBe(-1);
  });

  it("treats a missing trailing component as 0 (0.80 == 0.80.0)", () => {
    expect(compareVersions("0.80", "0.80.0")).toBe(0);
    expect(compareVersions("0.80.1", "0.80")).toBe(1);
  });

  it("treats a pre-release as LOWER than the same release (P3-a)", () => {
    // The exact regression: a pre-release must NOT pass the >= gate.
    expect(compareVersions("0.80.0-beta", "0.80.0")).toBe(-1);
    expect(compareVersions("0.80.0", "0.80.0-beta")).toBe(1);
    expect(compareVersions("0.80.0-rc.1", "0.80.0")).toBe(-1);
  });

  it("orders two pre-releases lexically", () => {
    expect(compareVersions("0.80.0-alpha", "0.80.0-beta")).toBe(-1);
    expect(compareVersions("0.80.0-beta", "0.80.0-alpha")).toBe(1);
    expect(compareVersions("0.80.0-rc.1", "0.80.0-rc.1")).toBe(0);
  });

  it("numeric precedence wins over pre-release suffix (0.81.0-beta > 0.80.0)", () => {
    expect(compareVersions("0.81.0-beta", "0.80.0")).toBe(1);
  });

  it("models the host gate: only >= MIN is allowed inline", () => {
    const MIN = "0.80.0";
    const allowed = (v) => compareVersions(v, MIN) >= 0;
    expect(allowed("0.80.0")).toBe(true);
    expect(allowed("0.81.2")).toBe(true);
    expect(allowed("0.79.9")).toBe(false);
    expect(allowed("0.80.0-beta")).toBe(false); // the bug
  });
});
