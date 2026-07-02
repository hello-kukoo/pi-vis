import { describe, expect, it } from "vitest";
import { mergeUserPiEnv, sanitizeUserPiEnv } from "./pi-env.js";

describe("pi-env", () => {
  it("merges user pi env over the login-shell env", () => {
    expect(mergeUserPiEnv({ PATH: "/bin", KEEP: "1" }, { PATH: "/custom", FOO: "bar" })).toEqual({
      PATH: "/custom",
      KEEP: "1",
      FOO: "bar",
    });
  });

  it("drops invalid and Pi-Vis-reserved names", () => {
    expect(
      sanitizeUserPiEnv({
        OK_NAME: "yes",
        "1BAD": "no",
        "BAD-NAME": "no",
        PIVIS_PI_THEME: "light",
        PIVIS_TEST_HOST_SCRIPT: "/tmp/fake.mjs",
      }),
    ).toEqual({ OK_NAME: "yes" });
  });
});
