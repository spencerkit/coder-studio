import { expect, type Locator, type Page } from '@playwright/test';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function directoryRow(page: Page, name: string): Locator {
  return page.locator('.fp-dir').filter({
    has: page.locator('.fp-dir-name').filter({
      hasText: new RegExp(`^${escapeRegExp(name)}$`),
    }),
  }).first();
}

async function waitForWorkspaceEntry(page: Page): Promise<void> {
  await page.goto('/workspace');
  await page.waitForFunction(
    () => {
      const loading = document.querySelector('.app-loading-shell, [data-testid="workspace-resolving-shell"]');
      const welcome = document.querySelector('.welcome-btn');
      const workspace = document.querySelector(
        '.workspace-page, .agent-draft-launcher, .session-card.agent-pane[data-session-id]',
      );

      return !loading && Boolean(welcome || workspace);
    },
    { timeout: 20000 },
  );
}

async function ensureWorkspaceLaunchModal(page: Page): Promise<void> {
  await waitForWorkspaceEntry(page);

  if (
    (await page.locator('.agent-draft-launcher, .session-card.agent-pane[data-session-id]').first()
      .isVisible()
      .catch(() => false))
  ) {
    return;
  }

  const welcomeButton = page.getByRole('button', { name: 'Open Workspace' });
  if (await welcomeButton.isVisible().catch(() => false)) {
    await welcomeButton.click();
  } else {
    await page.getByRole('button', { name: 'New workspace' }).click();
  }

  await expect(page.locator('.launch-modal')).toBeVisible({ timeout: 10000 });
}

async function openRepoDirectory(page: Page): Promise<void> {
  const homeChip = page.locator('.fp-chip').filter({ hasText: '/home/spencer' }).first();
  if (await homeChip.isVisible().catch(() => false)) {
    await homeChip.click();
    await expect(page.locator('.fp-dir-list .directory-loading')).toHaveCount(0);
  }

  await enterDirectory(page, 'workspace');

  const repoRow = directoryRow(page, 'coder-studio');
  await expect(repoRow).toBeVisible({ timeout: 10000 });
  await repoRow.click();
}

export async function enterDirectory(page: Page, name: string): Promise<void> {
  const row = directoryRow(page, name);
  await expect(row).toBeVisible({ timeout: 10000 });

  const pathDisplay = page.locator('.launch-path-display');
  const currentPath = (await pathDisplay.textContent())?.trim() ?? '';

  await row.dblclick();

  await expect(pathDisplay).not.toHaveText(currentPath, { timeout: 10000 });
  await expect(page.locator('.fp-dir-list .directory-loading')).toHaveCount(0);
}

export async function openWorkspace(page: Page): Promise<void> {
  await ensureWorkspaceLaunchModal(page);
  if (
    (await page.locator('.agent-provider-card-claude, .session-card.agent-pane[data-session-id]').first()
      .isVisible()
      .catch(() => false))
  ) {
    await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
    return;
  }

  await expect(page.locator('.fp-dir-list .fp-dir').first()).toBeVisible({ timeout: 10000 });
  await openRepoDirectory(page);

  const startButton = page.getByRole('button', { name: 'Start Workspace' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
  await page.waitForSelector('.agent-provider-card-claude, .session-card.agent-pane[data-session-id]', {
    state: 'visible',
    timeout: 15000,
  });
}

export async function launchClaudeSession(page: Page): Promise<Locator> {
  await openWorkspace(page);

  const existingSession = page.locator('.session-card.agent-pane[data-session-id]').first();
  if (await existingSession.isVisible().catch(() => false)) {
    const stateBadge = existingSession.locator('.session-state-badge');
    const sessionState = ((await stateBadge.textContent()) ?? '').trim();
    const supervisorButton = existingSession.getByRole('button', {
      name: /启用 Supervisor|禁用 Supervisor/,
    });

    if (
      /^(Running|Idle)$/.test(sessionState) &&
      (await supervisorButton.isVisible().catch(() => false))
    ) {
      return existingSession;
    }

    await existingSession.getByRole('button', { name: 'Close' }).click();
  }

  const claudeButton = page.locator('.agent-provider-card-claude').first();
  await expect(claudeButton).toBeVisible({ timeout: 15000 });
  await claudeButton.click();

  const sessionCard = page.locator('.session-card.agent-pane[data-session-id]').first();
  await expect(sessionCard).toBeVisible({ timeout: 15000 });
  await expect(sessionCard.getByRole('button', { name: '启用 Supervisor' })).toBeVisible({
    timeout: 15000,
  });

  return sessionCard;
}

export async function waitForSessionReady(page: Page): Promise<void> {
  const sessionCard = page.locator('.session-card.agent-pane[data-session-id]').first();
  await expect(sessionCard).toBeVisible({ timeout: 15000 });
  await expect(sessionCard.locator('.session-state-badge')).toHaveText(/^(Running|Idle)$/,
    { timeout: 20000 }
  );
}

export async function enableSupervisor(
  page: Page,
  objective: string,
  evaluatorProviderId: 'claude' | 'codex'
): Promise<Locator> {
  const supervisorCard = page.locator('.supervisor-card').first();
  const editButton = page.getByRole('button', { name: '编辑目标' });

  if (await editButton.isVisible().catch(() => false)) {
    await editButton.click();
    const dialog = page.locator('.modal-card');
    await expect(dialog.getByLabel('目标描述')).toBeVisible({ timeout: 10000 });
    await dialog.getByLabel('目标描述').fill(objective);
    await dialog.getByLabel('评估方 (Evaluator)').selectOption(evaluatorProviderId);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    await expect(supervisorCard).toBeVisible({ timeout: 10000 });
    await expect(supervisorCard.locator('.supervisor-provider-pill')).toContainText(
      evaluatorProviderId
    );
    return supervisorCard;
  }

  await expect(page.getByRole('button', { name: '启用 Supervisor' })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: '启用 Supervisor' }).click();
  const dialog = page.locator('.modal-card');
  await dialog.getByLabel('目标描述').fill(objective);
  await dialog.getByLabel('评估方 (Evaluator)').selectOption(evaluatorProviderId);
  await dialog.getByRole('button', { name: '启用', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  await expect(supervisorCard).toBeVisible({ timeout: 10000 });
  await expect(supervisorCard.locator('.supervisor-provider-pill')).toContainText(
    evaluatorProviderId
  );

  return supervisorCard;
}
