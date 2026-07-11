import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: resolve(__dirname, ".cache/vitest"),
  test: {
    environment: "node",
    // src/**/*.test.ts — the main/renderer/shared TypeScript suites.
    // resources/**/*.test.mjs — the SDK-host subprocess (plain ESM, not under
    //   src/, so the old glob silently excluded the entire host: trust resolver,
    //   command bridge, version gate).
    // tests/**/*.test.mts — test-harness units; distinct from Playwright's
    //   *.spec.mts files, so the two runners never collect each other's tests.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "resources/**/*.test.mjs",
      "tests/**/*.test.mts",
    ],
    globals: false,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
