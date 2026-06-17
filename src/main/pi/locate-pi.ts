import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { getLoginShellEnv } from "../auth.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

let cached: { path: string; version: string } | null = null;

async function runCommand(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function locatePi(
  overridePath?: string | null,
): Promise<{ path: string; version: string } | null> {
  if (cached && !overridePath) return cached;
  const candidates: string[] = [];

  if (overridePath) {
    candidates.push(overridePath);
  }

  // macOS GUI apps don't inherit shell PATH — use login shell to resolve
  const shellPath = await runCommand(`$SHELL -ilc 'command -v pi' 2>/dev/null`);
  if (shellPath) candidates.push(shellPath);

  const whichPath = await runCommand("which pi");
  if (whichPath) candidates.push(whichPath);

  if (candidates.length === 0) return null;

  // GUI-launched apps (Finder/Dock) have a stripped PATH. `pi` is a
  // `#!/usr/bin/env node` script, so validating it with `--version` needs
  // `node` on PATH — use the login-shell env (the same env the rpc / pty /
  // update subprocesses run with). Without this, pi is wrongly reported
  // "not found" on every non-terminal launch.
  const validateEnv = { ...process.env, ...(await getLoginShellEnv()) };

  for (const candidate of candidates) {
    try {
      // Use execFile so we never interpolate a path into a shell string.
      // execFile is also the only safe way to pass a path with spaces or
      // shell metacharacters.
      const { stdout } = await execFileAsync(candidate, ["--version"], {
        timeout: 5000,
        env: validateEnv,
      });
      const version = stdout.trim();
      if (version) {
        cached = { path: candidate, version };
        return cached;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function clearPiLocationCache(): void {
  cached = null;
}
