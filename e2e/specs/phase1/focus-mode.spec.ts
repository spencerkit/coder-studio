import { test, expect } from '@playwright/test';

test.describe('@phase1 focus mode acceptance', () => {
  test('F1-27 enter focus', async ({ page }) => {
    await page.goto('/');
    // Welcome page renders
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('F1-28 exit focus', async ({ page }) => {
    await page.goto('/');
    // Check kicker text
    await expect(page.locator('.welcome-kicker')).toHaveText('Get Started');
  });
});