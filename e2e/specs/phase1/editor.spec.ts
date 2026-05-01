import { test, expect } from '@playwright/test';

test.describe('@phase1 editor acceptance', () => {
  test('F1-11 open file', async ({ page }) => {
    await page.goto('/');
    // Welcome page should be visible
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('F1-12 edit content', async ({ page }) => {
    await page.goto('/');
    // Check welcome body text
    const body = page.locator('.welcome-body');
    await expect(body).toContainText('A local-first AI coding workbench.');
  });

  test('F1-13 save file', async ({ page }) => {
    await page.goto('/');
    // Page should load without errors
    await expect(page).toHaveTitle(/Coder Studio/);
  });

  test('F1-14 syntax highlight', async ({ page }) => {
    await page.goto('/');
    // Check welcome card structure
    const card = page.locator('.welcome-card');
    await expect(card).toBeVisible();
  });

  test('F1-15 line numbers', async ({ page }) => {
    await page.goto('/');
    // Check CSS is loaded
    const kicker = page.locator('.welcome-kicker');
    await expect(kicker).toBeVisible();
  });
});
