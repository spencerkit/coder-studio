import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const HOME_DIR = os.homedir();
const HOME_LABEL = path.basename(HOME_DIR) || HOME_DIR;

const openLaunchOverlay = async (page: Page) => {
  await page.goto('/');
  const overlay = page.getByTestId('overlay');
  if (await overlay.count()) {
    await expect(overlay).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Add workspace' }).click();
  await expect(overlay).toBeVisible();
};

const launchLocalWorkspace = async (page: Page) => {
  await page.goto('/');
  if (await page.getByTestId('workspace-topbar').count()) {
    return;
  }

  await openLaunchOverlay(page);
  await expect(page.getByTestId('choice-local-only')).toBeVisible();
  await expect(page.getByTestId('folder-select')).toBeVisible();

  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByTestId('start-workspace')).toBeEnabled();
  await page.getByTestId('start-workspace').click();
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('coder-studio.test-init')) {
      window.localStorage.setItem('coder-studio.locale', 'en');
      window.localStorage.removeItem('coder-studio.workbench');
      window.localStorage.removeItem('coder-studio.app-settings');
      window.sessionStorage.setItem('coder-studio.test-init', '1');
    }
  });
});

test('local workspace flow opens the workspace shell', async ({ page }) => {
  await launchLocalWorkspace(page);
  await expect(page.getByTestId('workspace-topbar')).toContainText(HOME_LABEL);
  await expect(page.getByTestId('settings-open')).toBeVisible();
});

test('launch overlay shows the server-side folder picker shell', async ({ page }) => {
  await openLaunchOverlay(page);

  await expect(page.getByTestId('choice-local-only')).toBeVisible();
  await expect(page.getByTestId('folder-select')).toBeVisible();
  await expect(page.getByTestId('folder-selected')).toBeVisible();
  await expect(page.getByTestId('start-workspace')).toBeVisible();
});

test('settings appearance controls can switch locale', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.getByTestId('settings-open').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('button', { name: '返回应用' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Back to app' })).toBeVisible();
});

test('settings persist across route changes and reloads', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.getByTestId('settings-open').click();

  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('settings-agent-command').fill('claude --print');
  await page.getByTestId('settings-max-active').fill('5');

  await page.getByRole('button', { name: 'Back to app' }).click();
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-agent-command')).toHaveValue('claude --print');
  await expect(page.getByTestId('settings-max-active')).toHaveValue('5');
});

test('restores the last workspace after reload', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.reload();

  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('workspace-topbar')).toContainText(HOME_LABEL);
});
