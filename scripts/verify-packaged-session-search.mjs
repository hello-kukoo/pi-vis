import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const scriptPath = fileURLToPath(import.meta.url);

async function runWorker(workerPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-packaged-search-"));
  const worker = new Worker(workerPath);
  let nextId = 0;
  const pending = new Map();
  worker.on("message", (message) => {
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  worker.on("error", (error) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: error.message });
    pending.clear();
  });
  const request = (message) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      worker.postMessage({ id, ...message });
    });
  try {
    const initialized = await request({ type: "initialize", databaseDirectory: root });
    const status = await request({ type: "status" });
    if (!initialized.ok || initialized.type !== "initialized" || !status.ok) {
      throw new Error(`Packaged worker failed: ${JSON.stringify({ initialized, status })}`);
    }
    console.log(
      JSON.stringify({
        electron: process.versions.electron,
        initialized: initialized.type,
        sqliteFtsWorker: "ready",
      }),
    );
    await request({ type: "shutdown" });
  } finally {
    await worker.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--inner") {
  await runWorker(path.resolve(process.argv[3]));
} else {
  const appBundle = process.argv[2];
  if (!appBundle) {
    throw new Error("Usage: node scripts/verify-packaged-session-search.mjs <path-to-Pi-Vis.app>");
  }
  const executable = path.join(appBundle, "Contents", "MacOS", "Pi-Vis");
  const workerPath = path.join(
    appBundle,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "out",
    "main",
    "session-search-worker.js",
  );
  for (const required of [executable, workerPath]) {
    if (!fs.existsSync(required)) throw new Error(`Missing packaged artifact: ${required}`);
  }
  const result = spawnSync(executable, [scriptPath, "--inner", workerPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
