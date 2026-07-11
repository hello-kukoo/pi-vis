import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { resolve } from "node:path";
import { scopedTmpPath } from "../isolation.mjs";

const REGISTRY_PATH =
  process.env["PIVIS_E2E_PROCESS_REGISTRY"] ?? scopedTmpPath("pivis-e2e-electron-pids", "txt");
const APP_ENTRY = resolve(import.meta.dirname, "../../out/main/index.js");

export function electronPidRegistryPath(): string {
  return REGISTRY_PATH;
}

export function registerElectronPid(pid: number): void {
  fs.appendFileSync(REGISTRY_PATH, `${pid}\n`);
}

function commandForPid(pid: number): string | null {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function isRegisteredPiVisElectron(pid: number): boolean {
  const command = commandForPid(pid);
  return !!command && command.includes(APP_ENTRY);
}

function signalProcessTree(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    process.kill(pid, signal);
    return;
  }

  // E2E Electron is spawned as a process-group leader. Signalling the group
  // also reaches renderer/GPU helpers and app-owned subprocesses.
  process.kill(-pid, signal);
}

function processTreeIsAlive(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function terminateElectronProcessTree(pid: number, graceMs = 2_000): Promise<void> {
  try {
    signalProcessTree(pid, "SIGTERM");
  } catch {
    // It may already have exited.
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processTreeIsAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  if (processTreeIsAlive(pid)) {
    try {
      signalProcessTree(pid, "SIGKILL");
    } catch {
      // It exited between the liveness check and signal.
    }

    const killDeadline = Date.now() + 1_000;
    while (Date.now() < killDeadline && processTreeIsAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

export async function killRegisteredElectronProcesses(): Promise<void> {
  let pids: number[] = [];
  try {
    pids = fs
      .readFileSync(REGISTRY_PATH, "utf8")
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return;
  }

  const uniquePids = [...new Set(pids)];
  await Promise.all(
    uniquePids.map(async (pid) => {
      if (isRegisteredPiVisElectron(pid)) await terminateElectronProcessTree(pid);
    }),
  );

  fs.rmSync(REGISTRY_PATH, { force: true });
}
