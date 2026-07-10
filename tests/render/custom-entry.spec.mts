import { expect, test } from "@playwright/test";

test.describe("Pi 0.80.4 extension entry renderers", () => {
  test("renders and expands a persisted display-only custom entry", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/?customEntry=1");

    const entry = page.locator(".custom-entry--visible");
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("Indexed files: 17");
    await expect(entry.locator(".custom-entry__content span").first()).toHaveCSS(
      "font-weight",
      "700",
    );

    const toggle = entry.getByRole("button", { name: "Expand status-card extension entry" });
    await toggle.click();
    await expect(entry).toContainText(/Rendered responsively at \d+ columns/);
    await expect(
      entry.getByRole("button", { name: "Collapse status-card extension entry" }),
    ).toBeVisible();
  });

  test("re-renders or hides entries when the session runtime is replaced", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/?customEntry=1");

    const entry = page.locator(".custom-entry");
    await expect(entry).toHaveClass(/custom-entry--visible/);
    await expect(entry).toContainText("renderer v1");

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
    await expect(entry).not.toHaveClass(/custom-entry--visible/);

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
    await expect(entry).toHaveClass(/custom-entry--visible/);
    await expect(entry).toContainText("renderer v2");
  });

  test("measures columns using the configured code font", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/?customEntry=1");

    const entry = page.locator(".custom-entry--visible");
    await expect(entry).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-size-code-root", "28px");
      document.documentElement.style.setProperty("--font-code", "monospace");
    });
    await entry.getByRole("button", { name: "Expand status-card extension entry" }).click();

    const renderedCols = async (): Promise<number> => {
      const text = (await entry.textContent()) ?? "";
      return Number(/Rendered responsively at (\d+) columns/.exec(text)?.[1] ?? 0);
    };
    await expect.poll(renderedCols).toBeLessThan(70);
    const largeFontCols = await renderedCols();

    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-size-code-root", "14px");
    });
    await expect.poll(renderedCols).toBeGreaterThan(largeFontCols + 20);
  });
});
