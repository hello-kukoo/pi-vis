import { type Page, expect, test } from "@playwright/test";

async function trackRenderEntryQueries(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      __renderEntryQueries: number;
      pivis: { invoke: (channel: string, args?: unknown) => Promise<unknown> };
    };
    target.__renderEntryQueries = 0;
    const originalInvoke = target.pivis.invoke.bind(target.pivis);
    target.pivis.invoke = (channel, args) => {
      const query = (args as { query?: { type?: unknown } } | undefined)?.query;
      if (channel === "session.query" && query?.type === "render_entry") {
        target.__renderEntryQueries += 1;
      }
      return originalInvoke(channel, args);
    };
  });
}

test.describe("Pi 0.80.10 extension entry inspectors", () => {
  test("keeps an app-owned raw card collapsed and queries the renderer only after opening", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/?customEntry=1");

    const entry = page.locator(".custom-entry");
    const card = entry.locator(".tool-card");
    const header = card.getByRole("button", { name: "status-card extension entry details" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(header).toHaveAttribute("aria-expanded", "false");
    const controlledId = await header.getAttribute("aria-controls");
    expect(controlledId).toBeTruthy();
    await expect(card.locator(".tool-card__body")).toHaveCount(0);
    await expect(card.locator(".tool-card__extension-render")).toHaveCount(0);
    await expect(card).not.toContainText("Indexed files: 17");
    await trackRenderEntryQueries(page);
    await page.evaluate(() => {
      (
        window as unknown as {
          __pivisPreview: {
            replaceCustomEntryRuntime: (available: boolean, version?: number) => void;
          };
        }
      ).__pivisPreview.replaceCustomEntryRuntime(true, 2);
    });
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(
        () => (window as unknown as { __renderEntryQueries: number }).__renderEntryQueries,
      ),
    ).toBe(0);

    await header.click();

    const body = card.locator(".tool-card__body");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();
    await expect(header).toHaveAttribute("aria-controls", await body.getAttribute("id"));
    await expect(card).toContainText("preview-custom-entry");
    await expect(card).toContainText('"title": "Indexed files"');
    await expect(card).toContainText('"count": 17');
    await expect(card.locator(".tool-card__extension-render")).toContainText("Indexed files: 17");
    await expect(card.locator(".tool-card__extension-render")).toContainText(
      /Rendered responsively at \d+ columns/,
    );
    await expect(card.locator(".tool-card__extension-render span").first()).toHaveCSS(
      "font-weight",
      "700",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __renderEntryQueries: number }).__renderEntryQueries,
        ),
      )
      .toBeGreaterThan(0);
    await expect(card.locator("details")).toHaveCount(0);

    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(body).toHaveCount(0);
  });

  test("retains the raw record when renderer ownership disappears and re-renders on reopen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/?customEntry=1");

    const entry = page.locator(".custom-entry");
    const card = entry.locator(".tool-card");
    const header = card.getByRole("button", { name: "status-card extension entry details" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await header.click();
    await expect(card.locator(".tool-card__extension-render")).toContainText("renderer v1");
    await expect(card).toContainText('"count": 17');

    await page.evaluate(() => {
      const preview = (
        window as unknown as {
          __pivisPreview: {
            replaceCustomEntryRuntime: (available: boolean, version?: number) => void;
          };
        }
      ).__pivisPreview;
      preview.replaceCustomEntryRuntime(false);
    });
    await expect(card).toBeVisible();
    await expect(card).toContainText('"title": "Indexed files"');
    await expect(card.locator(".tool-card__extension-render")).toHaveCount(0);

    await header.click();
    await page.evaluate(() => {
      const preview = (
        window as unknown as {
          __pivisPreview: {
            replaceCustomEntryRuntime: (available: boolean, version?: number) => void;
          };
        }
      ).__pivisPreview;
      preview.replaceCustomEntryRuntime(true, 2);
    });
    await expect(card.locator(".tool-card__body")).toHaveCount(0);

    await header.click();
    await expect(card.locator(".tool-card__extension-render")).toContainText("renderer v2");
    await expect(card).toContainText('"count": 17');
  });

  test("measures extension columns using the configured code font", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/?customEntry=1");

    const entry = page.locator(".custom-entry");
    const card = entry.locator(".tool-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-size-code-root", "28px");
      document.documentElement.style.setProperty("--font-code", "monospace");
    });
    await card.getByRole("button", { name: "status-card extension entry details" }).click();

    const renderedCols = async (): Promise<number> => {
      const text = (await card.locator(".tool-card__extension-render").textContent()) ?? "";
      return Number(/Rendered responsively at (\d+) columns/.exec(text)?.[1] ?? 0);
    };
    await expect.poll(renderedCols).toBeLessThan(70);
    const largeFontCols = await renderedCols();

    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-size-code-root", "14px");
    });
    await page.setViewportSize({ width: 1099, height: 800 });
    await expect.poll(renderedCols).toBeGreaterThan(largeFontCols + 20);
  });
});
