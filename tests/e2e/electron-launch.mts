import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { registerElectronPid, terminateElectronProcessTree } from "./electron-process-registry.mjs";

const require = createRequire(import.meta.url);

interface LaunchOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LaunchedElectronApplication {
  firstWindow(): Promise<Page>;
  close(): Promise<void>;
  process(): ChildProcess;
}

function waitForLine(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let outputTail = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${pattern}${outputTail ? `\nElectron output:\n${outputTail}` : ""}`,
        ),
      );
    }, timeoutMs);
    const onData = (data: Buffer) => {
      const text = data.toString();
      outputTail = `${outputTail}${text}`.slice(-8_000);
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(pattern);
        if (match?.[1]) {
          cleanup();
          resolve(match[1]);
          return;
        }
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Electron exited before ${pattern} (code=${code}, signal=${signal})${outputTail ? `\nElectron output:\n${outputTail}` : ""}`,
        ),
      );
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.stderr?.on("data", onData);
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

export async function launchElectron(options: LaunchOptions): Promise<LaunchedElectronApplication> {
  const appEntry = options.args?.[0];
  if (appEntry && !appEntry.startsWith("-") && !fs.existsSync(appEntry)) {
    throw new Error(
      `Electron app entry does not exist: ${appEntry}. Run \`npm run build\` before launching E2E.`,
    );
  }

  const electronPath = String(require("electron"));
  const env = {
    ...process.env,
    ...options.env,
    // Electron 43 rejects Playwright's old top-level --remote-debugging-port=0
    // argument. The app installs this value through app.commandLine instead.
    PIVIS_TEST_REMOTE_DEBUGGING_PORT: "0",
  };
  env.PIVIS_TEST_HIDE_WINDOW ??= env.PIVIS_TEST_SHOW_WINDOW === "1" ? "0" : "1";
  // pi runs tools under Electron's bundled Node mode. A child Electron app must
  // not inherit that flag, or the app's main process runs as plain Node and
  // require("electron") resolves to the npm package path.
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, options.args ?? [], {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // A dedicated process group lets cleanup terminate Electron helpers and
    // app-owned subprocesses instead of only the browser process.
    detached: process.platform !== "win32",
  });
  const pid = child.pid;
  if (pid) registerElectronPid(pid);

  let browser: Browser;
  try {
    const cdpUrl = await waitForLine(child, /^DevTools listening on (ws:\/\/.*)$/, 15_000);
    // Keep draining both pipes after finding the CDP URL. An unread full pipe
    // can block Electron and make an otherwise healthy test appear hung.
    child.stdout?.resume();
    child.stderr?.resume();
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    child.stdout?.resume();
    child.stderr?.resume();
    if (pid) await terminateElectronProcessTree(pid);
    throw error;
  }

  const app: LaunchedElectronApplication = {
    async firstWindow() {
      const context = browser.contexts()[0] ?? (await waitForContext(browser));
      const existing = context.pages()[0];
      if (existing) return existing;
      return context.waitForEvent("page", { timeout: 15_000 });
    },
    async close() {
      await browser.close().catch(() => undefined);
      if (pid) await terminateElectronProcessTree(pid);
    },
    process() {
      return child;
    },
  };

  return app;
}

async function waitForContext(browser: Browser) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const context = browser.contexts()[0];
    if (context) return context;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Electron browser context");
}
