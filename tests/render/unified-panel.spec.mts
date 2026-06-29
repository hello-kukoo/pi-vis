/**
 * Render test: the factory-`setWidget` unified-TUI panel mounts UnifiedTuiHost
 * and renders streamed panel_data into xterm.js.
 *
 * Drives the REAL renderer (served by `npm run dev:renderer` with the stubbed
 * window.pivis) with headless chromium — no Electron, no real pi. The preview
 * stub (?unified=1) emits the panel_open{unified} + panel_data events an
 * extension's factory setWidget produces, so this exercises the exact path:
 * session.panelEvent subscription → store handlePanelEvent → hasUnifiedPanel →
 * UnifiedTuiHost → xterm.js render. This is the regression gate for
 * "the composer was replaced by nothing" failures.
 */
import { expect, test } from "@playwright/test";

test.describe("Unified-TUI panel (factory setWidget) — renderer", () => {
  test("mounts UnifiedTuiHost with rendered roster content, replacing the composer", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:7317/?unified=1");
    await page.waitForLoadState("domcontentloaded");

    // The unified panel replaces the Composer in the flex slot.
    const panel = page.locator(".unified-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // While a factory widget is live the native composer is NOT rendered.
    await expect(page.locator(".composer__textarea")).toHaveCount(0);

    // xterm.js mounted inside the unified panel.
    await expect(panel.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    // The streamed panel_data (the fake roster) rendered as glyphs in xterm.
    // The roster is emitted by preview-stub's startUnifiedPanelPreview().
    await expect(panel.locator(".xterm-rows")).toContainText("Fleet", { timeout: 15_000 });
    await expect(panel.locator(".xterm-rows")).toContainText("swift-otter");
  });

  test("a short roster: card hugs the content, no scroll (trailing blanks trimmed)", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:7317/?unified=1");
    await page.waitForLoadState("domcontentloaded");

    const panel = page.locator(".unified-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator(".xterm-rows")).toContainText("Fleet", { timeout: 15_000 });

    // The grid tracks the content (mount holds it + a one-row sentinel); the card
    // clips down to the content. A few-row roster is well under the ~50%-column
    // cap, so the card is shorter than the mount (the gap is the trimmed blanks)
    // and is NOT scrollable (overflow hidden).
    const m = await page.evaluate(() => {
      const card = document.querySelector(".unified-panel") as HTMLElement;
      const mount = document.querySelector(".unified-panel .custom-panel__xterm") as HTMLElement;
      return {
        cardH: card.getBoundingClientRect().height,
        mountH: mount.getBoundingClientRect().height,
        overflowY: card.style.overflowY,
      };
    });
    expect(m.cardH).toBeGreaterThan(0);
    expect(m.cardH).toBeLessThan(m.mountH);
    expect(m.overflowY).toBe("hidden");
  });

  test("a tall roster: card caps at the max, scrolls, and keeps the top reachable", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:7317/?unified=tall");
    await page.waitForLoadState("domcontentloaded");

    const panel = page.locator(".unified-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator(".xterm-rows")).toContainText("agent-01", { timeout: 15_000 });

    // Content taller than the cap → the card caps at ~half the column and
    // scrolls (the spec's "scrollbar only past the max"). It opens scrolled to
    // the TOP so the header row is visible — the bug being guarded is the host
    // bottom-anchoring and the top scrolling out of view.
    const m = await page.evaluate(() => {
      const card = document.querySelector(".unified-panel") as HTMLElement;
      const session = document.querySelector(".app__session") as HTMLElement;
      const first = document.querySelector(
        ".unified-panel .xterm-rows > div",
      ) as HTMLElement | null;
      return {
        cardH: card.getBoundingClientRect().height,
        sessionH: session.clientHeight,
        overflowY: card.style.overflowY,
        scrollTop: card.scrollTop,
        scrollable: card.scrollHeight - card.clientHeight,
        firstRow: first?.innerText ?? "",
      };
    });
    expect(m.overflowY).toBe("auto");
    // Capped near the ~50% display max, not the full content height.
    expect(m.cardH).toBeLessThanOrEqual(m.sessionH * 0.5 + 4);
    // Scrollable, opened at the top, header in view.
    expect(m.scrollable).toBeGreaterThan(0);
    expect(m.scrollTop).toBe(0);
    expect(m.firstRow).toContain("Fleet");
  });

  test("an overlay (viewport mode): the grid pins to a fixed screen, not the small box", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:7317/?unified=overlay");
    await page.waitForLoadState("domcontentloaded");

    const panel = page.locator(".unified-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // The overlay box painted into the panel.
    await expect(panel.locator(".xterm-rows")).toContainText("inspect", { timeout: 15_000 });

    // In viewport mode the renderer pins a FIXED grid (the ~50%-column display
    // cap) instead of hugging the 3-row box — this is the wiggle fix. So the
    // card is the full cap height (NOT a few-row box height) and does NOT scroll.
    // The contrast with the "short roster" test (where the card hugs down to the
    // content) is exactly what distinguishes viewport-pin from content-tracking.
    const m = await page.evaluate(() => {
      const card = document.querySelector(".unified-panel") as HTMLElement;
      const session = document.querySelector(".app__session") as HTMLElement;
      return {
        cardH: card.getBoundingClientRect().height,
        sessionH: session.clientHeight,
        overflowY: card.style.overflowY,
      };
    });
    // Pinned near the cap — far taller than a 3-row box would hug to.
    expect(m.cardH).toBeGreaterThan(m.sessionH * 0.4);
    expect(m.cardH).toBeLessThanOrEqual(m.sessionH * 0.5 + 4);
    expect(m.overflowY).toBe("hidden");
  });

  test("UnifiedViewToggle switches between the panel and the native composer", async ({ page }) => {
    await page.goto("http://127.0.0.1:7317/?unified=1");
    await page.waitForLoadState("domcontentloaded");

    // While a unified panel is live, the view switcher is in the right-side
    // controls cluster of the session header, before the changes button.
    const toggle = page.locator(".unified-toggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });

    // Verify it's in the controls cluster (right side of header)
    const toggleInControls = page.locator(".session-header__controls .unified-toggle");
    await expect(toggleInControls).toBeVisible();

    // Verify labels are "Extension" and "Input"
    await expect(toggle.getByRole("tab", { name: "Extension" })).toBeVisible();
    await expect(toggle.getByRole("tab", { name: "Input" })).toBeVisible();

    // Default: unified panel visible (Extension selected), composer absent.
    await expect(page.locator(".unified-panel")).toBeVisible();
    await expect(page.locator(".composer__textarea")).toHaveCount(0);
    await expect(toggle.getByRole("tab", { name: "Extension" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Click "Input" → the native Composer takes the slot, the panel unmounts.
    await toggle.getByRole("tab", { name: "Input" }).click();
    await expect(page.locator(".composer__textarea")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".unified-panel")).toHaveCount(0);
    await expect(toggle.getByRole("tab", { name: "Input" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Click "Extension" → back to the unified TUI.
    await toggle.getByRole("tab", { name: "Extension" }).click();
    await expect(page.locator(".unified-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".composer__textarea")).toHaveCount(0);
    await expect(toggle.getByRole("tab", { name: "Extension" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
