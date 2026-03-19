import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const REMOTE_REPO_URL = 'https://example.com/repo.git';

const launchRemoteWorkspace = async (page: Page, repoUrl = REMOTE_REPO_URL) => {
  await page.goto('/');
  await expect(page.getByTestId('overlay')).toBeVisible();
  await page.getByTestId('choice-remote').click();
  await page.getByTestId('git-input').fill(repoUrl);
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

test('remote workspace flow opens the workspace shell', async ({ page }) => {
  await launchRemoteWorkspace(page);
  await expect(page.getByTestId('workspace-topbar')).toContainText('repo.git');
  await expect(page.getByTestId('settings-open')).toBeVisible();
});

test('local mode shows the server-side folder picker shell', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('choice-local').click();

  await expect(page.getByTestId('folder-select')).toBeVisible();
  await expect(page.getByTestId('folder-selected')).toBeVisible();
  await expect(page.getByTestId('start-workspace')).toBeVisible();
});

test('settings appearance controls can switch locale', async ({ page }) => {
  await launchRemoteWorkspace(page);
  await page.getByTestId('settings-open').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('button', { name: '返回应用' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Back to app' })).toBeVisible();
});

test('settings persist across route changes and reloads', async ({ page }) => {
  await launchRemoteWorkspace(page);
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
  await launchRemoteWorkspace(page);
  await page.reload();

  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('workspace-topbar')).toContainText('repo.git');
});
