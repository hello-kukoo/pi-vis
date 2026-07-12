import { expect, test } from "@playwright/test";

async function waitForStore(page: import("@playwright/test").Page): Promise<void> {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/?customEntry=1");
  await page.waitForFunction(() => {
    const store = (
      window as unknown as { __pivisStore?: { getState: () => { activeSessionId: string | null } } }
    ).__pivisStore;
    return !!store?.getState().activeSessionId;
  });
  await expect(page.locator(".composer__textarea")).toBeEnabled({ timeout: 20_000 });
}

async function applyRestoration(page: import("@playwright/test").Page, restoration: unknown) {
  await page.evaluate((value) => {
    const store = (
      window as unknown as {
        __pivisStore: {
          getState: () => {
            activeSessionId: string;
            applyQueueRestoration: (sessionId: string, restoration: unknown) => void;
          };
        };
      }
    ).__pivisStore;
    const state = store.getState();
    state.applyQueueRestoration(state.activeSessionId, value);
  }, restoration);
}

test("queue restoration shows original attachments separately for review", async ({ page }) => {
  await waitForStore(page);
  await expect(page.locator(".custom-entry")).toBeVisible();

  await applyRestoration(page, {
    restorationId: "restore-render",
    steering: ["review this queued text"],
    followUp: [],
    originalAttachments: [
      {
        intentId: "intent-image",
        images: [
          {
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
        ],
      },
    ],
  });

  const recovery = page.getByRole("region", { name: "Interrupted message review" });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText("Review interrupted message");
  await expect(recovery).toContainText("Pi stopped before confirming");
  await expect(recovery).toContainText("1 possible original attachment");
  await expect(recovery.locator("img")).toBeVisible();
  const colors = await recovery.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--warning-soft)";
    document.body.appendChild(probe);
    const warning = getComputedStyle(probe).backgroundColor;
    probe.style.background = "var(--surface-raised)";
    const surface = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { card: getComputedStyle(element).backgroundColor, surface, warning };
  });
  expect(colors.card).toBe(colors.surface);
  expect(colors.card).not.toBe(colors.warning);

  await recovery.getByRole("button", { name: "Dismiss" }).click();
  await expect(recovery).toHaveCount(0);
});

test("failed compaction is not presented as successful", async ({ page }) => {
  await waitForStore(page);
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __pivisStore: {
          getState: () => {
            activeSessionId: string;
            applyEvent: (sessionId: string, event: unknown) => void;
          };
        };
      }
    ).__pivisStore;
    const state = store.getState();
    state.applyEvent(state.activeSessionId, {
      type: "compaction_end",
      reason: "manual",
      errorMessage: "Nothing to compact",
    });
  });

  await expect(page.getByText(/Compaction failed · manual/)).toBeVisible();
  await expect(page.getByText("Nothing to compact", { exact: true })).toBeVisible();
  await expect(page.getByText(/Context compacted/)).toHaveCount(0);
});

test("ambiguous commands render as non-replayable review", async ({ page }) => {
  await waitForStore(page);
  await applyRestoration(page, {
    restorationId: "ambiguous-command:render-intent",
    steering: [],
    followUp: ["!touch marker"],
    originalAttachments: [],
    commandDescription:
      "bash may have completed before its acknowledgement was lost. Review before retrying.",
  });

  const recovery = page.getByRole("region", { name: "Interrupted message review" });
  await expect(recovery).toContainText("Review interrupted command");
  await expect(recovery).toContainText("bash may have completed");
  await expect(recovery.getByRole("button", { name: "Restore to Composer" })).toHaveCount(0);
  await expect(page.locator(".composer__textarea")).not.toHaveValue("!touch marker");
});
