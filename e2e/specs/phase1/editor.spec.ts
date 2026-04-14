import { test } from '@playwright/test';

test.describe('@phase1 editor acceptance', () => {
  test('F1-11 open file', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File opening in editor not implemented yet');
  });

  test('F1-12 edit content', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Content editing not implemented yet');
  });

  test('F1-13 save file', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File saving not implemented yet');
  });

  test('F1-14 syntax highlight', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Syntax highlighting not implemented yet');
  });

  test('F1-15 line numbers', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Line numbers not implemented yet');
  });
});
