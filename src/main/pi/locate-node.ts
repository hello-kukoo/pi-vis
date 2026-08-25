import path from "node:path";
import { performance } from "node:perf_hooks";
import { getSubprocessEnv } from "../auth.js";
import {
  boundedProcessFailureKind,
  captureProcessOutput,
  resolveWindowsSystemUtilityPath,
} from "../bounded-process.js";
import { appendDiagnostic } from "../diagnostics.js";

interface NodeLocation {
  path: string;
  version: string;
}

const NODE_RESOLUTION_TIMEOUT_MS = 5_000;
const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/u;

let cached: NodeLocation | null = null;
let nodeResolutionInFlight: Promise<NodeLocation | null> | null = null;

function remainingProbeTime(deadline: number): number | null {
  const remaining = Math.ceil(deadline - performance.now());
  return remaining > 0 ? remaining : null;
}

function firstNonEmptyLine(stdout: string): string | null {
  return (
    stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

async function locateNodeShim(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string | null> {
  if (process.platform === "win32") {
    const wherePath = resolveWindowsSystemUtilityPath(process.env, "where.exe");
    if (!wherePath) return null;
    const { stdout } = await captureProcessOutput(wherePath, ["node"], { timeoutMs, env });
    return firstNonEmptyLine(stdout);
  }

  // A fixed non-interactive shell performs PATH lookup inside the bounded
  // process group. The login environment was already captured by auth.ts, so
  // sourcing user startup files again would only reintroduce launch latency.
  const { stdout } = await captureProcessOutput("/bin/sh", ["-c", "command -v node"], {
    timeoutMs,
    env,
  });
  return firstNonEmptyLine(stdout);
}

async function probeNodeVersion(
  candidate: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string | null> {
  const result =
    process.platform === "win32"
      ? await captureProcessOutput(candidate, ["--version"], { timeoutMs, env })
      : await captureProcessOutput(
          "/bin/sh",
          ["-c", 'exec "$1" --version', "pivis-node-probe", candidate],
          { timeoutMs, env },
        );
  return (
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => NODE_VERSION_PATTERN.test(line)) ?? null
  );
}

function recordNodeResolutionFailure(
  stage: "environment" | "locate" | "version",
  reason: string,
): null {
  appendDiagnostic("host-startup", "node-resolution-failed", undefined, {
    stage,
    reason,
  });
  return null;
}

async function performNodeResolution(): Promise<NodeLocation | null> {
  const deadline = performance.now() + NODE_RESOLUTION_TIMEOUT_MS;
  let validateEnv: Record<string, string>;
  try {
    validateEnv = await getSubprocessEnv();
  } catch {
    return recordNodeResolutionFailure("environment", "environment-failed");
  }

  let candidate: string | null;
  try {
    const timeoutMs = remainingProbeTime(deadline);
    if (timeoutMs === null) {
      return recordNodeResolutionFailure("locate", "timeout");
    }
    candidate = await locateNodeShim(validateEnv, timeoutMs);
  } catch (error) {
    return recordNodeResolutionFailure("locate", boundedProcessFailureKind(error));
  }
  if (!candidate) return recordNodeResolutionFailure("locate", "not-found");

  let version: string | null;
  try {
    const timeoutMs = remainingProbeTime(deadline);
    if (timeoutMs === null) {
      return recordNodeResolutionFailure("version", "timeout");
    }
    version = await probeNodeVersion(candidate, validateEnv, timeoutMs);
  } catch (error) {
    return recordNodeResolutionFailure("version", boundedProcessFailureKind(error));
  }
  if (!version) return recordNodeResolutionFailure("version", "invalid-output");

  const result = { path: candidate, version };
  cached = result;
  return result;
}

/**
 * Minimal semver-ish numeric compare for Node version strings ("v22.5.0").
 *
 * Node versions are plain numeric `vMAJOR.MINOR.PATCH`, never pre-releases that
 * matter here, so this intentionally does NOT replicate the pre-release handling
 * of resources/pi-session-host/version.mjs (the host's comparator for pi's
 * version gate, which DOES see pi pre-releases). Kept local + dependency-free
 * rather than importing the host's ESM, so the main bundle doesn't reach across
 * into resources/ for a 4-line compare.
 *
 * @returns -1 if a<b, 1 if a>b, 0 if equal
 */
export function compareNodeVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Resolve the user's system `node` — the same Node that `pi` itself runs under
 * (pi is a `#!/usr/bin/env node` script on the login-shell PATH).
 *
 * macOS GUI apps don't inherit shell PATH, so the already-captured login-shell
 * environment supplies the expected PATH. A bounded non-interactive lookup
 * retains the selected executable path (including a Volta/mise/asdf shim), and
 * a second bounded probe validates its version. Retaining the shim matters:
 * SessionHost later executes it with the workspace as cwd, allowing a version
 * manager to apply that project's Node selection instead of freezing whatever
 * `process.execPath` happened to resolve from the app's launch directory.
 *
 * Success is cached for the process lifetime. Concurrent callers share one
 * lookup; a failed lookup is retried by the next caller, preserving the prior
 * transient-failure behavior.
 */
export async function resolveSystemNode(): Promise<NodeLocation | null> {
  if (cached) return cached;
  if (nodeResolutionInFlight) return nodeResolutionInFlight;

  const operation = performNodeResolution().finally(() => {
    if (nodeResolutionInFlight === operation) nodeResolutionInFlight = null;
  });
  nodeResolutionInFlight = operation;
  return operation;
}

export function clearNodeLocationCache(): void {
  cached = null;
}

/**
 * Why the SDK-host subprocess might run under a different (retargeted) Node.
 * Surfaced as a `reason` for diagnostics; the caller logs it once.
 */
export type HostExecDecision =
  /** Deterministic fake-host E2E stays on Electron and skips user-shell lookup. */
  | "electron-node-test-host"
  /** System Node found and is newer than Electron's bundled Node → use it. */
  | "system-node"
  /** No usable system Node on PATH → stay on Electron's bundled Node. */
  | "electron-node-no-system"
  /** System Node exists but is NOT newer than Electron's → stay on Electron's. */
  | "electron-node-not-newer"
  /** Final-app PTY verification explicitly selected its plain-Node runtime. */
  | "packaged-pty-test";

/**
 * Decide which executable should run the SDK-host subprocess.
 *
 * THE PARITY GAP THIS CLOSES:
 *
 * The host is forked from Electron's main process, so by default it runs under
 * Electron's bundled Node (e.g. Electron 31 → Node 20.14). That lags the user's
 * system Node, which breaks pi extensions that rely on newer Node built-ins.
 * The concrete failure: `@cursor/sdk`'s default `SqliteLocalAgentStore` needs
 * `node:sqlite`, a built-in added in Node v22.5.0. In terminal pi the
 * extension works because pi runs under the user's Node (22.5+); the forked
 * host runs under Electron's Node (20.x), where `node:sqlite` doesn't exist.
 *
 * The fix: when the user's system Node is newer than Electron's bundled Node,
 * retarget the host fork onto the system Node so the host sees the same runtime
 * `pi` does. This restores parity not just for `node:sqlite` but for ANY Node
 * feature newer than Electron's bundled version.
 *
 * WHY "STRICTLY NEWER":
 *
 * We retarget ONLY when system Node > Electron's bundled Node:
 *   - newer → switch (this is the case that helps; e.g. 22.x vs 20.14)
 *   - equal → no gain, so keep Electron's (avoids any oddity in the user's
 *     node setup — nvm shims, volta, etc. — for zero benefit)
 *   - older → would be a downgrade, so keep Electron's
 * This makes the switch self-justifying — it only fires when it actually helps
 * — and adapts automatically: if Pi-Vis later ships an Electron whose bundled
 * Node already covers the need (e.g. node:sqlite), the retarget simply stops
 * firing. No floor constant to maintain.
 *
 * Pure + unit-testable; {@link resolveHostExecPath} is the async wrapper.
 */
export function chooseHostExecPath(
  systemNode: { path: string; version: string } | null,
  electronNodeVersion: string,
): { execPath: string | undefined; reason: HostExecDecision } {
  if (!systemNode) {
    return { execPath: undefined, reason: "electron-node-no-system" };
  }
  if (compareNodeVersions(systemNode.version, electronNodeVersion) > 0) {
    return { execPath: systemNode.path, reason: "system-node" };
  }
  return { execPath: undefined, reason: "electron-node-not-newer" };
}

/**
 * Resolve and decide the SDK-host subprocess executable, end to end.
 *
 * Returns `{ execPath: undefined }` to mean "use the default (Electron's bundled
 * Node)" — i.e. today's behavior, the fallback that keeps everything except
 * newer-Node-built-in extensions (like @cursor/sdk's sqlite store) working.
 * Returns `{ execPath: <node path> }` to retarget the host onto the user's Node.
 *
 * Cached transitively via {@link resolveSystemNode}; Node resolution reuses the
 * single captured environment and performs no additional login-shell round trip.
 */
export function resolvePackagedPtyHostExecOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // This pair is intentionally an opt-in E2E seam, not a general runtime
  // override. The final-app verifier must force plain Node even when its Node
  // version is equal to or older than Electron's; ordinary launches retain the
  // strictly-newer production selection policy above.
  if (env.PIVIS_TEST_PACKAGED_PTY_VERIFY !== "1") return undefined;
  const execPath = env.PIVIS_TEST_HOST_EXEC_PATH;
  if (!execPath || !path.isAbsolute(execPath)) {
    throw new Error(
      "PIVIS_TEST_PACKAGED_PTY_VERIFY requires an absolute PIVIS_TEST_HOST_EXEC_PATH",
    );
  }
  return execPath;
}

export async function resolveHostExecPath(): Promise<{
  execPath: string | undefined;
  reason: HostExecDecision;
}> {
  const testExecPath = resolvePackagedPtyHostExecOverride();
  if (testExecPath) return { execPath: testExecPath, reason: "packaged-pty-test" };

  // PIVIS_TEST_HOST_SCRIPT substitutes a deterministic direct-protocol child,
  // not the user's Pi runtime. Resolving a newer system Node would needlessly
  // source the user's login shell and can make an otherwise isolated E2E suite
  // depend on shell startup side effects. The real SDK and packaged journeys
  // deliberately clear this seam and continue through production discovery.
  if (process.env.PIVIS_TEST_HOST_SCRIPT) {
    return { execPath: undefined, reason: "electron-node-test-host" };
  }

  const systemNode = await resolveSystemNode();
  const electronNode = process.versions.node; // the Node Electron was built with
  return chooseHostExecPath(systemNode, electronNode);
}
