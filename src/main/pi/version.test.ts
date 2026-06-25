import { describe, expect, it } from "vitest";
import { compareVersions } from "../../../resources/pi-session-host/version.mjs";

/**
 * P3-a: compareVersions pre-release hardening. The old `a.split(".").map(Number)`
 * turned "0-beta" into NaN→0, so "0.80.0-beta" passed the >=0.80.0 version gate
 * and the host started, then crashed on the first SDK call the beta lacked.
 * No released pi is a pre-release today (0/26), so this is hardening for future
 * pre-release channels — but the regression guard is cheap.
 */
describe("compareVersions (P3-a pre-release hardening)", () => {
  it("orders plain numeric versions", () => {
    expect(compareVersions("0.80.0", "0.80.0")).toBe(0);
    expect(compareVersions("0.81.0", "0.80.0")).toBe(1);
    expect(compareVersions("0.79.2", "0.80.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("treats a pre-release as LOWER than its release (semver)", () => {
    // The bug: "0.80.0-beta" used to compare EQUAL to "0.80.0" (NaN→0).
    expect(compareVersions("0.80.0-beta", "0.80.0")).toBe(-1);
    expect(compareVersions("0.80.0", "0.80.0-beta")).toBe(1);
  });

  it("still passes the MIN_PI_VERSION gate correctly for pre-releases", () => {
    // Mirror host.mjs's gate: compareVersions(version, MIN) < 0 → too low.
    const MIN = "0.80.0";
    expect(compareVersions("0.80.0-beta", MIN) < 0).toBe(true); // gate rejects
    expect(compareVersions("0.80.0", MIN) < 0).toBe(false); // gate accepts
    expect(compareVersions("0.81.0", MIN) < 0).toBe(false);
    expect(compareVersions("0.79.0", MIN) < 0).toBe(true);
  });

  it("orders two pre-releases lexically", () => {
    expect(compareVersions("0.80.0-rc.1", "0.80.0-rc.2")).toBe(-1);
    expect(compareVersions("0.80.0-rc.2", "0.80.0-rc.1")).toBe(1);
    expect(compareVersions("0.80.0-rc.1", "0.80.0-rc.1")).toBe(0);
  });
});
