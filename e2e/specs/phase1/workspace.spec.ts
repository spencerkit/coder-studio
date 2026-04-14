import { test } from '@playwright/test';

test.describe('@phase1 workspace acceptance', () => {
  test('F1-01 open workspace', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open Workspace' }).click();
    test.fail(true, 'App UI not implemented yet');
  });

  test('F1-02 browse file tree', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File tree not implemented yet');
  });

  test('F1-03 select file', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File selection not implemented yet');
  });

  test('F1-04 create file', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File creation not implemented yet');
  });

  test('F1-05 delete file', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File deletion not implemented yet');
  });
});
