import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

/**
 * Renderer render tests — headless chromium against the Vite dev server
 * (`npm run dev:renderer`), which serves the real React app with a stubbed
 * `window.pivis` (src/renderer/src/preview-stub.ts). No Electron, no real pi:
 * the stub drives deterministic panel/event flows so the REAL renderer
 * (UnifiedTuiHost → xterm.js, store reducer, App slot logic) is exercised.
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: "*.spec.mts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  use: {
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev:renderer -- --host 127.0.0.1 --port 7317 --strictPort",
    url: "http://127.0.0.1:7317/",
    cwd: root,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
