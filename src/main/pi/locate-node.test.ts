import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  appendDiagnostic: vi.fn(),
  getSubprocessEnv: vi.fn(),
}));

vi.mock("../auth.js", () => ({ getSubprocessEnv: h.getSubprocessEnv }));
vi.mock("../diagnostics.js", () => ({ appendDiagnostic: h.appendDiagnostic }));

import { captureProcessOutput } from "../bounded-process.js";
import {
  chooseHostExecPath,
  clearNodeLocationCache,
  compareNodeVersions,
  resolveHostExecPath,
  resolvePackagedPtyHostExecOverride,
  resolveSystemNode,
} from "./locate-node.js";

const DEFAULT_SHIM_VERSION = "v22.19.0";

let previousHostScript: string | undefined;
const testRoots: string[] = [];

function inheritedStringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
}

function makeTestRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-locate-node-"));
  testRoots.push(root);
  return root;
}

function installPosixNodeShim(root: string): string {
  const shimPath = path.join(root, "node");
  fs.writeFileSync(
    shimPath,
    [
      "#!/bin/sh",
      'if [ -n "$PIVIS_NODE_PROBE_COUNT_FILE" ]; then',
      '  printf x >> "$PIVIS_NODE_PROBE_COUNT_FILE"',
      "fi",
      'if [ -n "$PIVIS_NODE_PROBE_DELAY_SECONDS" ]; then',
      '  /bin/sleep "$PIVIS_NODE_PROBE_DELAY_SECONDS"',
      "fi",
      'if [ -f ".pivis-node-workspace" ]; then',
      '  printf "%s\\n" "$PIVIS_NODE_PROBE_WORKSPACE_VERSION"',
      "else",
      '  printf "%s\\n" "$PIVIS_NODE_PROBE_DEFAULT_VERSION"',
      "fi",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(shimPath, 0o755);
  return shimPath;
}

function useProbeEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  const env = {
    ...inheritedStringEnv(),
    PATH: root,
    PIVIS_NODE_PROBE_DEFAULT_VERSION: DEFAULT_SHIM_VERSION,
    ...extra,
  };
  h.getSubprocessEnv.mockResolvedValue(env);
  return env;
}

beforeEach(() => {
  clearNodeLocationCache();
  previousHostScript = process.env.PIVIS_TEST_HOST_SCRIPT;
  delete process.env.PIVIS_TEST_HOST_SCRIPT;
  h.appendDiagnostic.mockReset();
  h.getSubprocessEnv.mockReset();
});

afterEach(() => {
  clearNodeLocationCache();
  vi.restoreAllMocks();
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (previousHostScript === undefined) delete process.env.PIVIS_TEST_HOST_SCRIPT;
  else process.env.PIVIS_TEST_HOST_SCRIPT = previousHostScript;
});

describe.skipIf(process.platform === "win32")("resolveSystemNode with real PATH shims", () => {
  it("returns the selected shim path so workspace cwd can still select a Node version", async () => {
    const root = makeTestRoot();
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, ".pivis-node-workspace"), "", "utf8");
    const shimPath = installPosixNodeShim(root);
    const env = useProbeEnv(root, {
      PIVIS_NODE_PROBE_WORKSPACE_VERSION: "v23.4.0",
    });

    await expect(resolveSystemNode()).resolves.toEqual({
      path: shimPath,
      version: DEFAULT_SHIM_VERSION,
    });

    // SessionHost later forks this exact path with the workspace as cwd. If the
    // resolver cached process.execPath instead, this project-sensitive choice
    // would be lost.
    await expect(
      captureProcessOutput(shimPath, ["--version"], {
        timeoutMs: 2_000,
        cwd: workspace,
        env,
      }),
    ).resolves.toEqual({ stdout: "v23.4.0\n", stderr: "" });
  });

  it("shares one real shim probe across concurrent callers", async () => {
    const root = makeTestRoot();
    const countPath = path.join(root, "probe-count");
    const shimPath = installPosixNodeShim(root);
    useProbeEnv(root, {
      PIVIS_NODE_PROBE_COUNT_FILE: countPath,
      PIVIS_NODE_PROBE_DELAY_SECONDS: "0.05",
    });

    await expect(
      Promise.all([resolveSystemNode(), resolveSystemNode(), resolveSystemNode()]),
    ).resolves.toEqual([
      { path: shimPath, version: DEFAULT_SHIM_VERSION },
      { path: shimPath, version: DEFAULT_SHIM_VERSION },
      { path: shimPath, version: DEFAULT_SHIM_VERSION },
    ]);
    expect(h.getSubprocessEnv).toHaveBeenCalledOnce();
    expect(fs.readFileSync(countPath, "utf8")).toBe("x");
  });

  it("shares one aggregate five-second deadline across lookup and version probes", async () => {
    const root = makeTestRoot();
    const countPath = path.join(root, "probe-count");
    installPosixNodeShim(root);
    useProbeEnv(root, { PIVIS_NODE_PROBE_COUNT_FILE: countPath });
    let clockRead = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      clockRead++;
      return clockRead < 3 ? 0 : 5_001;
    });

    await expect(resolveSystemNode()).resolves.toBeNull();
    expect(fs.existsSync(countPath)).toBe(false);
    expect(h.appendDiagnostic).toHaveBeenCalledWith(
      "host-startup",
      "node-resolution-failed",
      undefined,
      { stage: "version", reason: "timeout" },
    );
  });

  it("caches success until explicitly cleared", async () => {
    const root = makeTestRoot();
    const countPath = path.join(root, "probe-count");
    installPosixNodeShim(root);
    useProbeEnv(root, { PIVIS_NODE_PROBE_COUNT_FILE: countPath });

    const first = await resolveSystemNode();
    await expect(resolveSystemNode()).resolves.toEqual(first);
    expect(fs.readFileSync(countPath, "utf8")).toBe("x");

    clearNodeLocationCache();
    await resolveSystemNode();
    expect(fs.readFileSync(countPath, "utf8")).toBe("xx");
  });

  it("retries a failure on the next call without logging environment values", async () => {
    const root = makeTestRoot();
    useProbeEnv(root, { API_TOKEN: "must-not-appear-in-diagnostics" });

    await expect(resolveSystemNode()).resolves.toBeNull();
    await expect(resolveSystemNode()).resolves.toBeNull();
    expect(h.getSubprocessEnv).toHaveBeenCalledTimes(2);
    expect(h.appendDiagnostic).toHaveBeenCalledTimes(2);
    expect(h.appendDiagnostic).toHaveBeenLastCalledWith(
      "host-startup",
      "node-resolution-failed",
      undefined,
      { stage: "locate", reason: "nonzero-exit" },
    );
    expect(JSON.stringify(h.appendDiagnostic.mock.calls)).not.toContain(
      "must-not-appear-in-diagnostics",
    );
  });

  it("rejects invalid version output and retries that probe", async () => {
    const root = makeTestRoot();
    installPosixNodeShim(root);
    useProbeEnv(root, { PIVIS_NODE_PROBE_DEFAULT_VERSION: "not-a-node-version" });

    await expect(resolveSystemNode()).resolves.toBeNull();
    await expect(resolveSystemNode()).resolves.toBeNull();
    expect(h.getSubprocessEnv).toHaveBeenCalledTimes(2);
    expect(h.appendDiagnostic).toHaveBeenCalledWith(
      "host-startup",
      "node-resolution-failed",
      undefined,
      { stage: "version", reason: "invalid-output" },
    );
  });
});

describe.runIf(process.platform === "win32")("resolveSystemNode on Windows", () => {
  it("uses host SystemRoot and the captured PATH to resolve a real node executable", async () => {
    const env = inheritedStringEnv();
    delete env.SystemRoot;
    delete env.SYSTEMROOT;
    env.PATH = [path.dirname(process.execPath), env.PATH].filter(Boolean).join(path.delimiter);
    h.getSubprocessEnv.mockResolvedValue(env);

    const result = await resolveSystemNode();

    expect(process.env.SystemRoot ?? process.env.SYSTEMROOT).toMatch(/^[A-Za-z]:[\\/]/u);
    expect(result).not.toBeNull();
    expect(path.isAbsolute(result?.path ?? "")).toBe(true);
    expect(result?.path.toLowerCase()).toMatch(/\.exe$/u);
    expect(result?.version).toMatch(/^v\d+\.\d+\.\d+$/u);
    expect(h.appendDiagnostic).not.toHaveBeenCalled();
  });
});

describe("compareNodeVersions", () => {
  it("orders plain numeric versions and tolerates a leading v", () => {
    expect(compareNodeVersions("v22.5.0", "20.14.0")).toBe(1);
    expect(compareNodeVersions("20.14.0", "22.5.0")).toBe(-1);
    expect(compareNodeVersions("v22.5.0", "22.5.0")).toBe(0);
  });

  it("compares component-wise (not lexicographically)", () => {
    expect(compareNodeVersions("9.0.0", "10.0.0")).toBe(-1);
    expect(compareNodeVersions("22.5.0", "22.10.0")).toBe(-1);
  });
});

describe("resolvePackagedPtyHostExecOverride", () => {
  it("is inert without the explicit final-app verifier gate", () => {
    expect(
      resolvePackagedPtyHostExecOverride({ PIVIS_TEST_HOST_EXEC_PATH: process.execPath }),
    ).toBeUndefined();
  });

  it("forces an absolute plain-Node executable only for the packaged PTY verifier", () => {
    expect(
      resolvePackagedPtyHostExecOverride({
        PIVIS_TEST_PACKAGED_PTY_VERIFY: "1",
        PIVIS_TEST_HOST_EXEC_PATH: process.execPath,
      }),
    ).toBe(process.execPath);
    expect(() =>
      resolvePackagedPtyHostExecOverride({
        PIVIS_TEST_PACKAGED_PTY_VERIFY: "1",
        PIVIS_TEST_HOST_EXEC_PATH: "node",
      }),
    ).toThrow("requires an absolute PIVIS_TEST_HOST_EXEC_PATH");
  });
});

describe("resolveHostExecPath", () => {
  it("keeps deterministic fake hosts on Electron without reading PATH", async () => {
    process.env.PIVIS_TEST_HOST_SCRIPT = "/tmp/fake-session-host.mjs";

    await expect(resolveHostExecPath()).resolves.toEqual({
      execPath: undefined,
      reason: "electron-node-test-host",
    });
    expect(h.getSubprocessEnv).not.toHaveBeenCalled();
    expect(h.appendDiagnostic).not.toHaveBeenCalled();
  });
});

describe("chooseHostExecPath (the retarget decision)", () => {
  const ELECTRON_31_NODE = "20.14.0";

  it("retargets to system node when it is strictly newer than Electron's", () => {
    const decision = chooseHostExecPath({ path: "/n/node", version: "v22.19.0" }, ELECTRON_31_NODE);
    expect(decision).toEqual({ execPath: "/n/node", reason: "system-node" });
  });

  it("keeps Electron's node when system node is missing", () => {
    expect(chooseHostExecPath(null, ELECTRON_31_NODE)).toEqual({
      execPath: undefined,
      reason: "electron-node-no-system",
    });
  });

  it("keeps Electron's node when system node is not newer", () => {
    expect(chooseHostExecPath({ path: "/n/node", version: "v20.14.0" }, ELECTRON_31_NODE)).toEqual({
      execPath: undefined,
      reason: "electron-node-not-newer",
    });
    expect(chooseHostExecPath({ path: "/n/node", version: "v18.20.0" }, ELECTRON_31_NODE)).toEqual({
      execPath: undefined,
      reason: "electron-node-not-newer",
    });
  });

  it("stops retargeting once Electron's bundled node catches up", () => {
    const futureElectron = "22.18.0";
    expect(chooseHostExecPath({ path: "/n/node", version: "v22.5.0" }, futureElectron)).toEqual({
      execPath: undefined,
      reason: "electron-node-not-newer",
    });
  });
});
