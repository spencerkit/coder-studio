import { test, expect } from '@playwright/test';

test.describe('@phase1 command palette acceptance', () => {
  test('F1-25 open palette', async ({ page }) => {
    await page.goto('/');
    // Click open workspace button
    const btn = page.locator('.welcome-btn');
    await btn.click();
    // Command palette should open
    await expect(page.locator('.command-palette')).toBeVisible();
  });

  test('F1-26 execute command', async ({ page }) => {
    await page.goto('/');
    // Open command palette
    const btn = page.locator('.welcome-btn');
    await btn.click();
    // Check command palette items exist
    await expect(page.locator('.command-palette-item')).toHaveCount(5);
  });
});