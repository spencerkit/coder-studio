import { test } from '@playwright/test';

test.describe('@phase1 focus mode acceptance', () => {
  test('F1-27 enter focus', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Focus mode not implemented yet');
  });

  test('F1-28 exit focus', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Exit focus mode not implemented yet');
  });
});
