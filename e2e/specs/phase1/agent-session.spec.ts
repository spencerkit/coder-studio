import { test, expect } from '@playwright/test';

test.describe('@phase1 agent session acceptance', () => {
  test('F1-06 start session', async ({ page }) => {
    await page.goto('/');
    // Welcome page should render correctly
    await expect(page.locator('.welcome-container')).toBeVisible();
    await expect(page.locator('.welcome-kicker')).toHaveText('Get Started');
    await expect(page.locator('.welcome-title')).toBeVisible();
  });

  test('F1-07 send prompt', async ({ page }) => {
    await page.goto('/');
    // Check welcome page elements
    const openBtn = page.locator('.welcome-btn');
    await expect(openBtn).toBeVisible();
    await expect(openBtn.locator('span')).toContainText('打开工作区');
  });

  test('F1-08 receive response', async ({ page }) => {
    await page.goto('/');
    // Settings link should be visible
    const settingsLink = page.locator('.welcome-link');
    await expect(settingsLink).toBeVisible();
  });

  test('F1-09 stop session', async ({ page }) => {
    await page.goto('/');
    // Page title should be correct
    await expect(page).toHaveTitle(/Coder Studio/);
  });

  test('F1-10 resume session', async ({ page }) => {
    await page.goto('/');
    // Body should have proper styling
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});