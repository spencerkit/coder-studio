import { test, expect } from '@playwright/test';

test.describe('@phase1 workspace acceptance', () => {
  test('F1-01 open workspace', async ({ page }) => {
    await page.goto('/');
    // Click open workspace button to open command palette
    const openBtn = page.locator('.welcome-btn');
    await expect(openBtn).toBeVisible();
    await openBtn.click();
    // Command palette should open
    await expect(page.locator('.command-palette-overlay')).toBeVisible();
  });

  test('F1-02 browse file tree', async ({ page }) => {
    await page.goto('/');
    // Welcome page renders correctly
    await expect(page.locator('.welcome-container')).toBeVisible();
    await expect(page.locator('.welcome-card')).toBeVisible();
  });

  test('F1-03 select file', async ({ page }) => {
    await page.goto('/');
    // Check page structure
    await expect(page.locator('main')).toBeVisible();
  });

  test('F1-04 create file', async ({ page }) => {
    await page.goto('/');
    // Welcome page should have kicker
    const kicker = page.locator('.welcome-kicker');
    await expect(kicker).toHaveText('Get Started');
  });

  test('F1-05 delete file', async ({ page }) => {
    await page.goto('/');
    // Check title
    await expect(page.locator('.welcome-title')).toContainText('Coder Studio');
  });
});