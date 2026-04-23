import { test, expect } from '@playwright/test';
import { enableSupervisor, launchClaudeSession } from './supervisor.helpers';

test.describe('@phase3 supervisor visual acceptance', () => {
  test('P3SV-01 supervisor card shows objective row, provider pill, and progress track', async ({
    page,
  }) => {
    await launchClaudeSession(page);
    const supervisorCard = await enableSupervisor(page, 'Render a visible supervisor card', 'claude');

    await expect(supervisorCard.locator('.supervisor-objective-row')).toBeVisible();
    await expect(supervisorCard.locator('.supervisor-provider-pill')).toBeVisible();

    const progressTrack = supervisorCard.locator('.supervisor-progress-track');
    await page.getByRole('button', { name: '触发评估' }).click();
    await expect(progressTrack).toBeVisible({ timeout: 20000 });
    await expect(progressTrack).toBeVisible();
    await expect(supervisorCard.locator('.supervisor-progress-fill')).toHaveCount(1);
  });
});
