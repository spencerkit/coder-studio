import { test } from '@playwright/test';

/**
 * Phase 1 Visual Acceptance Tests: Animations & Transitions
 * Validates motion and animation smoothness.
 */
test.describe('@phase1 visual acceptance', () => {
  test.describe.configure({ mode: 'serial' });

  test('V1-16 panel collapse animation baseline', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Panel collapse animation not implemented yet');
  });

  test('V1-17 tab switch animation baseline', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Tab switch animation not implemented yet');
  });
});
