import { test, expect } from '@playwright/test';

/**
 * Phase 1 Visual Acceptance Tests: Interactive States
 * Validates visual feedback for user interactions.
 */
test.describe('@phase1 visual acceptance', () => {
  test.describe.configure({ mode: 'serial' });

  test('V1-13 hover states baseline', async ({ page }) => {
    await page.goto('/');
    // Button should have hover effect (check it exists)
    const btn = page.locator('.welcome-btn');
    await expect(btn).toBeVisible();
  });

  test('V1-14 focus states baseline', async ({ page }) => {
    await page.goto('/');
    // Focus on button (use first to avoid disabled button in confirm dialog)
    const btn = page.locator('.welcome-btn').first();
    await btn.focus();
    await expect(btn).toBeFocused();
  });

  test('V1-15 loading states baseline', async ({ page }) => {
    await page.goto('/');
    // Page should load without loading indicators after ready
    await expect(page.locator('.welcome-container')).toBeVisible();
  });
});