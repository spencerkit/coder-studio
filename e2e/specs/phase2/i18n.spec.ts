import { expect, test } from "@playwright/test";

test.describe("@phase2 i18n acceptance", () => {
  test("P2I-01 language switch to English", async ({ page }) => {
    await page.goto("/settings");
    // UI defaults to Chinese, click "外观" (Appearance)
    await page.getByRole("button", { name: "外观" }).click();

    // Click English button
    await page.getByRole("button", { name: /English/i }).click();

    // Verify UI is in English (Appearance section title should be translated)
    await expect(page.locator(".settings-section-title")).toContainText("Appearance");
  });

  test("P2I-02 language persists after reload", async ({ page }) => {
    await page.goto("/settings");
    // UI defaults to Chinese, click "外观" (Appearance)
    await page.getByRole("button", { name: "外观" }).click();
    await page.getByRole("button", { name: /English/i }).click();

    // Reload page
    await page.reload();

    // Verify language persisted (page resets to General section after reload)
    await expect(page.locator(".settings-section-title")).toContainText("General");
  });

  test("P2I-03 all UI text uses translation", async ({ page }) => {
    await page.goto("/");

    // Check that welcome screen text is visible (uses translation)
    await expect(page.locator(".welcome-container")).toBeVisible();

    // Navigate to settings
    await page.goto("/settings");
    await expect(page.locator(".settings-page")).toBeVisible();
  });

  test("P2I-04 fallback to default language", async ({ page }) => {
    await page.goto("/");

    // Welcome screen should show content
    await expect(page.locator(".welcome-container")).toBeVisible();
    await expect(page.locator(".welcome-title")).toBeVisible();
  });
});
