#!/usr/bin/env node
/**
 * Minimal fake pi executable for locate/version/update tests.
 *
 * This fixture intentionally has no session, stdin JSONL, or RPC behavior.
 * Electron E2E sessions use fake-session-host.mjs over child-process IPC.
 */
import fs from "node:fs";

function readPinnedVersion() {
  const file = process.env.FAKE_PI_VERSION_FILE;
  if (file) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // The update stamp has not been written yet.
    }
  }
  return process.env.FAKE_PI_VERSION ?? null;
}

if (process.argv.includes("--version")) {
  const pinned = readPinnedVersion();
  process.stdout.write(pinned ? `${pinned}\n` : "fake-pi 1.0.0\n");
  process.exit(0);
}

if (process.argv.includes("update")) {
  process.stdout.write(`ARGV ${process.argv.slice(2).join(" ")}\n`);
  process.stdout.write("Checking for updates...\n");

  if (process.env.FAKE_PI_UPDATE_HANG === "1") {
    setInterval(() => {}, 1 << 30);
  } else {
    const exitOverride = process.env.FAKE_PI_UPDATE_EXIT;
    setTimeout(() => {
      if (exitOverride !== undefined) {
        process.stderr.write("Update failed.\n");
        process.exit(Number.parseInt(exitOverride, 10) || 1);
      }
      const nextVersion = process.env.FAKE_PI_UPDATE_TO ?? "2.0.0";
      if (process.env.FAKE_PI_VERSION_FILE) {
        fs.writeFileSync(process.env.FAKE_PI_VERSION_FILE, `${nextVersion}\n`);
      }
      process.stdout.write(`Updated pi to ${nextVersion}\n`);
      process.exit(0);
    }, 20);
  }
} else {
  process.stderr.write("fake-pi only supports --version and update\n");
  process.exit(2);
}
