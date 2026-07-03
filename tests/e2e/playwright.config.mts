import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));

const optInIgnores = [
  ...(process.env["REAL_PI_VERIFY"] === "1" ? [] : ["real-pi-verify.spec.mts"]),
  ...(process.env["PI_E2E"] === "1" ? [] : ["panels-real.spec.mts"]),
];

export default defineConfig({
  testDir: __dirname,
  testMatch: "*.spec.mts",
  testIgnore: optInIgnores,
  globalTeardown: join(__dirname, "global-teardown.mts"),
  timeout: 30_000,
  use: {
    trace: "on-first-retry",
  },
});
