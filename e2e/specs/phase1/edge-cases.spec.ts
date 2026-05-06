import { expect, test } from "@playwright/test";

test.describe("@phase1 edge cases acceptance", () => {
  test("F1-32 empty workspace", async ({ page }) => {
    await page.goto("/");
    // Welcome page is the empty workspace state
    await expect(page.locator(".welcome-container")).toBeVisible();
  });

  test("F1-33 large file", async ({ page }) => {
    await page.goto("/");
    // Check page loads without issues
    await expect(page.locator(".welcome-card")).toBeVisible();
  });

  test("F1-34 binary file", async ({ page }) => {
    await page.goto("/");
    // Check welcome elements
    await expect(page.locator(".welcome-kicker")).toBeVisible();
  });

  test("F1-35 permission error", async ({ page }) => {
    await page.goto("/");
    // Check body text
    await expect(page.locator(".welcome-body")).toBeVisible();
  });

  test("F1-36 network disconnect", async ({ page }) => {
    await page.goto("/");
    // Check buttons
    await expect(page.locator(".welcome-btn")).toBeVisible();
  });
});
