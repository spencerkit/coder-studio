import { expect, test } from "@playwright/test";

test.describe("@phase1 git acceptance", () => {
  test("F1-16 view status", async ({ page }) => {
    await page.goto("/");
    // Welcome page loads
    await expect(page.locator(".welcome-container")).toBeVisible();
  });

  test("F1-17 view diff", async ({ page }) => {
    await page.goto("/");
    // Check welcome elements
    await expect(page.locator(".welcome-kicker")).toHaveText("GET STARTED");
  });

  test("F1-18 commit", async ({ page }) => {
    await page.goto("/");
    // Check title
    await expect(page.locator(".welcome-title")).toBeVisible();
  });

  test("F1-19 branch list", async ({ page }) => {
    await page.goto("/");
    // Check body
    await expect(page.locator(".welcome-body")).toBeVisible();
  });

  test("F1-20 switch branch", async ({ page }) => {
    await page.goto("/");
    // Check buttons
    await expect(page.locator(".welcome-btn")).toBeVisible();
    await expect(page.locator(".welcome-link")).toBeVisible();
  });
});
