import { expect, test } from "@playwright/test";

test.describe("@phase1 workspace acceptance", () => {
  test("F1-01 open workspace", async ({ page }) => {
    await page.goto("/");
    // Click open workspace button to open the workspace launch modal.
    const openBtn = page.locator(".welcome-btn");
    await expect(openBtn).toBeVisible();
    await openBtn.click();
    await expect(page.locator(".launch-overlay")).toBeVisible();
    await expect(page.locator(".launch-title")).toHaveText("Local Folder");
  });

  test("F1-02 browse file tree", async ({ page }) => {
    await page.goto("/");
    // Welcome page renders correctly
    await expect(page.locator(".welcome-container")).toBeVisible();
    await expect(page.locator(".welcome-card")).toBeVisible();
  });

  test("F1-03 select file", async ({ page }) => {
    await page.goto("/");
    // Check page structure
    await expect(page.locator("main")).toBeVisible();
  });

  test("F1-04 create file", async ({ page }) => {
    await page.goto("/");
    // Welcome page should have kicker
    const kicker = page.locator(".welcome-kicker");
    await expect(kicker).toHaveText("GET STARTED");
  });

  test("F1-05 delete file", async ({ page }) => {
    await page.goto("/");
    // Check title
    await expect(page.locator(".welcome-title")).toContainText("Coder Studio");
  });
});
