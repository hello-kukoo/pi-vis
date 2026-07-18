import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

interface PreviewStoreState {
  activeSessionId: string;
  setSessionName: (sessionId: string, name: string) => void;
  seedHistory: (sessionId: string, history: Array<Record<string, unknown>>) => void;
}

async function setLongTitle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as { __pivisStore: { getState: () => PreviewStoreState } })
      .__pivisStore;
    const state = store.getState();
    state.setSessionName(
      state.activeSessionId,
      "A very long session title that should fade instead of forcing the application grid wider than the viewport when the sidebar is collapsed",
    );
  });
}

async function seedHorizontalRuleMessage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as { __pivisStore: { getState: () => PreviewStoreState } })
      .__pivisStore;
    const state = store.getState();
    state.seedHistory(state.activeSessionId, [
      {
        id: "hr-assistant",
        type: "assistant",
        data: { content: "Before\n\n* * *\n\nAfter" },
      },
    ]);
  });
}

async function seedHierarchicalMarkdownMessage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as { __pivisStore: { getState: () => PreviewStoreState } })
      .__pivisStore;
    const state = store.getState();
    state.seedHistory(state.activeSessionId, [
      {
        id: "hierarchical-markdown-assistant",
        type: "assistant",
        data: {
          thinking: "# Thinking H1\n\n> ## Thinking quoted H2",
          content: [
            "# H1",
            "## H2",
            "### H3",
            "#### H4",
            "##### H5",
            "###### H6",
            "",
            "> # Quoted H1",
            "> ## Quoted H2",
            "> Paragraph with `inline code`.",
            "",
            "- List item",
            "  > ### Heading in quote in list",
          ].join("\n"),
        },
      },
    ]);
  });
}

test.describe("layout overflow and markdown separators", () => {
  test("dropping an operating-system file stages it in the composer", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".composer")).toBeVisible({ timeout: 20_000 });
    // File staging is runtime-backed even though the textarea is intentionally
    // usable before authority attaches. Wait for the same readiness gate as
    // the attachment button before asserting the enabled drop treatment.
    await expect(page.locator(".composer__attach-btn")).toBeEnabled({ timeout: 20_000 });

    await page.locator(".composer").evaluate((composer) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["drop content"], "dropped-notes.txt", { type: "text/plain" }));
      Reflect.set(window, "__pivisDropTransfer", transfer);
      composer.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    });
    await expect(page.locator(".composer__file-drop")).toContainText("Drop files to attach");
    await page.locator(".composer").evaluate((composer) => {
      const transfer = Reflect.get(window, "__pivisDropTransfer") as DataTransfer;
      composer.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      Reflect.deleteProperty(window, "__pivisDropTransfer");
    });

    await expect(page.locator(".composer__file-drop")).toHaveCount(0);
    await expect(page.locator(".composer__attachment-item--file")).toHaveCount(1);
    await expect(page.locator(".composer__file-attachment")).toHaveAttribute(
      "title",
      "dropped-notes.txt",
    );
  });

  test("collapsing the sidebar with a fading long title does not widen or clip the main grid", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 780, height: 620 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".composer")).toBeVisible({ timeout: 20_000 });

    await setLongTitle(page);
    await expect(page.locator(".fade-text[data-overflow='true']").first()).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(page.locator(".app--sidebar-collapsed")).toBeVisible();

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const viewport = window.innerWidth;
          const selectors = [".titlebar", ".app__main", ".transcript-region", ".composer"];
          return selectors.map((selector) => {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (!el) return { selector, ok: false, left: Number.NaN, right: Number.NaN, viewport };
            const rect = el.getBoundingClientRect();
            return {
              selector,
              ok: rect.left >= -1 && rect.right <= viewport + 1,
              left: rect.left,
              right: rect.right,
              viewport,
            };
          });
        });
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ selector: ".titlebar", ok: true }),
          expect.objectContaining({ selector: ".app__main", ok: true }),
          expect.objectContaining({ selector: ".transcript-region", ok: true }),
          expect.objectContaining({ selector: ".composer", ok: true }),
        ]),
      );
  });

  test("markdown thematic breaks render as the styled separator, not a default thick rule", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 620 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".composer")).toBeVisible({ timeout: 20_000 });
    await seedHorizontalRuleMessage(page);

    const hr = page.locator(".transcript-block__content hr");
    await expect(hr).toHaveCount(1);
    await expect
      .poll(() =>
        hr.evaluate((el) => {
          const style = getComputedStyle(el as HTMLElement);
          return {
            height: style.height,
            borderTopWidth: style.borderTopWidth,
            backgroundImage: style.backgroundImage,
          };
        }),
      )
      .toEqual(
        expect.objectContaining({
          height: "1px",
          borderTopWidth: "0px",
          backgroundImage: expect.stringContaining("linear-gradient"),
        }),
      );
  });

  test("transcript markdown headings compose with quote and thinking voice", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".composer")).toBeVisible({ timeout: 20_000 });
    await seedHierarchicalMarkdownMessage(page);

    await expect(page.locator(".transcript-block__content.markdown-body h4")).toHaveText("H4");
    await expect(page.locator(".transcript-block__content.markdown-body h6")).toHaveText("H6");

    await expect
      .poll(() =>
        page.evaluate(() => {
          const px = (selector: string) => {
            const el = document.querySelector(selector) as HTMLElement | null;
            return el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0;
          };
          return {
            h1: px(".transcript-block__content.markdown-body > h1"),
            h2: px(".transcript-block__content.markdown-body > h2"),
            h3: px(".transcript-block__content.markdown-body > h3"),
            h4: px(".transcript-block__content.markdown-body > h4"),
            h5: px(".transcript-block__content.markdown-body > h5"),
            h6: px(".transcript-block__content.markdown-body > h6"),
          };
        }),
      )
      .toEqual(
        expect.objectContaining({
          h1: expect.any(Number),
          h2: expect.any(Number),
          h3: expect.any(Number),
          h4: expect.any(Number),
          h5: expect.any(Number),
          h6: expect.any(Number),
        }),
      );

    const headingSizes = await page.evaluate(() => {
      const px = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        return Number.parseFloat(getComputedStyle(el).fontSize);
      };
      return {
        h1: px(".transcript-block__content.markdown-body > h1"),
        h2: px(".transcript-block__content.markdown-body > h2"),
        h3: px(".transcript-block__content.markdown-body > h3"),
        h4: px(".transcript-block__content.markdown-body > h4"),
        h5: px(".transcript-block__content.markdown-body > h5"),
        h6: px(".transcript-block__content.markdown-body > h6"),
      };
    });
    expect(headingSizes.h1).toBeGreaterThan(headingSizes.h2);
    expect(headingSizes.h2).toBeGreaterThan(headingSizes.h3);
    expect(headingSizes.h3).toBeGreaterThan(headingSizes.h4);
    expect(headingSizes.h4).toBeGreaterThan(headingSizes.h5);
    expect(headingSizes.h5).toBeGreaterThan(headingSizes.h6);

    const composition = await page.evaluate(() => {
      const styles = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector) as HTMLElement);
        return { color: style.color, fontFamily: style.fontFamily, fontStyle: style.fontStyle };
      };
      return {
        quote: styles(".transcript-block__content.markdown-body blockquote"),
        quotedHeading: styles(".transcript-block__content.markdown-body blockquote h2"),
        thinking: styles(".thinking-block.markdown-body"),
        thinkingHeading: styles(".thinking-block.markdown-body > h1"),
        thinkingQuote: styles(".thinking-block.markdown-body blockquote"),
        thinkingQuotedHeading: styles(".thinking-block.markdown-body blockquote h2"),
      };
    });

    expect(composition.quotedHeading.color).toBe(composition.quote.color);
    expect(composition.quotedHeading.fontStyle).toBe(composition.quote.fontStyle);
    expect(composition.thinkingHeading.color).toBe(composition.thinking.color);
    expect(composition.thinkingHeading.fontFamily).toBe(composition.thinking.fontFamily);
    expect(composition.thinkingHeading.fontStyle).toBe(composition.thinking.fontStyle);
    expect(composition.thinkingQuotedHeading.color).toBe(composition.thinkingQuote.color);
    expect(composition.thinkingQuotedHeading.fontFamily).toBe(composition.thinking.fontFamily);
    expect(composition.thinkingQuotedHeading.fontStyle).toBe(composition.thinkingQuote.fontStyle);
  });
});
