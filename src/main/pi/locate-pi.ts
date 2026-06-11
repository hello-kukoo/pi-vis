import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
  const candidates: string[] = [];

  if (overridePath) {
    candidates.push(overridePath);
  }

  // macOS GUI apps don't inherit shell PATH — use login shell to resolve
  const shellPath = await runCommand(`$SHELL -ilc 'command -v pi' 2>/dev/null`);
  if (shellPath) candidates.push(shellPath);

  const whichPath = await runCommand("which pi");
  if (whichPath) candidates.push(whichPath);

  for (const candidate of candidates) {
    const version = await runCommand(`"${candidate}" --version`);
    if (version) {
      cached = { path: candidate, version };
      return cached;
    }
  }

  return null;
}

export function getCachedPiLocation(): { path: string; version: string } | null {
  return cached;
}

export function clearPiLocationCache(): void {
  cached = null;
}
