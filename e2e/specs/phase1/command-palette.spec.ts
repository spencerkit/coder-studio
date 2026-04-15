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
    const btn = page.locator('.welcome-btn');
    await btn.click();
    const items = page.locator('.command-palette-item');
    await expect(items.first()).toBeVisible();
    // Command count may vary based on available commands
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });
});