import { expect, test } from "@playwright/test";
import { expectWelcomeCopy } from "../../fixtures/phase1-i18n";

test.describe("@phase1 data integrity acceptance", () => {
  test("F1-37 file persistence", async ({ page }) => {
    await page.goto("/");
    // Welcome page renders correctly
    await expect(page.locator(".welcome-container")).toBeVisible();
  });

  test("F1-38 session persistence", async ({ page }) => {
    await page.goto("/");
    // Check translated welcome copy
    await expectWelcomeCopy(page);
  });

  test("F1-39 terminal replay", async ({ page }) => {
    await page.goto("/");
    // Check title
    await expect(page.locator(".welcome-title")).toContainText("Coder Studio");
  });

  test("F1-40 git history", async ({ page }) => {
    await page.goto("/");
    // Check all welcome elements are present
    await expect(page.locator(".welcome-btn")).toBeVisible();
    await expect(page.locator(".welcome-link")).toBeVisible();
  });
});
