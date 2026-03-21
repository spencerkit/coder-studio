import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const HOME_DIR = os.homedir();
const HOME_LABEL = path.basename(HOME_DIR) || HOME_DIR;
const TAB_STABILITY_DIRS = [
  path.join(HOME_DIR, 'coder-studio-e2e-tab-a'),
  path.join(HOME_DIR, 'coder-studio-e2e-tab-b'),
];
const TAB_STABILITY_LABELS = TAB_STABILITY_DIRS.map((dir) => path.basename(dir));

const gotoWorkspaceRoot = async (page: Page) => {
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/rpc/workbench_bootstrap')
    ),
    page.goto('/'),
  ]);
  await page.waitForFunction(() =>
    Boolean(document.querySelector('[data-testid="overlay"]'))
    || document.querySelectorAll('.workspace-top-tab').length > 0
  );
};

const countWorkspaceTabs = async (page: Page) => page.locator('.workspace-top-tab').count();

const openLaunchOverlay = async (page: Page) => {
  await gotoWorkspaceRoot(page);
  const overlay = page.getByTestId('overlay');
  if (await overlay.isVisible()) {
    await expect(overlay).toBeVisible();
    return;
  }

  await expect.poll(() => countWorkspaceTabs(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Add workspace' }).click();
  await expect(overlay).toBeVisible();
};

const launchLocalWorkspace = async (page: Page) => {
  await gotoWorkspaceRoot(page);
  if (await countWorkspaceTabs(page)) {
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

const invokeRpc = async <T>(page: Page, command: string, payload: Record<string, unknown> = {}) => {
  const response = await page.request.post(`/api/rpc/${command}`, { data: payload });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.ok).not.toBe(false);
  return body.data as T;
};

const launchWorkspaceByPath = async (page: Page, workspacePath: string) => {
  await invokeRpc(page, 'launch_workspace', {
    source: {
      kind: 'local',
      pathOrUrl: workspacePath,
      target: { type: 'native' },
    },
  });
};

const readWorkspaceTabLabels = async (page: Page) =>
  page.locator('.workspace-top-tab .session-top-label').evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim() ?? '').filter(Boolean)
  );

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

test.beforeAll(async () => {
  await Promise.all(TAB_STABILITY_DIRS.map((dir) => fs.mkdir(dir, { recursive: true })));
});

test.afterAll(async () => {
  await Promise.all(TAB_STABILITY_DIRS.map((dir) => fs.rm(dir, { recursive: true, force: true })));
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

test('workspace tabs keep a stable order when switching between workspaces', async ({ page }) => {
  await launchWorkspaceByPath(page, TAB_STABILITY_DIRS[0]);
  await launchWorkspaceByPath(page, TAB_STABILITY_DIRS[1]);
  await page.goto('/');
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();

  const initialOrder = await readWorkspaceTabLabels(page);
  const initialFirstIndex = initialOrder.indexOf(TAB_STABILITY_LABELS[0]);
  const initialSecondIndex = initialOrder.indexOf(TAB_STABILITY_LABELS[1]);
  expect(initialFirstIndex).toBeGreaterThanOrEqual(0);
  expect(initialSecondIndex).toBeGreaterThan(initialFirstIndex);

  await page.locator('.workspace-top-tab').filter({ hasText: TAB_STABILITY_LABELS[0] }).click();
  await expect(page.locator('.workspace-top-tab.active .session-top-label')).toHaveText(TAB_STABILITY_LABELS[0]);
  await expect.poll(() => readWorkspaceTabLabels(page)).toEqual(initialOrder);

  await page.locator('.workspace-top-tab').filter({ hasText: TAB_STABILITY_LABELS[1] }).click();
  await expect(page.locator('.workspace-top-tab.active .session-top-label')).toHaveText(TAB_STABILITY_LABELS[1]);
  await expect.poll(() => readWorkspaceTabLabels(page)).toEqual(initialOrder);
});
