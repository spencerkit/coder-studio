import { test } from '@playwright/test';

test.describe('@phase1 terminal acceptance', () => {
  test('F1-21 create terminal', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Terminal creation not implemented yet');
  });

  test('F1-22 type command', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Command typing in terminal not implemented yet');
  });

  test('F1-23 resize', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Terminal resizing not implemented yet');
  });

  test('F1-24 close', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Terminal closing not implemented yet');
  });
});
