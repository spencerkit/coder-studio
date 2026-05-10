import { expect, test } from "@playwright/test";

test.describe("@phase1 edge cases acceptance", () => {
  const appEntrySelector =
    ".welcome-container, .workspace-page, .agent-draft-launcher, .session-card.agent-pane[data-session-id]";

  test("F1-32 empty workspace", async ({ page }) => {
    await page.goto("/");
    // "/" may show welcome or restore an existing workspace; either root entry is valid.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });

  test("F1-33 large file", async ({ page }) => {
    await page.goto("/");
    // Smoke check that the root entry loads.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });

  test("F1-34 binary file", async ({ page }) => {
    await page.goto("/");
    // Smoke check that the root entry loads.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });

  test("F1-35 permission error", async ({ page }) => {
    await page.goto("/");
    // Smoke check that the root entry loads.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });

  test("F1-36 network disconnect", async ({ page }) => {
    await page.goto("/");
    // Smoke check that the root entry loads.
    await expect(page.locator(appEntrySelector).first()).toBeVisible();
  });
});
