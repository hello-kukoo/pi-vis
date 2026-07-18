import { expect, test } from "@playwright/test";

test.describe("Title-bar surfaces", () => {
  test("rename input preserves the clicked label geometry", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".composer__textarea")).toBeEnabled();

    const button = page.locator(".session-header__name-btn");
    await expect(button).toBeEnabled();
    const before = await button.evaluate((element) => {
      const content = element.querySelector(".fade-text__inner");
      if (!content) throw new Error("session title content unavailable");
      content.textContent = "A deliberately long session title that used to jump while editing";
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const contentX =
        rect.x + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
      const contentWidth =
        rect.width -
        Number.parseFloat(style.borderLeftWidth) -
        Number.parseFloat(style.borderRightWidth) -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      (element as HTMLButtonElement).click();
      return { x: rect.x, width: rect.width, contentX, contentWidth };
    });

    const input = page.locator(".session-header__name-input");
    await expect(input).toBeFocused();
    const after = await input.boundingBox();
    if (!after) throw new Error("session title input has no box");
    const afterContent = await input.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft),
        width:
          rect.width -
          Number.parseFloat(style.borderLeftWidth) -
          Number.parseFloat(style.borderRightWidth) -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
      };
    });
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(afterContent.x - before.contentX)).toBeLessThan(1);
    expect(Math.abs(afterContent.width - before.contentWidth)).toBeLessThan(1);
  });

  test("title, context, and Workspace popups rise above an open viewer", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".composer__textarea")).toBeEnabled();
    await page.evaluate(() => {
      type Session = { sessionFile?: string; isNewPending?: boolean };
      type PreviewStore = {
        getState: () => { activeSessionId: string | null; sessions: Map<string, Session> };
        setState: (next: { sessions: Map<string, Session> }) => void;
      };
      const store = (window as unknown as { __pivisStore: PreviewStore }).__pivisStore;
      const state = store.getState();
      const id = state.activeSessionId;
      const session = id ? state.sessions.get(id) : undefined;
      if (!id || !session) throw new Error("preview session unavailable");
      const sessions = new Map(state.sessions);
      sessions.set(id, {
        ...session,
        sessionFile: "/tmp/preview-session.jsonl",
        isNewPending: false,
      });
      store.setState({ sessions });
    });
    await expect(page.locator('[data-testid="worktree-switcher-trigger"]')).toBeVisible();
    await page.locator('[data-testid="changes-button"]').click();
    await expect(page.locator(".diff-viewer")).toBeVisible();

    const assertAboveViewer = async (popupSelector: string): Promise<void> => {
      const popup = page.locator(popupSelector);
      await expect(popup).toBeVisible();
      const result = await popup.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const header = element.closest(".session-header");
        const viewer = document.querySelector(".diff-overlay");
        return {
          popupOwnsHit: hit !== null && element.contains(hit),
          headerZ: header ? Number.parseInt(getComputedStyle(header).zIndex, 10) : 0,
          viewerZ: viewer ? Number.parseInt(getComputedStyle(viewer).zIndex, 10) : 0,
        };
      });
      expect(result.popupOwnsHit).toBe(true);
      expect(result.headerZ).toBeGreaterThan(result.viewerZ);
    };

    await page.locator(".session-header__model-btn").click();
    await assertAboveViewer(".session-header__dropdown");
    await page.locator(".session-header__model-btn").click();
    await expect(page.locator(".diff-viewer")).toBeVisible();

    await page.locator(".context-ring").click();
    await assertAboveViewer(".context-dropdown");
    await page.locator(".context-ring").click();
    await expect(page.locator(".diff-viewer")).toBeVisible();

    await page.locator('[data-testid="worktree-switcher-trigger"]').click();
    await assertAboveViewer(".worktree-switcher__card");
    await page.locator('[data-testid="worktree-switcher-trigger"]').click();
    await expect(page.locator(".diff-viewer")).toBeVisible();
  });
});
