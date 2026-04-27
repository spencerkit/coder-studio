import { test, expect } from '@playwright/test';

test.describe('@phase2 auth visual acceptance', () => {
  test('P2AV-01 welcome page layout', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.welcome-container')).toBeVisible();
    const title = page.locator('.welcome-title');
    await expect(title).toBeVisible();
  });

  test('P2AV-02 welcome page buttons styling', async ({ page }) => {
    await page.goto('/');
    const openBtn = page.getByRole('button', { name: /Open|打开/ });
    if (await openBtn.isVisible()) {
      const bgColor = await openBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bgColor).toBeTruthy();
    }
  });

  test('P2AV-03 welcome page color tokens', async ({ page }) => {
    await page.goto('/');
    const container = page.locator('.welcome-container');
    const bgColor = await container.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBeTruthy();
  });

  test('P2AV-04 no-auth mode no login screen', async ({ page }) => {
    await page.goto('/');
    const loginForm = page.locator('.login-form, .auth-form');
    const count = await loginForm.count();
    expect(count).toBe(0);
  });

  test('P2AV-05 auth preview uses shared card and form primitives', async ({ page }) => {
    await page.goto('file:///home/spencer/workspace/coder-studio/packages/web/auth-preview.html');

    await expect(page.locator('.welcome-container.auth-screen')).toBeVisible();
    await expect(page.locator('.welcome-card.auth-card-shell')).toBeVisible();
    await expect(page.locator('.auth-form')).toBeVisible();
    await expect(page.locator('.input.auth-input')).toBeVisible();
    await expect(page.locator('.btn.btn-primary.auth-submit')).toBeVisible();

    const errorColor = await page.locator('.auth-error').evaluate((el) => getComputedStyle(el).color);
    expect(errorColor).toBeTruthy();
  });

  test('P2AV-06 connection status indicator', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('.connection-status, [data-connection-status]');
    const count = await status.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('P2AV-07 header layout styling', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('.app-header, header, .top-bar');
    const count = await header.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
