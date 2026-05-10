import { expect, type Locator, type Page, test } from "@playwright/test";
import { openWorkspace } from "../helpers/workspace-session";

async function ensureDraftLauncher(page: Page): Promise<Locator> {
  await openWorkspace(page);

  const draftLauncher = page.locator(".agent-draft-launcher").first();
  if (await draftLauncher.isVisible().catch(() => false)) {
    return draftLauncher;
  }

  const closeButtons = page.locator(".session-card.agent-pane .session-action-btn-close");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await draftLauncher.isVisible().catch(() => false)) {
      return draftLauncher;
    }

    if ((await closeButtons.count()) === 0) {
      break;
    }

    await closeButtons.first().click();
    await page.waitForTimeout(300);
  }

  await expect(draftLauncher).toBeVisible({ timeout: 15000 });
  return draftLauncher;
}

async function ensureFreshClaudeSession(page: Page): Promise<Locator> {
  const draftLauncher = await ensureDraftLauncher(page);
  const claudeButton = draftLauncher.locator(".agent-provider-card-claude").first();

  await expect(claudeButton).toBeVisible({ timeout: 5000 });
  await claudeButton.click();

  const sessionCard = page.locator(".session-card.agent-pane[data-session-id]").first();
  await expect(sessionCard).toBeVisible({ timeout: 15000 });
  await expect(sessionCard.locator(".session-state-badge")).not.toHaveText("DRAFT", {
    timeout: 15000,
  });
  return sessionCard;
}

async function submitPrompt(page: Page, sessionCard: Locator, prompt: string): Promise<void> {
  const terminalArea = sessionCard.locator(".session-terminal, .xterm").first();
  await expect(terminalArea).toBeVisible({ timeout: 5000 });

  await terminalArea.click();
  await page.waitForTimeout(500);
  await page.keyboard.type(prompt);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
}

test.describe("Session Title Extraction", () => {
  test("TITLE-01: Extract and truncate title from first input", async ({ page }) => {
    const sessionCard = await ensureFreshClaudeSession(page);
    const titleElement = sessionCard.locator(".session-title");

    const beforeTitle = await titleElement.textContent();
    expect(beforeTitle).toBeTruthy();
    expect(beforeTitle).toContain("SESSION-");

    await submitPrompt(page, sessionCard, "hello world this is a test");

    await expect(titleElement).toHaveText("hello wor…", { timeout: 10000 });
  });

  test("TITLE-02: Title idempotent - not overwritten on second input", async ({ page }) => {
    const sessionCard = await ensureFreshClaudeSession(page);
    const titleElement = sessionCard.locator(".session-title");

    await submitPrompt(page, sessionCard, "first message");

    await expect(titleElement).toHaveText("first mes…", { timeout: 10000 });
    const firstTitle = await titleElement.textContent();

    await submitPrompt(page, sessionCard, "second different message");

    await expect(titleElement).toHaveText(firstTitle ?? "", { timeout: 10000 });
  });
});
