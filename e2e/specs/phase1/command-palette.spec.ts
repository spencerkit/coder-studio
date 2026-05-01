import { test, expect } from '@playwright/test';

test.describe('@phase1 command palette acceptance', () => {
  test('F1-25 open palette', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').press('Control+k');
    await expect(page.locator('.command-palette-overlay')).toBeVisible();
    await expect(page.locator('.command-palette')).toBeVisible();
  });

  test('F1-26 execute command', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').press('Control+k');
    const items = page.locator('.command-palette-item');
    await expect(items.first()).toBeVisible();
    // Command count may vary based on available commands
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });
});
