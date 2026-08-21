#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const source = path.join(root, "resources", "pi-session-host");
const destination = path.join(root, "out", "resources", "pi-session-host");

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

const runtimeFiles = fs
  .readdirSync(source, { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs"),
  )
  .map((entry) => entry.name)
  .sort();

if (!runtimeFiles.includes("host.mjs")) {
  throw new Error(`SDK-host entry point is missing from ${source}`);
}
for (const file of runtimeFiles)
  fs.copyFileSync(path.join(source, file), path.join(destination, file));

console.log(`[copy-host] Copied ${runtimeFiles.length} runtime modules (tests excluded).`);
