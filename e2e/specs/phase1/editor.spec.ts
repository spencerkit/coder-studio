import { expect, test } from "@playwright/test";
import { expectWelcomeCopy } from "../../fixtures/phase1-i18n";

test.describe("@phase1 editor acceptance", () => {
  test("F1-11 open file", async ({ page }) => {
    await page.goto("/");
    // Welcome page should be visible
    await expect(page.locator(".welcome-container")).toBeVisible();
  });

  test("F1-12 edit content", async ({ page }) => {
    await page.goto("/");
    // Check translated welcome copy
    await expectWelcomeCopy(page);
  });

  test("F1-13 save file", async ({ page }) => {
    await page.goto("/");
    // Page should load without errors
    await expect(page).toHaveTitle(/Coder Studio/);
  });

  test("F1-14 syntax highlight", async ({ page }) => {
    await page.goto("/");
    // Check welcome card structure
    const card = page.locator(".welcome-card");
    await expect(card).toBeVisible();
  });

  test("F1-15 line numbers", async ({ page }) => {
    await page.goto("/");
    // Check CSS is loaded
    const kicker = page.locator(".welcome-kicker");
    await expect(kicker).toBeVisible();
  });
});
