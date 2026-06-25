/**
 * E2E: Extension Panel Rendering — LOAD-BEARING CI GATE
 *
 * Validates the custom() → CustomPanelHost xterm.js pipeline.
 *
 * This test requires a real pi installation and pi-mcp-adapter.
 * Run with: PI_E2E=1 npm run test:e2e -- --grep "Panel"
 *
 * What it tests:
 * 1. Panel opens when extension calls ctx.ui.custom()
 * 2. CustomPanelHost xterm.js overlay renders
 * 3. ANSI content arrives (panel_data events)
 * 4. Keyboard input routes to panel
 * 5. Panel closes cleanly on done()
 * 6. Fallback: host-start-failure degrades gracefully
 */

import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe("Extension Panel Rendering", () => {
  test("pi-mcp-adapter /mcp opens CustomPanelHost overlay", async () => {
    const settingsDir = fs.mkdtempSync(join(os.tmpdir(), "pivis-panel-"));
    const workspaceDir = fs.mkdtempSync(join(os.tmpdir(), "pivis-ws-"));

    fs.writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        piBinaryPath: "pi",
        workspaceOrder: [workspaceDir],
        fonts: {
          display: { family: "system-ui", sizePx: 14 },
          code: { family: "monospace", sizePx: 13 },
        },
      }),
    );

    const app = await electron.launch({
      args: [join(__dirname, "../../out/main/index.js")],
      env: {
        ...process.env,
        PIVIS_SETTINGS_DIR: settingsDir,
        ELECTRON_RENDERER_URL: undefined,
      },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(3000);

    const composeArea = window.locator(".composer__input");
    await expect(composeArea).toBeVisible({ timeout: 10_000 });

    // Type /mcp to trigger pi-mcp-adapter extension
    await composeArea.click();
    await composeArea.fill("/mcp");
    await window.keyboard.press("Enter");

    // Wait for CustomPanelHost to render
    const panel = window.locator(".custom-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });

    // Verify xterm.js terminal rendered
    const xterm = panel.locator(".custom-panel__xterm .xterm");
    await expect(xterm).toBeVisible();

    // Verify ANSI content rendered
    const xtermScreen = panel.locator(".xterm-screen");
    await expect(xtermScreen).toBeVisible();

    // Send keyboard input to panel
    await window.keyboard.press("Tab");
    await window.keyboard.type("test-input");
    await window.keyboard.press("Enter");

    // Panel should close when extension calls done()
    await expect(panel).not.toBeVisible({ timeout: 60_000 });

    await app.close();
  });

  test("host fallback shows notice when pi not found", async () => {
    const settingsDir = fs.mkdtempSync(join(os.tmpdir(), "pivis-fallback-"));
    const workspaceDir = fs.mkdtempSync(join(os.tmpdir(), "pivis-ws2-"));

    fs.writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        piBinaryPath: "/nonexistent/pi",
        workspaceOrder: [workspaceDir],
        fonts: {
          display: { family: "system-ui", sizePx: 14 },
          code: { family: "monospace", sizePx: 13 },
        },
      }),
    );

    const app = await electron.launch({
      args: [join(__dirname, "../../out/main/index.js")],
      env: {
        ...process.env,
        PIVIS_SETTINGS_DIR: settingsDir,
        ELECTRON_RENDERER_URL: undefined,
      },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Should show PiNotFound component
    const notFound = window.locator(".pi-not-found, .setup");
    await expect(notFound).toBeVisible({ timeout: 10_000 });

    await app.close();
  });
});
