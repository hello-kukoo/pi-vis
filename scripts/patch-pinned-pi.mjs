#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PINNED_PI_PATCH_VERSION = "0.84.2";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultPackageDirectory = path.join(
  projectRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
);
const defaultPiAiPackageDirectory = path.join(
  defaultPackageDirectory,
  "node_modules",
  "@earendil-works",
  "pi-ai",
);
const patchPath = path.join(projectRoot, "patches", "pi-coding-agent-0.84.2.patch");

export const PINNED_PI_PATCH_FILES = Object.freeze([
  Object.freeze({
    owner: "coding-agent",
    relativePath: "dist/core/agent-session.js",
    originalSha256: "9f065b4a277857db100e3277c4d18316c89cd46b11f6ba8140122f19efbe47c4",
    patchedSha256: "9dd49fd4c2cda16dabab4e43f2d99a0c0971b8f6f0a3ca34610eadab330f69e9",
  }),
  Object.freeze({
    owner: "coding-agent",
    relativePath: "dist/core/session-manager.js",
    originalSha256: "af809d47818a3bf6a10173c167905e013ad7303261919a5a35a8466b801daf2e",
    patchedSha256: "6e0de0621250531798436c0ab0bfd81d2cd8f7fce6b917c7a9a6d36392208afc",
  }),
  Object.freeze({
    owner: "pi-ai",
    relativePath: "dist/api/mistral-conversations.js",
    originalSha256: "e25005402068400d1d53dd912fa3237f12775040d77dbbecc9d079520344617e",
    patchedSha256: "96c6c1da384c328cf0c5c07dd81328af8ab9854785721af3fb2da49e025b6657",
  }),
]);

const sha256 = (filePath) => createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

function readVersion(packageDirectory) {
  const manifestPath = path.join(packageDirectory, "package.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")).version;
  } catch (error) {
    throw new Error(`Cannot read pinned Pi manifest ${manifestPath}: ${String(error)}`);
  }
}

function targetPath(spec, packageDirectory, piAiPackageDirectory) {
  return path.join(
    spec.owner === "coding-agent" ? packageDirectory : piAiPackageDirectory,
    spec.relativePath,
  );
}

/**
 * Apply or verify the exact 0.84.2 runtime fixes carried by Pi-Vis.
 *
 * The pristine and patched SHA-256 values are both fixed. A mixed or unknown
 * state fails closed, preventing a changed upstream tarball or partial patch
 * from reaching tests or electron-builder.
 */
export function patchPinnedPi({
  packageDirectory = defaultPackageDirectory,
  piAiPackageDirectory = defaultPiAiPackageDirectory,
  verifyOnly = false,
} = {}) {
  const codingAgentVersion = readVersion(packageDirectory);
  const piAiVersion = readVersion(piAiPackageDirectory);
  if (codingAgentVersion !== PINNED_PI_PATCH_VERSION || piAiVersion !== PINNED_PI_PATCH_VERSION) {
    throw new Error(
      `Pinned Pi patch requires coding-agent and pi-ai ${PINNED_PI_PATCH_VERSION}; found ${String(codingAgentVersion)} and ${String(piAiVersion)}.`,
    );
  }

  const states = PINNED_PI_PATCH_FILES.map((spec) => {
    const filePath = targetPath(spec, packageDirectory, piAiPackageDirectory);
    if (!fs.existsSync(filePath)) throw new Error(`Pinned Pi patch target is missing: ${filePath}`);
    const actualSha256 = sha256(filePath);
    if (actualSha256 === spec.patchedSha256) return { state: "patched", filePath };
    if (actualSha256 === spec.originalSha256) return { state: "original", filePath };
    throw new Error(
      `Pinned Pi patch refused drifted ${filePath}: expected ${spec.originalSha256} or ${spec.patchedSha256}, found ${actualSha256}.`,
    );
  });

  const patchedCount = states.filter(({ state }) => state === "patched").length;
  if (patchedCount === states.length) {
    return { changed: false, verified: true, files: states.map(({ filePath }) => filePath) };
  }
  if (patchedCount !== 0) {
    throw new Error("Pinned Pi patch refused a partially patched dependency tree.");
  }
  if (verifyOnly) {
    throw new Error("Pinned Pi 0.84.2 runtime fixes are not applied. Run npm ci.");
  }
  if (
    path.resolve(packageDirectory) !== path.resolve(defaultPackageDirectory) ||
    path.resolve(piAiPackageDirectory) !== path.resolve(defaultPiAiPackageDirectory)
  ) {
    throw new Error("Applying the pinned Pi patch is supported only in the repository install.");
  }

  const result = spawnSync("git", ["apply", "--unsafe-paths", "--whitespace=nowarn", patchPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Failed to apply ${patchPath}: ${result.error?.message ?? result.stderr?.trim() ?? `status ${String(result.status)}`}`,
    );
  }

  for (const spec of PINNED_PI_PATCH_FILES) {
    const filePath = targetPath(spec, packageDirectory, piAiPackageDirectory);
    const actualSha256 = sha256(filePath);
    if (actualSha256 !== spec.patchedSha256) {
      throw new Error(
        `Pinned Pi patch produced unexpected ${filePath}: expected ${spec.patchedSha256}, found ${actualSha256}.`,
      );
    }
  }
  return { changed: true, verified: true, files: states.map(({ filePath }) => filePath) };
}

function parseArgs(args) {
  const allowed = new Set(["--verify"]);
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  return { verifyOnly: args.includes("--verify") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = patchPinnedPi(parseArgs(process.argv.slice(2)));
    console.log(
      `[pinned-pi-patch] ${result.changed ? "Patched" : "Verified"} Pi ${PINNED_PI_PATCH_VERSION} runtime fixes`,
    );
  } catch (error) {
    console.error(`[pinned-pi-patch] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
