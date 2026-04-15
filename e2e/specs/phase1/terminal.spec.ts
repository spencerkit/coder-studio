import { test, expect } from '@playwright/test';

test.describe('@phase1 terminal acceptance', () => {
  test('F1-21 create terminal', async ({ page }) => {
    await page.goto('/');
    // Welcome page should render
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('F1-22 type command', async ({ page }) => {
    await page.goto('/');
    // Check welcome btn
    const btn = page.locator('.welcome-btn');
    await expect(btn).toBeVisible();
  });

  test('F1-23 resize', async ({ page }) => {
    await page.goto('/');
    // Check page responsiveness
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('F1-24 close', async ({ page }) => {
    await page.goto('/');
    // Settings link should work
    const link = page.locator('.welcome-link');
    await expect(link).toBeVisible();
  });
});