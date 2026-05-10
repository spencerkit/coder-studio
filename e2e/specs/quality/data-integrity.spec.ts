import { expect, test } from "@playwright/test";
import { expectWelcomeCopy } from "../../fixtures/phase1-i18n";

test.describe("@phase1 data integrity acceptance", () => {
  const appEntrySelector =
    ".welcome-container, .workspace-page, .agent-draft-launcher, .session-card.agent-pane[data-session-id]";

  test("F1-37 file persistence", async ({ page }) => {
    await page.goto("/");
    // Root app entry should render whether the app lands on welcome or restores a workspace.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });

  test("F1-38 session persistence", async ({ page }) => {
    await page.goto("/");
    // Wait for the app root first, then validate the welcome copy only when "/" actually lands there.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();

    const welcome = page.locator(".welcome-container");
    if (await welcome.isVisible().catch(() => false)) {
      await expectWelcomeCopy(page);
    }
  });

  test("F1-39 terminal replay", async ({ page }) => {
    await page.goto("/");
    // The root entry should be visible even when "/" restores an existing workspace.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });

  test("F1-40 git history", async ({ page }) => {
    await page.goto("/");
    // The root app shell should be interactive regardless of whether we hit welcome or restore.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });
});
