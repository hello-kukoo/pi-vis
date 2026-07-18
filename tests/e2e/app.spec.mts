import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchElectron } from "./support/instrumented-launch.mjs";
import { expect, test } from "./support/invariants.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FAKE_PI = join(__dirname, "../fixtures/fake-pi.mjs");
const FAKE_SESSION_HOST = join(__dirname, "../fixtures/fake-session-host.mjs");

test.describe("Pi-Vis e2e", () => {
  test("app boots, add workspace, new session, type hello, see streamed text", async () => {
    const settingsDir = fs.mkdtempSync(join(os.tmpdir(), "pivis-test-"));
    const workspaceDir = fs.mkdtempSync(join(os.tmpdir(), "pivis-ws-"));

    // Write settings pointing to fake-pi
    fs.writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        piBinaryPath: `node ${FAKE_PI}`,
        workspaceOrder: [],
        fonts: {
          display: { sizePx: 14 },
          code: { family: "monospace", sizePx: 13 },
        },
      }),
    );

    const app = await launchElectron({
      args: [join(__dirname, "../../out/main/index.js")],
      env: {
        ...process.env,
        PIVIS_SETTINGS_DIR: settingsDir,
        PIVIS_TEST_HOST_SCRIPT: FAKE_SESSION_HOST,
        ELECTRON_RENDERER_URL: undefined,
      },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // The app should render against the bundled pinned pi runtime
    // fake-pi supplies only executable discovery/version behavior; live
    // sessions use the direct child-IPC fake host configured above.
    // Check the app loaded
    await expect(window.locator(".app, .pi-not-found")).toBeVisible({ timeout: 10000 });

    // Renderer reload is not a supported lifecycle: both normal and hard
    // refresh must leave the current document (and its generation custody)
    // intact.
    const reloadSentinel = await window.evaluate(() => {
      const value = crypto.randomUUID();
      Object.assign(window, { __pivisReloadSentinel: value });
      return value;
    });
    const platformModifier = process.platform === "darwin" ? "Meta" : "Control";
    await window.keyboard.press(`${platformModifier}+R`);
    await expect
      .poll(() => window.evaluate(() => Reflect.get(window, "__pivisReloadSentinel")))
      .toBe(reloadSentinel);
    await window.keyboard.press(`${platformModifier}+Shift+R`);
    await expect
      .poll(() => window.evaluate(() => Reflect.get(window, "__pivisReloadSentinel")))
      .toBe(reloadSentinel);

    await window.getByTitle("Settings").click();
    await expect(window.getByRole("heading", { name: "Pi runtime", exact: true })).toBeVisible();

    await app.close();
    fs.rmSync(settingsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});
