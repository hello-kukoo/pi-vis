import { defineConfig } from "@playwright/test";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: __dirname,
  testMatch: "*.spec.ts",
  timeout: 30_000,
  use: {
    trace: "on-first-retry",
  },
});
