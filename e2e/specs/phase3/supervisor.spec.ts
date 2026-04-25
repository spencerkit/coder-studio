import { test, expect } from '@playwright/test';
import { enableSupervisor, launchClaudeSession, waitForSessionReady } from './supervisor.helpers';

test.describe('@phase3 supervisor acceptance', () => {
  test('P3S-01 enables, triggers, pauses, resumes, and disables supervisor from the agent pane', async ({
    page,
  }) => {
    await launchClaudeSession(page);
    await waitForSessionReady(page);
    const supervisorCard = await enableSupervisor(
      page,
      'Keep the implementation focused on persistence and event-driven scheduling',
      'codex'
    );

    await expect(supervisorCard.getByText('Supervisor')).toBeVisible();
    await expect(supervisorCard.locator('.supervisor-provider-pill')).toContainText('codex');

    await page.getByRole('button', { name: '触发评估' }).click();
    await expect(page.locator('.supervisor-history-item').first()).toBeVisible({
      timeout: 20000,
    });

    await page.getByRole('button', { name: '暂停' }).click();
    await expect(page.getByRole('button', { name: '恢复' })).toBeVisible();

    await page.getByRole('button', { name: '恢复' }).click();
    await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();

    await page.getByRole('button', { name: '禁用 Supervisor' }).click();
    await expect(page.getByText('禁用后会停止评估周期')).toBeVisible();
    await page.locator('.modal-card').getByRole('button', { name: '禁用', exact: true }).click();
    await expect(page.getByRole('button', { name: '启用 Supervisor' })).toBeVisible();
  });
});
