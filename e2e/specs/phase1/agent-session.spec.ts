import { test } from '@playwright/test';

test.describe('@phase1 agent session acceptance', () => {
  test('F1-06 start session', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Agent session not implemented yet');
  });

  test('F1-07 send prompt', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Agent prompt sending not implemented yet');
  });

  test('F1-08 receive response', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Agent response receiving not implemented yet');
  });

  test('F1-09 stop session', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Agent session stop not implemented yet');
  });

  test('F1-10 resume session', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Agent session resume not implemented yet');
  });
});
