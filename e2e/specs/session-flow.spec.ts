import { test, expect } from '@playwright/test';

/**
 * Session Flow E2E Tests
 *
 * Complete workflow tests:
 * 1. Open workspace
 * 2. Start agent session (Claude/Codex)
 * 3. Wait for agent startup
 * 4. Input conversation
 * 5. Agent response output
 */

test.describe('session flow', () => {
  test('SF-01 open workspace via launch modal', async ({ page }) => {
    await page.goto('/');

    // Click open workspace button
    const openBtn = page.locator('.welcome-btn');
    await openBtn.click();

    // Command palette should open
    await expect(page.locator('.command-palette')).toBeVisible();

    // Click the first command (Open Workspace)
    const firstCommand = page.locator('.command-palette-item').first();
    await firstCommand.click();

    // Workspace launch modal should appear
    await expect(page.locator('.workspace-launch-modal, .modal-content')).toBeVisible();
  });

  test('SF-02 workspace launch modal has path input', async ({ page }) => {
    await page.goto('/');

    // Open command palette and trigger workspace launch
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Check modal has path input
    const pathInput = page.locator('.modal-content input[type="text"], .modal-content input.input');
    await expect(pathInput).toBeVisible();

    // Check modal has runtime select
    const runtimeSelect = page.locator('.modal-content select');
    await expect(runtimeSelect).toBeVisible();

    // Check modal has open button
    const openButton = page.locator('.modal-content .btn-primary');
    await expect(openButton).toBeVisible();
  });

  test('SF-03 workspace launch modal validates path', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Open button should be disabled when path is empty
    const openButton = page.locator('.modal-content .btn-primary');
    await expect(openButton).toBeDisabled();
  });

  test('SF-04 workspace launch modal cancel works', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Click cancel button
    const cancelButton = page.locator('.modal-content .btn-secondary');
    await cancelButton.click();

    // Modal should close
    await expect(page.locator('.modal-content')).not.toBeVisible();
  });

  test('SF-05 workspace launch modal accepts path input', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Enter path
    const pathInput = page.locator('.modal-content input[type="text"]');
    await pathInput.fill('/tmp/test-workspace');

    // Open button should now be enabled
    const openButton = page.locator('.modal-content .btn-primary');
    await expect(openButton).toBeEnabled();
  });

  test('SF-06 runtime selection works', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Check runtime options
    const runtimeSelect = page.locator('.modal-content select');
    await expect(runtimeSelect).toBeVisible();

    // Select Bun runtime
    await runtimeSelect.selectOption('bun');
    await expect(runtimeSelect).toHaveValue('bun');

    // Select Deno runtime
    await runtimeSelect.selectOption('deno');
    await expect(runtimeSelect).toHaveValue('deno');

    // Select Node runtime
    await runtimeSelect.selectOption('node');
    await expect(runtimeSelect).toHaveValue('node');
  });

  test('SF-07 keyboard shortcuts work in modal', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.locator('.modal-content')).not.toBeVisible();
  });
});
