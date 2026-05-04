import { test, expect } from '@playwright/test';

test.describe('@phase2 provider acceptance', () => {
  test('P2P-01 provider tabs render in settings', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    await expect(page.getByRole('button', { name: 'Claude' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Codex' })).toBeVisible();
  });

  test('P2P-02 Claude model selection updates config', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    // Select a model
    await page.locator('select.input').selectOption('claude-3-opus');

    // Verify selection persisted
    await expect(page.locator('select.input')).toHaveValue('claude-3-opus');
  });

  test('P2P-03 Codex cwd override field exists', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();
    await page.getByRole('button', { name: 'Codex' }).click();

    // Check cwd override field exists
    await expect(page.getByText('Working Directory Override')).toBeVisible();
  });

  test('P2P-04 hooks inject button works', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    // Click inject hooks button
    const injectButton = page.locator('.settings-provider-content .btn.btn-primary');
    await injectButton.click();

    // Verify status changes
    await expect(page.locator('.settings-provider-status')).toBeVisible();
  });

  test('P2P-05 provider tabs switch correctly', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    // Verify Claude is selected by default
    await expect(page.locator('.settings-provider-tab-active')).toContainText('Claude');

    // Switch to Codex
    await page.getByRole('button', { name: 'Codex' }).click();
    await expect(page.locator('.settings-provider-tab-active')).toContainText('Codex');

    // Switch back to Claude
    await page.getByRole('button', { name: 'Claude' }).click();
    await expect(page.locator('.settings-provider-tab-active')).toContainText('Claude');
  });

  test('P2P-06 API key field accepts input', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    // Enter API key
    const apiKeyInput = page.locator('input[type="password"]').first();
    await apiKeyInput.fill('test-api-key');

    // Verify input
    await expect(apiKeyInput).toHaveValue('test-api-key');
  });
});
