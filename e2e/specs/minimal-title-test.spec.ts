import { test, expect } from '@playwright/test';

test('Minimal title test', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.waitForTimeout(3000);

  // Check console for debug logs
  page.on('console', msg => {
    if (msg.text().includes('[DEBUG]')) {
      console.log('Browser DEBUG:', msg.text());
    }
  });

  // Check if on welcome page
  const welcomeHeading = page.getByRole('heading', { name: 'Welcome to Coder Studio' });
  if (await welcomeHeading.isVisible()) {
    const openButton = page.getByRole('button', { name: 'Open Workspace' });
    await openButton.click();
    await page.waitForTimeout(1000);

    const workspaceDir = page.locator('text=coder-studio-workspaces').first();
    await workspaceDir.click();
    await page.waitForTimeout(500);

    const startButton = page.getByRole('button', { name: 'Start Workspace' });
    await startButton.click();
    await page.waitForTimeout(5000);
  }

  // Wait for page to load completely
  await page.waitForTimeout(2000);

  // Click Claude analysis button to create a new session
  console.log('Looking for Claude analysis button...');
  const claudeButton = page.getByRole('button', { name: 'Claude analysis' });
  await claudeButton.waitFor({ state: 'visible', timeout: 10000 });
  console.log('✓ Claude button found, clicking...');
  await claudeButton.click();

  // Wait for session to be created (SessionStart hook should fire)
  console.log('Waiting for session creation...');
  await page.waitForTimeout(10000);

  // Now look for the session card with an actual session (not draft launcher)
  // The session card should have a session-state element (Idle/Running/Interrupted)
  const sessionCard = page.locator('.session-card').filter({
    has: page.locator('.session-state')
  }).first();

  await sessionCard.waitFor({ state: 'visible', timeout: 15000 });
  console.log('✓ Session card found');

  const titleElement = sessionCard.locator('.session-title');
  const initialTitle = await titleElement.textContent();
  console.log('Initial session title:', initialTitle);

  // Click the terminal input textbox directly
  const terminalInput = sessionCard.getByRole('textbox', { name: 'Terminal input' });
  await terminalInput.click();
  await page.waitForTimeout(500);

  await terminalInput.fill('test input for title');
  await page.keyboard.press('Enter');

  await page.waitForTimeout(5000);

  const newTitle = await titleElement.textContent();
  console.log('New session title:', newTitle);

  // Verify title changed from SESSION-XX format
  expect(newTitle).not.toMatch(/^SESSION-\d+$/);
  expect(newTitle).toContain('test');
});