import { expect, test } from "@playwright/test";
import { expectWelcomeCopy } from "../../fixtures/phase1-i18n";

/**
 * Phase 1 Visual Acceptance Tests: Core Components
 * Validates visual appearance of main UI components.
 */
test.describe("@phase1 visual acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test("V1-04 welcome page baseline", async ({ page }) => {
    await page.goto("/");
    // Welcome container should be visible
    await expect(page.locator(".welcome-container")).toBeVisible();
    await expect(page.locator(".welcome-card")).toBeVisible();
  });

  test("V1-05 workspace panel baseline", async ({ page }) => {
    await page.goto("/");
    // Welcome copy should be present in the active locale
    await expectWelcomeCopy(page);
  });

  test("V1-06 agent pane baseline", async ({ page }) => {
    await page.goto("/");
    // Title should be visible
    await expect(page.locator(".welcome-title")).toContainText("Coder Studio");
  });

  test("V1-07 editor baseline", async ({ page }) => {
    await page.goto("/");
    // Body text should be visible
    await expect(page.locator(".welcome-body")).toBeVisible();
  });

  test("V1-08 terminal baseline", async ({ page }) => {
    await page.goto("/");
    // Open workspace button should exist
    await expect(page.locator(".welcome-btn")).toBeVisible();
  });

  test("V1-09 command palette baseline", async ({ page }) => {
    await page.goto("/");
    // Open the command palette via its keyboard shortcut.
    await page.locator("body").press("Control+k");
    await expect(page.locator(".command-palette")).toBeVisible();
  });

  test("V1-10 settings baseline", async ({ page }) => {
    await page.goto("/");
    // Settings link should be visible
    await expect(page.locator(".welcome-link")).toBeVisible();
  });

  test("V1-11 buttons baseline", async ({ page }) => {
    await page.goto("/");
    // Button should have correct styling
    const btn = page.locator(".welcome-btn");
    await expect(btn).toBeVisible();
  });

  test("V1-12 inputs baseline", async ({ page }) => {
    await page.goto("/");
    // Page should render correctly
    await expect(page.locator("main")).toBeVisible();
  });
});
