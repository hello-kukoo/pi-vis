import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execFileImpl: vi.fn() }));

vi.mock("node:child_process", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: callback-compatible test seam for promisify.
  execFile: (...args: any[]) => h.execFileImpl(...args),
}));

import { clearLoginShellEnvCache, getLoginShellEnv } from "./auth.js";

let previousHostScript: string | undefined;
let previousSentinel: string | undefined;

beforeEach(() => {
  previousHostScript = process.env.PIVIS_TEST_HOST_SCRIPT;
  previousSentinel = process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL;
  clearLoginShellEnvCache();
  h.execFileImpl.mockReset();
});

afterEach(() => {
  if (previousHostScript === undefined) delete process.env.PIVIS_TEST_HOST_SCRIPT;
  else process.env.PIVIS_TEST_HOST_SCRIPT = previousHostScript;
  if (previousSentinel === undefined) delete process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL;
  else process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL = previousSentinel;
  clearLoginShellEnvCache();
});

describe("getLoginShellEnv", () => {
  it("uses the inherited environment without invoking a login shell for fake hosts", async () => {
    process.env.PIVIS_TEST_HOST_SCRIPT = "/tmp/fake-session-host.mjs";
    process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL = "inherited";

    await expect(getLoginShellEnv()).resolves.toMatchObject({
      PIVIS_TEST_INHERITED_ENV_SENTINEL: "inherited",
    });
    expect(h.execFileImpl).not.toHaveBeenCalled();
  });
});
