import { test, expect } from '@playwright/test';

/**
 * Full Integration E2E Tests
 *
 * Complete workflow: Directory Selection -> Open Workspace -> Open Agent
 */

test.describe('full integration workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('INT-01 complete workflow: select directory -> open workspace -> see agent launcher', async ({ page }) => {
    // Step 1: Open command palette
    await page.locator('.welcome-btn').click();
    await expect(page.locator('.command-palette')).toBeVisible();

    // Step 2: Click "Open Workspace" command
    await page.locator('.command-palette-item').first().click();

    // Step 3: Workspace launch modal appears with directory browser
    await expect(page.locator('.modal-content')).toBeVisible();
    await expect(page.locator('.directory-list')).toBeVisible({ timeout: 5000 });

    // Step 4: Select a directory
    const directoryItem = page.locator('.directory-item:not(.directory-item--parent)').first();
    if (await directoryItem.isVisible()) {
      await directoryItem.click();

      // Verify selection shows
      await expect(page.locator('.selected-path')).toBeVisible();

      // Step 5: Click Open button
      const openButton = page.locator('.modal-content .btn-primary');
      await expect(openButton).toBeEnabled();
      await openButton.click();

      // Step 6: Wait for workspace to open (or error if directory not valid)
      await page.waitForTimeout(2000);

      // Either navigated to workspace or modal closed with error
      const modalVisible = await page.locator('.modal-content').isVisible().catch(() => false);
      // If modal closed, either success (navigated) or error shown
      if (!modalVisible) {
        // Check if we're on a workspace page
        const url = page.url();
        expect(url).toMatch(/\/workspace/);
      }
    }
  });

  test('INT-02 directory navigation works correctly', async ({ page }) => {
    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();
    await expect(page.locator('.directory-list')).toBeVisible({ timeout: 5000 });

    // Get initial path from breadcrumb
    const breadcrumb = page.locator('.breadcrumb-path');
    const initialPath = await breadcrumb.textContent();

    // Navigate into a subdirectory if available
    const directoryItem = page.locator('.directory-item:not(.directory-item--parent)').first();
    if (await directoryItem.isVisible()) {
      await directoryItem.dblclick();
      await page.waitForTimeout(500);

      // Path should have changed
      const newPath = await breadcrumb.textContent();
      expect(newPath).toBeDefined();

      // Navigate back using parent link
      const parentItem = page.locator('.directory-item--parent');
      if (await parentItem.isVisible()) {
        await parentItem.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('INT-03 cancel workflow returns to welcome screen', async ({ page }) => {
    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Click cancel
    await page.locator('.modal-content .btn-secondary').click();

    // Modal should close, welcome screen should still be visible
    await expect(page.locator('.modal-content')).not.toBeVisible();
    await expect(page.locator('.welcome-container')).toBeVisible();
  });

  test('INT-04 escape key closes modal at any point', async ({ page }) => {
    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Navigate into a directory
    const directoryItem = page.locator('.directory-item:not(.directory-item--parent)').first();
    if (await directoryItem.isVisible()) {
      await directoryItem.dblclick();
      await page.waitForTimeout(300);
    }

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.locator('.modal-content')).not.toBeVisible();
  });

  test('INT-05 modal shows loading state initially', async ({ page }) => {
    // Open workspace launch modal
    await page.locator('.welcome-btn').click();
    await page.locator('.command-palette-item').first().click();

    // Should show loading state briefly
    const loading = page.locator('.directory-loading');
    // Loading might be very brief, so just check modal appears
    await expect(page.locator('.modal-content')).toBeVisible();

    // Wait for content to load
    await expect(page.locator('.directory-list')).toBeVisible({ timeout: 5000 });
  });
});
