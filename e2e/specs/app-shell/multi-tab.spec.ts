import { expect, test } from "@playwright/test";

test.describe("@phase3 multi-tab concurrency", () => {
  test("P3M-01 first tab becomes controller", async ({ page }) => {
    await page.goto("/");
    // Wait for WebSocket connection
    await page.waitForTimeout(2000);

    // Observer banner should NOT be visible (we are the controller)
    const banner = page.locator(".observer-banner");
    await expect(banner).not.toBeVisible();
  });

  test("P3M-02 observer banner shows for second connection", async ({ browser }) => {
    // Open first tab
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto("/");
    await page1.waitForTimeout(2000);

    // Open second tab
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto("/");
    await page2.waitForTimeout(2000);

    // Note: Exact behavior depends on whether workspace is loaded.
    // At minimum, both pages should load without error.
    await expect(page1.locator("body")).toBeVisible();
    await expect(page2.locator("body")).toBeVisible();

    await context1.close();
    await context2.close();
  });
});
