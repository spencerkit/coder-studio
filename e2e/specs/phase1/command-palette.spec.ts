import { test } from '@playwright/test';

test.describe('@phase1 command palette acceptance', () => {
  test('F1-25 open palette', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Command palette not implemented yet');
  });

  test('F1-26 execute command', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Command execution from palette not implemented yet');
  });
});
