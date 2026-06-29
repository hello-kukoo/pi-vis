/**
 * Render test: ESC-to-interrupt timing + unified-panel interception.
 *
 * Two cases jsdom unit tests cannot reproduce:
 *  (a) Two-press under rapid ESC — pins that `useEscapeClaim` uses
 *      `useLayoutEffect` (a passive `useEffect` would swallow the 2nd ESC).
 *  (b) Unified-panel interception — pins the renderer-only decision: a
 *      capture-phase window ESC handler preempts xterm's input while
 *      streaming, while idle ESC still reaches the host editor.
 *
 * Drives the REAL renderer (served by `npm run dev:renderer`) with the
 * stubbed `window.pivis`. Test hooks live on `window.__pivisPreview`
 * (see preview-stub.ts).
 */
import { expect, test } from "@playwright/test";

type PreviewHooks = {
  abortCalls: number;
  panelInputLog: string[];
  startStreaming: () => void;
  stopStreaming: () => void;
};

async function getHooks(page: import("@playwright/test").Page): Promise<PreviewHooks> {
  return page.evaluate(() => {
    return (window as unknown as { __pivisPreview: PreviewHooks }).__pivisPreview;
  });
}

test.describe("ESC-to-interrupt — renderer", () => {
  test("(a) two-press under rapid ESC: first closes autocomplete, second aborts", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:7317/");
    await page.waitForLoadState("domcontentloaded");
    // Wait for the composer to mount.
    const textarea = page.locator(".composer__textarea");
    await expect(textarea).toBeVisible({ timeout: 20_000 });

    // Start a fake turn so isStreaming is true on the active session.
    await page.evaluate(() => {
      (window as unknown as { __pivisPreview: PreviewHooks }).__pivisPreview.startStreaming();
    });

    // Focus the composer and type "/" to open the autocomplete.
    await textarea.focus();
    await textarea.fill("/");
    await expect(page.locator(".composer__suggestion").first()).toBeVisible({
      timeout: 5_000,
    });

    // First ESC closes autocomplete. (useLayoutEffect guarantees the claim
    // is released within this turn, so the second ESC reaches the interrupt
    // path, not the deferred one — the pin against a passive useEffect.)
    await page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(".composer__textarea")!;
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await expect(page.locator(".composer__suggestion")).toHaveCount(0);

    // Second ESC aborts the running turn.
    const beforeAbort = (await getHooks(page)).abortCalls;
    await page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(".composer__textarea")!;
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    const hooks = await getHooks(page);
    expect(hooks.abortCalls).toBeGreaterThan(beforeAbort);
  });

  test("(b) unified-panel + streaming: ESC aborts and does NOT forward to panelInput", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:7317/?unified=1");
    await page.waitForLoadState("domcontentloaded");
    const panel = page.locator(".unified-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // Start streaming.
    await page.evaluate(() => {
      (window as unknown as { __pivisPreview: PreviewHooks }).__pivisPreview.startStreaming();
    });

    // Dispatch ESC at the window level (the global capture handler is what
    // we're pinning — it preempts regardless of where focus is, which is the
    // renderer-only decision).
    const before = (await getHooks(page)).abortCalls;
    const beforeInput = (await getHooks(page)).panelInputLog.length;
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    const afterStreaming = await getHooks(page);
    // Streaming ESC aborted the turn.
    expect(afterStreaming.abortCalls).toBeGreaterThan(before);
    // And it did NOT forward an ESC byte to the host editor (the capture
    // handler preempted the path). The idle autocomplete-cancel path is
    // covered by the host-side unified-tui.test.mjs gate.
    expect(afterStreaming.panelInputLog.length).toBe(beforeInput);
  });
});
