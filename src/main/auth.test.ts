import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  appendDiagnostic: vi.fn(),
  boundedProcessFailureKind: vi.fn(() => "timeout"),
  captureProcessOutput: vi.fn(),
}));

vi.mock("./bounded-process.js", () => ({
  boundedProcessFailureKind: h.boundedProcessFailureKind,
  captureProcessOutput: h.captureProcessOutput,
}));
vi.mock("./diagnostics.js", () => ({ appendDiagnostic: h.appendDiagnostic }));

import { clearLoginShellEnvCache, getLoginShellEnv } from "./auth.js";

let previousHostScript: string | undefined;
let previousSentinel: string | undefined;
let previousShell: string | undefined;

beforeEach(() => {
  previousHostScript = process.env.PIVIS_TEST_HOST_SCRIPT;
  previousSentinel = process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL;
  previousShell = process.env.SHELL;
  delete process.env.PIVIS_TEST_HOST_SCRIPT;
  process.env.SHELL = "/bin/test-shell";
  clearLoginShellEnvCache();
  h.appendDiagnostic.mockReset();
  h.boundedProcessFailureKind.mockClear();
  h.captureProcessOutput.mockReset();
});

afterEach(() => {
  if (previousHostScript === undefined) delete process.env.PIVIS_TEST_HOST_SCRIPT;
  else process.env.PIVIS_TEST_HOST_SCRIPT = previousHostScript;
  if (previousSentinel === undefined) delete process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL;
  else process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL = previousSentinel;
  if (previousShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = previousShell;
  clearLoginShellEnvCache();
});

describe("getLoginShellEnv", () => {
  it("uses the inherited environment without invoking a login shell for fake hosts", async () => {
    process.env.PIVIS_TEST_HOST_SCRIPT = "/tmp/fake-session-host.mjs";
    process.env.PIVIS_TEST_INHERITED_ENV_SENTINEL = "inherited";

    await expect(getLoginShellEnv()).resolves.toMatchObject({
      PIVIS_TEST_INHERITED_ENV_SENTINEL: "inherited",
    });
    expect(h.captureProcessOutput).not.toHaveBeenCalled();
  });

  it("captures and parses the interactive login-shell environment with a hard bound", async () => {
    h.captureProcessOutput.mockResolvedValue({
      stdout: "PATH=/login/bin:/usr/bin\nAPI_TOKEN=abc=123\n",
      stderr: "",
    });

    await expect(getLoginShellEnv()).resolves.toEqual({
      PATH: "/login/bin:/usr/bin",
      API_TOKEN: "abc=123",
    });
    expect(h.captureProcessOutput).toHaveBeenCalledWith("/bin/test-shell", ["-ilc", "env"], {
      timeoutMs: 5_000,
      maxBufferBytes: 1024 * 1024,
    });
  });

  it("does not PATH-resolve a relative SHELL before the capture deadline starts", async () => {
    process.env.SHELL = "relative-shell";
    h.captureProcessOutput.mockResolvedValue({ stdout: "PATH=/safe\n", stderr: "" });

    await getLoginShellEnv();

    expect(h.captureProcessOutput).toHaveBeenCalledWith("/bin/bash", ["-ilc", "env"], {
      timeoutMs: 5_000,
      maxBufferBytes: 1024 * 1024,
    });
  });

  it("shares one shell capture across concurrent callers", async () => {
    let resolveCapture: ((value: { stdout: string; stderr: string }) => void) | undefined;
    h.captureProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );

    const first = getLoginShellEnv();
    const second = getLoginShellEnv();
    expect(h.captureProcessOutput).toHaveBeenCalledOnce();
    resolveCapture?.({ stdout: "PATH=/single-flight\n", stderr: "" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { PATH: "/single-flight" },
      { PATH: "/single-flight" },
    ]);
    await getLoginShellEnv();
    expect(h.captureProcessOutput).toHaveBeenCalledOnce();
  });

  it("falls back once and caches an empty environment after bounded capture fails", async () => {
    h.captureProcessOutput.mockRejectedValue(new Error("Process timed out after 5000ms"));

    await expect(getLoginShellEnv()).resolves.toEqual({});
    await expect(getLoginShellEnv()).resolves.toEqual({});
    expect(h.captureProcessOutput).toHaveBeenCalledOnce();
    expect(h.appendDiagnostic).toHaveBeenCalledOnce();
    expect(h.appendDiagnostic).toHaveBeenCalledWith(
      "host-startup",
      "login-shell-env-failed",
      undefined,
      { reason: "timeout", timeoutMs: 5_000 },
    );
  });
});
