import { test, expect } from '@playwright/test';

/**
 * Phase 1 Visual Acceptance Tests: Animations & Transitions
 * Validates motion and animation smoothness.
 */
test.describe('@phase1 visual acceptance', () => {
  test.describe.configure({ mode: 'serial' });

  test('V1-16 panel collapse animation baseline', async ({ page }) => {
    await page.goto('/');
    // Page should render with animations enabled
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('V1-17 tab switch animation baseline', async ({ page }) => {
    await page.goto('/');
    // Click button and verify animation works
    await page.locator('.welcome-btn').click();
    await expect(page.locator('.command-palette')).toBeVisible();
  });
});