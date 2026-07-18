import { parentPort } from "node:worker_threads";
import type { ExtensionUpdate } from "@shared/extension-updates.js";
import { checkUserExtensionUpdates } from "./extension-update-check.js";

export interface ExtensionUpdateWorkerRequest {
  cwd: string;
}

export type ExtensionUpdateWorkerResponse =
  | { ok: true; updates: ExtensionUpdate[] }
  | { ok: false; error: string };

if (!parentPort) {
  throw new Error("Extension update worker requires a parent port");
}

parentPort.once("message", async ({ cwd }: ExtensionUpdateWorkerRequest) => {
  try {
    // Extension checks are deliberately user-scoped. Project settings remain
    // deny-by-default and are never read merely because Settings was opened.
    const updates = await checkUserExtensionUpdates(cwd);
    parentPort?.postMessage({ ok: true, updates } satisfies ExtensionUpdateWorkerResponse);
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ExtensionUpdateWorkerResponse);
  }
});
