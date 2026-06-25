import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// locate-pi resolves the user's pi binary and validates it. The historically
// shipped crash (memory): GUI launches have a stripped PATH, and pi is a
// `#!/usr/bin/env node` script, so validating with `--version` under the bare
// app env fails `env: node` (exit 127) → pi wrongly reported missing. The fix
// validates under the login-shell env (getSubprocessEnv). These tests pin that
// and the candidate/cache behavior, with child_process + auth fully mocked.

const h = vi.hoisted(() => ({
  // (cmd, opts, cb) — `exec`, used for shell `command -v pi` / `which pi`.
  execImpl: vi.fn(),
  // (file, args, opts, cb) — `execFile`, used to validate `<pi> --version`.
  execFileImpl: vi.fn(),
  getSubprocessEnv: vi.fn(async () => ({ PATH: "/login/bin", FROM_LOGIN: "yes" })),
}));

vi.mock("node:child_process", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: thin callback-style passthrough for promisify.
  exec: (...args: any[]) => h.execImpl(...args),
  // biome-ignore lint/suspicious/noExplicitAny: thin callback-style passthrough for promisify.
  execFile: (...args: any[]) => h.execFileImpl(...args),
}));
vi.mock("../auth.js", () => ({ getSubprocessEnv: h.getSubprocessEnv }));

import { clearPiLocationCache, locatePi } from "./locate-pi.js";

type ExecCb = (err: Error | null, result?: { stdout: string }) => void;

/** Make `exec` answer the two shell-resolution commands. `null` = not found. */
function setShellResolution({ shell, which }: { shell: string | null; which: string | null }) {
  h.execImpl.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
    if (cmd.includes("command -v pi")) return cb(null, { stdout: shell ? `${shell}\n` : "" });
    if (cmd.includes("which pi")) return cb(null, { stdout: which ? `${which}\n` : "" });
    return cb(null, { stdout: "" });
  });
}

/** Make `execFile` validate specific candidates: map path → version|null(fail). */
function setValidation(map: Record<string, string | null>) {
  h.execFileImpl.mockImplementation((file: string, _args: unknown, _opts: unknown, cb: ExecCb) => {
    const v = map[file];
    if (v) return cb(null, { stdout: `${v}\n` });
    return cb(new Error("env: node: No such file or directory")); // the real failure
  });
}

beforeEach(() => {
  clearPiLocationCache();
  h.execImpl.mockReset();
  h.execFileImpl.mockReset();
  h.getSubprocessEnv.mockClear();
});

afterEach(() => {
  clearPiLocationCache();
});

describe("locatePi", () => {
  it("validates the override path under the LOGIN-SHELL env (the stripped-PATH fix)", async () => {
    setShellResolution({ shell: null, which: null });
    setValidation({ "/custom/pi": "0.81.0" });

    const result = await locatePi("/custom/pi");
    expect(result).toEqual({ path: "/custom/pi", version: "0.81.0" });

    // The regression guard: execFile must run with getSubprocessEnv()'s env,
    // not the bare process env — otherwise `env: node` fails on GUI launch.
    expect(h.getSubprocessEnv).toHaveBeenCalled();
    const firstCall = h.execFileImpl.mock.calls[0];
    if (!firstCall) throw new Error("expected execFile to have been called");
    const opts = firstCall[2] as { env?: Record<string, string> };
    expect(opts.env).toMatchObject({ FROM_LOGIN: "yes" });
  });

  it("falls through to the next candidate when one fails --version", async () => {
    setShellResolution({ shell: "/a/pi", which: "/b/pi" });
    setValidation({ "/a/pi": null, "/b/pi": "0.80.0" }); // /a fails, /b works

    const result = await locatePi();
    expect(result).toEqual({ path: "/b/pi", version: "0.80.0" });
    expect(h.execFileImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null when no candidate can be resolved", async () => {
    setShellResolution({ shell: null, which: null });
    const result = await locatePi();
    expect(result).toBeNull();
    expect(h.execFileImpl).not.toHaveBeenCalled(); // nothing to validate
  });

  it("returns null when every candidate fails validation", async () => {
    setShellResolution({ shell: "/a/pi", which: "/b/pi" });
    setValidation({ "/a/pi": null, "/b/pi": null });
    const result = await locatePi();
    expect(result).toBeNull();
  });

  it("caches a successful result and does not re-run resolution", async () => {
    setShellResolution({ shell: "/a/pi", which: null });
    setValidation({ "/a/pi": "0.82.0" });

    const first = await locatePi();
    expect(first).toEqual({ path: "/a/pi", version: "0.82.0" });
    const execCallsAfterFirst = h.execImpl.mock.calls.length;

    const second = await locatePi();
    expect(second).toEqual(first);
    // No additional shell resolution happened — served from cache.
    expect(h.execImpl.mock.calls.length).toBe(execCallsAfterFirst);

    // clearPiLocationCache forces a fresh resolution.
    clearPiLocationCache();
    await locatePi();
    expect(h.execImpl.mock.calls.length).toBeGreaterThan(execCallsAfterFirst);
  });

  it("bypasses the cache when an override path is supplied", async () => {
    setShellResolution({ shell: "/a/pi", which: null });
    setValidation({ "/a/pi": "0.82.0", "/other/pi": "0.83.0" });

    await locatePi(); // populates cache with /a/pi
    const result = await locatePi("/other/pi"); // override → ignore cache
    expect(result).toEqual({ path: "/other/pi", version: "0.83.0" });
  });
});
