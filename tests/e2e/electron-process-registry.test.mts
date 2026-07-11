import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { terminateElectronProcessTree } from "./electron-process-registry.mjs";

const describeProcessGroups = process.platform === "win32" ? describe.skip : describe;

describeProcessGroups("Electron process-tree cleanup", () => {
  it("force-kills a process group that ignores SIGTERM", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("fixture did not start")), 2_000);
        child.stdout.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
      });

      expect(child.pid).toBeTypeOf("number");
      await terminateElectronProcessTree(child.pid!, 50);
      await Promise.race([
        exited,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("fixture survived process-tree cleanup")), 2_000),
        ),
      ]);
      expect(child.signalCode).toBe("SIGKILL");
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  });
});
