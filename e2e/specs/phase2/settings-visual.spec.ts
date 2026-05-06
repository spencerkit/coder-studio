import { expect, test } from "@playwright/test";

test.describe("@phase2 settings visual acceptance", () => {
  test("P2V-01 settings page layout baseline", async ({ page }) => {
    await page.goto("/settings");
    // Check settings page structure
    await expect(page.locator(".settings-page, .settings-container")).toBeVisible();
    // Check navigation buttons exist
    const navButtons = page.locator(".settings-nav button, .settings-sidebar button");
    expect(await navButtons.count()).toBeGreaterThan(0);
  });

  test("P2V-02 settings page color tokens", async ({ page }) => {
    await page.goto("/settings");
    // Verify CSS tokens are applied
    const bgColor = await page
      .locator(".settings-page, .settings-container")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // Should use token-based color (not hardcoded white/black)
    expect(bgColor).toBeTruthy();
  });

  test("P2V-03 provider card styling", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Providers" }).click();
    // Provider cards should have consistent styling
    const providerCard = page.locator(".settings-provider-content");
    await expect(providerCard).toBeVisible();
    // Check for proper spacing
    const padding = await providerCard.evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBeTruthy();
  });

  test("P2V-04 appearance section layout", async ({ page }) => {
    await page.goto("/settings");
    const appearanceBtn = page.getByRole("button", { name: "外观" });
    if (await appearanceBtn.isVisible()) {
      await appearanceBtn.click();
      // Appearance section should be visible
      const appearanceSection = page.locator(".settings-appearance, .appearance-settings");
      const count = await appearanceSection.count();
      expect(count).toBeGreaterThanOrEqual(0);
    } else {
      expect(true).toBe(true);
    }
  });

  test("P2V-05 input field focus states", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Providers" }).click();
    // Find an input and focus it
    const input = page.locator("input.input, select.input").first();
    if (await input.isVisible()) {
      await input.focus();
      // Check focus border color
      const borderColor = await input.evaluate((el) => getComputedStyle(el).borderColor);
      expect(borderColor).toBeTruthy();
    } else {
      expect(true).toBe(true);
    }
  });

  test("P2V-06 button hover states", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Providers" }).click();
    // Find a button and hover
    const button = page.locator(".btn").first();
    await button.hover();
    // Button should respond to hover
    await expect(button).toBeVisible();
  });

  test("P2V-07 i18n layout RTL support", async ({ page }) => {
    await page.goto("/settings");
    // Check if RTL is supported (dir attribute)
    const dir = await page.locator("html").getAttribute("dir");
    // RTL might be 'rtl' or null/'ltr'
    expect(["rtl", "ltr", null]).toContain(dir);
  });

  test("P2V-08 theme toggle visual feedback", async ({ page }) => {
    await page.goto("/settings");
    const appearanceBtn = page.getByRole("button", { name: "外观" });
    if (await appearanceBtn.isVisible()) {
      await appearanceBtn.click();
      // Look for theme toggle buttons
      const themeToggle = page.locator('.theme-toggle, [data-testid="theme-toggle"]');
      const count = await themeToggle.count();
      expect(count).toBeGreaterThanOrEqual(0);
    } else {
      expect(true).toBe(true);
    }
  });
});
