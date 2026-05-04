import { expect, test } from '@playwright/test';

test.describe('@phase2 provider acceptance', () => {
  test('desktop uses provider sub-navigation and preserves config view across providers', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    await expect(page.getByRole('button', { name: 'Claude' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Codex' })).toBeVisible();
    await expect(page.getByRole('button', { name: '基础配置' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('启动命令参数')).toBeVisible();

    await page.getByRole('button', { name: '配置文件' }).click();
    await expect(page.getByRole('button', { name: '配置文件' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Claude 配置')).toBeVisible();
    await expect(page.getByLabel('启动命令参数')).not.toBeVisible();

    await page.getByRole('button', { name: 'Codex' }).click();
    await expect(page.getByRole('button', { name: '配置文件' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Codex 配置')).toBeVisible();
    await expect(page.getByLabel('启动命令参数')).not.toBeVisible();

    await page.getByRole('button', { name: '基础配置' }).click();
    await expect(page.getByLabel('启动命令参数')).toBeVisible();
  });

  test('desktop updates startup args per provider and keeps command preview scoped', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Providers' }).click();

    const argsInput = page.getByLabel('启动命令参数');
    await expect(argsInput).toBeVisible();

    await argsInput.fill('--verbose\n--print');
    await expect(page.locator('.settings-command-preview')).toContainText('--print');

    await page.getByRole('button', { name: 'Codex' }).click();
    await expect(page.getByLabel('启动命令参数')).not.toHaveValue('--verbose\n--print');
    await expect(page.locator('.settings-command-preview')).not.toContainText('--print');
  });

  test('mobile enters config editor through secondary action and returns to base settings', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
    });
    const page = await context.newPage();

    try {
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Providers' }).click();

      await expect(page.getByLabel('启动命令参数')).toBeVisible();
      await expect(page.locator('.settings-provider-subnav')).toHaveCount(0);

      await page.getByRole('button', { name: /打开配置文件编辑/ }).click();
      await expect(page.getByRole('button', { name: '返回基础配置' })).toBeVisible();
      await expect(page.getByText('Claude 配置')).toBeVisible();

      await page.getByRole('button', { name: 'Codex' }).click();
      await expect(page.getByLabel('启动命令参数')).toBeVisible();
      await expect(page.getByRole('button', { name: '返回基础配置' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
