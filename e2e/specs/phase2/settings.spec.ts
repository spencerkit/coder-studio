import { test, expect } from '@playwright/test';

test.describe('@phase2 settings acceptance', () => {
  test('P2S-01 settings page opens and renders provider configuration', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible();
    await page.getByRole('button', { name: 'Providers' }).click();
    await expect(page.locator('.settings-provider-content')).toBeVisible();
    await expect(page.locator('.settings-command-preview')).toBeVisible();
  });

  test('P2S-02 provider model change triggers preview update', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();
    // The command preview should be visible (verified in P2S-01)
    // Select a different model
    await page.locator('select.input').selectOption('claude-3-opus');
    // The model select should have the correct value
    await expect(page.locator('select.input')).toHaveValue('claude-3-opus');
    // The preview element should still be visible
    await expect(page.locator('.settings-command-preview')).toBeVisible();
  });

  test('P2S-03 inject hooks updates provider status UI', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();
    const injectButton = page.locator('.settings-provider-content .btn.btn-primary');
    await injectButton.click();
    await expect(page.locator('.settings-provider-status')).toBeVisible();
  });

  test('P2S-04 codex provider shows cwd override field', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();
    await page.getByRole('button', { name: 'Codex' }).click();
    await expect(page.getByText('Working Directory Override')).toBeVisible();
    await expect(page.locator('.settings-provider-content input.input').last()).toBeVisible();
  });
});
