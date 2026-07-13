import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const cacheDir = (name: string) => resolve(".cache", name);

export default defineConfig({
  main: {
    cacheDir: cacheDir("electron-vite-main"),
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "session-search-benchmark-api": resolve(
            "src/main/sessions/session-search/benchmark-api.ts",
          ),
          "session-search-worker": resolve("src/main/sessions/session-search/index-worker.ts"),
        },
        output: { entryFileNames: "[name].js" },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    cacheDir: cacheDir("electron-vite-preload"),
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    cacheDir: cacheDir("electron-vite-renderer"),
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
