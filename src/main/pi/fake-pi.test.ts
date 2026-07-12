import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FAKE_PI = join(__dirname, "../../../tests/fixtures/fake-pi.mjs");

function runFakePi(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FAKE_PI, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("fake-pi executable fixture", () => {
  const tempDirs: string[] = [];

  beforeAll(() => {
    fs.chmodSync(FAKE_PI, 0o755);
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the default executable version", async () => {
    const result = await runFakePi(["--version"]);
    expect(result).toEqual({ code: 0, stdout: "fake-pi 1.0.0\n", stderr: "" });
  });

  it("reads and updates the pinned version stamp with the requested argv", async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "fake-pi-version-"));
    tempDirs.push(dir);
    const versionFile = join(dir, "version");
    fs.writeFileSync(versionFile, "1.2.3\n");
    const env = {
      ...process.env,
      FAKE_PI_VERSION_FILE: versionFile,
      FAKE_PI_UPDATE_TO: "2.3.4",
    };

    expect(await runFakePi(["--version"], env)).toMatchObject({ code: 0, stdout: "1.2.3\n" });
    const update = await runFakePi(["update", "--self", "--no-approve"], env);
    expect(update.code).toBe(0);
    expect(update.stdout).toContain("ARGV update --self --no-approve");
    expect(update.stdout).toContain("Updated pi to 2.3.4");
    expect(await runFakePi(["--version"], env)).toMatchObject({ code: 0, stdout: "2.3.4\n" });
  });

  it("keeps the version unchanged when update exits unsuccessfully", async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "fake-pi-update-failure-"));
    tempDirs.push(dir);
    const versionFile = join(dir, "version");
    fs.writeFileSync(versionFile, "1.2.3\n");
    const result = await runFakePi(["update", "--all"], {
      ...process.env,
      FAKE_PI_VERSION_FILE: versionFile,
      FAKE_PI_UPDATE_EXIT: "3",
    });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("Update failed.");
    expect(fs.readFileSync(versionFile, "utf8").trim()).toBe("1.2.3");
  });
});
