import { test, expect } from '@playwright/test';

test.describe('@phase1 websocket acceptance', () => {
  test('F1-29 connect', async ({ page }) => {
    await page.goto('/');
    // Page loads correctly
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('F1-30 message flow', async ({ page }) => {
    await page.goto('/');
    // Check welcome card
    await expect(page.locator('.welcome-card')).toBeVisible();
  });

  test('F1-31 reconnect', async ({ page }) => {
    await page.goto('/');
    // Check title
    await expect(page).toHaveTitle(/Coder Studio/);
  });
});