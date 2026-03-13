import { test, expect } from '@playwright/test';
import path from 'node:path';

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

test('remote git main flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-logo')).toBeVisible();
  await expect(page.getByTestId('overlay')).toBeVisible();

  await page.getByTestId('choice-remote').click();
  await page.getByTestId('git-input').fill('https://example.com/repo.git');
  await page.getByTestId('start-workspace').click();

  await expect(page.getByTestId('workspace-pill')).toContainText('https://example.com/repo.git');
  await expect(page.getByTestId('agent-terminal')).toBeVisible();
  await expect(page.getByTestId('agent-input')).toBeVisible();

  await page.getByTestId('session-new').click();
  await page.getByTestId('queue-input').fill('Summarize repo');
  await page.getByTestId('queue-add').click();
  await page.getByTestId('queue-run').click();

  await expect(page.locator('.queue-list').getByText('Summarize repo', { exact: true })).toBeVisible();
});

test('local folder selection flow', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('choice-local').click();

  const folderInput = page.getByTestId('folder-input');
  const folderPath = path.join(process.cwd(), 'tests', 'fixtures', 'project');
  await folderInput.setInputFiles(folderPath);

  await expect(page.getByTestId('folder-selected')).toContainText('project');
  await page.getByTestId('start-workspace').click();

  await expect(page.getByTestId('workspace-pill')).toContainText('project');
});

test('language toggle switches ui copy between english and chinese', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('start-workspace')).toHaveText('Start Workspace');

  await page.getByTestId('overlay-locale-zh').click();
  await expect(page.getByTestId('start-workspace')).toHaveText('开始工作区');
  await expect(page.getByTestId('choice-local')).toContainText('本地目录');

  await page.getByTestId('overlay-locale-en').click();
  await expect(page.getByTestId('start-workspace')).toHaveText('Start Workspace');
  await expect(page.getByTestId('choice-local')).toContainText('Local Folder');
});

test('global settings apply agent defaults to every workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('choice-remote').click();
  await page.getByTestId('git-input').fill('https://example.com/repo.git');
  await page.getByTestId('start-workspace').click();

  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-agent-provider').selectOption('codex');
  await page.getByTestId('settings-agent-command').fill('codex --fast');
  await page.getByTestId('settings-max-active').fill('5');
  await page.getByTestId('settings-apply').click();

  await expect(page.locator('.workspace-capsules')).toContainText('codex --fast');
  await expect(page.locator('.brief-grid')).toContainText('codex');
});

test('restores previous workspace session history on reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('choice-remote').click();
  await page.getByTestId('git-input').fill('https://example.com/repo.git');
  await page.getByTestId('start-workspace').click();
  await page.getByTestId('queue-input').fill('Review open tasks');
  await page.getByTestId('queue-add').click();

  await page.reload();

  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('workspace-pill')).toContainText('https://example.com/repo.git');
  await expect(page.locator('.queue-list')).toContainText('Review open tasks');
});
