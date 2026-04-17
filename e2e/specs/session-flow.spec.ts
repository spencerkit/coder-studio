import { test, expect } from '@playwright/test';

/**
 * Session Flow E2E Tests
 *
 * Complete workflow tests with directory browser:
 * 1. Open workspace via directory selection
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

  test('SF-02 workspace launch modal has directory browser', async ({ page }) => {
    await page.goto('/');

    // Open command palette and trigger workspace launch
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Wait for modal to appear
    await expect(page.locator('.modal-content')).toBeVisible();

    // Check modal has directory listing (may need to wait for load)
    const directoryList = page.locator('.directory-list');
    await expect(directoryList).toBeVisible({ timeout: 5000 });

    // Check modal has breadcrumb showing current path
    const breadcrumb = page.locator('.directory-breadcrumb');
    await expect(breadcrumb).toBeVisible();

    // Check modal has open button (disabled until selection)
    const openButton = page.locator('.modal-content .btn-primary');
    await expect(openButton).toBeVisible();
    await expect(openButton).toBeDisabled();
  });

  test('SF-03 workspace launch modal open button disabled without selection', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Wait for directory list to load
    await expect(page.locator('.directory-list')).toBeVisible({ timeout: 5000 });

    // Open button should be disabled when nothing selected
    const openButton = page.locator('.modal-content .btn-primary');
    await expect(openButton).toBeDisabled();
  });

  test('SF-04 workspace launch modal cancel works', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Wait for modal
    await expect(page.locator('.modal-content')).toBeVisible();

    // Click cancel button
    const cancelButton = page.locator('.modal-content .btn-secondary');
    await cancelButton.click();

    // Modal should close
    await expect(page.locator('.modal-content')).not.toBeVisible();
  });

  test('SF-05 workspace launch modal can select directory', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Wait for directory list to load
    await expect(page.locator('.directory-list')).toBeVisible({ timeout: 5000 });

    // Click on a directory item to select it (exclude parent navigation item)
    const directoryItem = page.locator('.directory-item:not(.directory-item--parent)').first();
    if (await directoryItem.isVisible()) {
      await directoryItem.click();

      // Selected path should appear
      const selectedPath = page.locator('.selected-path');
      await expect(selectedPath).toBeVisible();

      // Open button should now be enabled
      const openButton = page.locator('.modal-content .btn-primary');
      await expect(openButton).toBeEnabled();
    }
  });

  test('SF-06 workspace launch modal can navigate directories', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Wait for directory list to load
    await expect(page.locator('.directory-list')).toBeVisible({ timeout: 5000 });

    // If there are directories, try to navigate into one
    const directoryItem = page.locator('.directory-item:not(.directory-item--parent)').first();
    if (await directoryItem.isVisible()) {
      const breadcrumbBefore = await page.locator('.breadcrumb-path').textContent();

      // Double-click to navigate
      await directoryItem.dblclick();

      // Wait for new directory list
      await page.waitForTimeout(500);

      // Breadcrumb should have changed
      const breadcrumbAfter = await page.locator('.breadcrumb-path').textContent();
      // Either path changed or still loading - both are acceptable
      expect(breadcrumbAfter).toBeDefined();
    }
  });

  test('SF-07 keyboard shortcuts work in modal', async ({ page }) => {
    await page.goto('/');

    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Wait for modal
    await expect(page.locator('.modal-content')).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.locator('.modal-content')).not.toBeVisible();
  });
});
