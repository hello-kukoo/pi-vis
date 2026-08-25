import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { captureProcessOutput, resolveWindowsSystemUtilityPath } from "./bounded-process.js";

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processExists(pid);
}

async function waitForPath(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return fs.existsSync(filePath);
}

describe("captureProcessOutput", () => {
  it("captures a successful bounded command", async () => {
    await expect(
      captureProcessOutput(process.execPath, ["-e", 'process.stdout.write("ready")'], {
        timeoutMs: 2_000,
      }),
    ).resolves.toEqual({ stdout: "ready", stderr: "" });
  });

  it("settles at its deadline when a descendant inherits the capture pipes", async () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-bounded-inherited-pipe-"));
    const pidPath = path.join(testRoot, "descendant.pid");
    const readyPath = path.join(testRoot, "descendant.ready");
    let descendantPid: number | undefined;
    try {
      const descendantSource = [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
        "setInterval(() => {}, 10_000);",
      ].join("\n");
      const leaderSource = [
        'const { spawn } = require("node:child_process");',
        'const fs = require("node:fs");',
        `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}],`,
        '  { stdio: ["ignore", 1, 2] });',
        `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
        "setInterval(() => {}, 10_000);",
      ].join("\n");
      const startedAt = Date.now();
      const capture = captureProcessOutput(process.execPath, ["-e", leaderSource], {
        timeoutMs: 1_500,
      });

      await expect(waitForPath(readyPath, 1_000)).resolves.toBe(true);
      descendantPid = Number(fs.readFileSync(pidPath, "utf8"));
      expect(Number.isSafeInteger(descendantPid)).toBe(true);
      await expect(capture).rejects.toThrow("timed out");
      expect(Date.now() - startedAt).toBeLessThan(3_000);

      // Rejection continuations run before later-turn tree cleanup. The live
      // descendant proves settlement did not wait for its inherited pipes.
      expect(processExists(descendantPid)).toBe(true);
      await expect(waitForProcessExit(descendantPid, 3_000)).resolves.toBe(true);
    } finally {
      if (descendantPid !== undefined && processExists(descendantPid)) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {
          // Best-effort cleanup for a failing regression test.
        }
      }
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "SIGKILLs an inherited-pipe descendant that ignores SIGTERM after its leader exits",
    async () => {
      const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-bounded-process-"));
      const pidPath = path.join(testRoot, "descendant.pid");
      const readyPath = path.join(testRoot, "descendant.ready");
      let descendantPid: number | undefined;
      try {
        const descendantSource = [
          'const fs = require("node:fs");',
          'process.on("SIGTERM", () => {});',
          `fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
          "setInterval(() => {}, 10_000);",
        ].join("\n");
        const leaderSource = [
          'const { spawn } = require("node:child_process");',
          'const fs = require("node:fs");',
          `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}],`,
          '  { stdio: ["ignore", 1, 2] });',
          `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
          "child.unref();",
        ].join("\n");

        const capture = captureProcessOutput(process.execPath, ["-e", leaderSource], {
          timeoutMs: 2_000,
        });
        await expect(waitForPath(readyPath, 1_500)).resolves.toBe(true);
        await expect(capture).rejects.toThrow("timed out");

        descendantPid = Number(fs.readFileSync(pidPath, "utf8"));
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        await expect(waitForProcessExit(descendantPid, 2_000)).resolves.toBe(true);
      } finally {
        if (descendantPid !== undefined && processExists(descendantPid)) {
          try {
            process.kill(descendantPid, "SIGKILL");
          } catch {
            // Best-effort cleanup for a failing regression test.
          }
        }
        fs.rmSync(testRoot, { recursive: true, force: true });
      }
    },
  );

  it("terminates capture when the aggregate output bound is exceeded", async () => {
    await expect(
      captureProcessOutput(process.execPath, ["-e", 'process.stdout.write("x".repeat(1024))'], {
        timeoutMs: 2_000,
        maxBufferBytes: 128,
      }),
    ).rejects.toThrow("exceeded 128 bytes");
  });
});

describe("resolveWindowsSystemUtilityPath", () => {
  it("uses absolute System32 paths and never falls back to PATH", () => {
    const env = { SystemRoot: "C:\\Windows", PATH: "Z:\\attacker-controlled" };

    expect(resolveWindowsSystemUtilityPath(env, "taskkill.exe")).toBe(
      "C:\\Windows\\System32\\taskkill.exe",
    );
    expect(resolveWindowsSystemUtilityPath(env, "where.exe")).toBe(
      "C:\\Windows\\System32\\where.exe",
    );
    expect(
      resolveWindowsSystemUtilityPath({ PATH: "Z:\\attacker-controlled" }, "taskkill.exe"),
    ).toBeNull();
    expect(resolveWindowsSystemUtilityPath({ SystemRoot: "Windows" }, "where.exe")).toBeNull();
    expect(resolveWindowsSystemUtilityPath({ SystemRoot: "\\Windows" }, "where.exe")).toBeNull();
    expect(
      resolveWindowsSystemUtilityPath({ SystemRoot: "\\\\server\\Windows" }, "taskkill.exe"),
    ).toBeNull();
  });
});
