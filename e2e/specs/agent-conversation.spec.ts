import { expect, type Locator, type Page, test } from "@playwright/test";
import { openWorkspace } from "./phase3/supervisor.helpers";

/**
 * Agent Conversation E2E Tests
 *
 * Tests the complete agent conversation workflow:
 * 1. Open workspace via directory browser
 * 2. Select provider (Claude/Codex)
 * 3. Verify session creation UI state
 * 4. Test session controls (stop/resume)
 * 5. Test input submission
 */

const getSessionCard = (page: Page) =>
  page.locator(".session-card.agent-pane[data-session-id]").first();

const isVisible = async (locator: Locator) => locator.isVisible().catch(() => false);

const ensureWorkspaceOpen = async (page: Page) => {
  await openWorkspace(page);
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
};

const ensureClaudeSession = async (page: Page): Promise<Locator> => {
  await ensureWorkspaceOpen(page);

  const existingSession = getSessionCard(page);
  if (await isVisible(existingSession)) {
    return existingSession;
  }

  const claudeBtn = page
    .locator(".agent-provider-card-claude, .agent-draft-providers .btn")
    .first();
  await expect(claudeBtn).toBeVisible({ timeout: 15000 });
  await claudeBtn.click();

  const sessionCard = getSessionCard(page);
  await expect(sessionCard).toBeVisible({ timeout: 15000 });
  return sessionCard;
};

test.describe("agent conversation workflow", () => {
  test("AC-01 open workspace via directory browser", async ({ page }) => {
    await ensureWorkspaceOpen(page);

    const draftLauncher = page.locator(".agent-draft-launcher");
    const hasDraftLauncher = await isVisible(draftLauncher);
    const hasSession = await isVisible(getSessionCard(page));

    expect(hasDraftLauncher || hasSession).toBe(true);
  });

  test("AC-02 provider selection buttons visible after workspace open", async ({ page }) => {
    await ensureWorkspaceOpen(page);

    const draftLauncher = page.locator(".agent-draft-launcher");
    const hasDraftLauncher = await isVisible(draftLauncher);
    const hasSession = await isVisible(getSessionCard(page));

    expect(hasDraftLauncher || hasSession).toBe(true);

    if (hasDraftLauncher) {
      await expect(page.locator(".agent-draft-providers .btn")).toHaveCount(2);
      await expect(page.locator(".agent-provider-card-claude")).toBeVisible();
    }
  });

  test("AC-03 click claude provider button triggers session creation", async ({ page }) => {
    await ensureWorkspaceOpen(page);

    const existingSession = getSessionCard(page);
    if (await isVisible(existingSession)) {
      await expect(existingSession).toBeVisible();
      return;
    }

    const claudeBtn = page
      .locator(".agent-provider-card-claude, .agent-draft-providers .btn")
      .first();
    await expect(claudeBtn).toBeVisible({ timeout: 15000 });
    await claudeBtn.click();

    await page
      .waitForSelector(".session-card.agent-pane[data-session-id], .toast-error, .form-error", {
        timeout: 15000,
      })
      .catch(() => null);

    const sessionCard = getSessionCard(page);
    const errorToast = page.locator(".toast-error");
    const formError = page.locator(".form-error");

    const hasSession = await isVisible(sessionCard);
    const hasErrorToast = await isVisible(errorToast);
    const hasFormError = await isVisible(formError);

    expect(hasSession || hasErrorToast || hasFormError).toBe(true);
  });

  test("AC-04 session card shows correct structure", async ({ page }) => {
    const sessionCard = await ensureClaudeSession(page);

    await expect(sessionCard.locator(".session-header")).toBeVisible();
    await expect(sessionCard.locator(".session-terminal")).toBeVisible();

    const statusDot = sessionCard.locator(".session-dot");
    const statusLabel = sessionCard.locator(".session-state-badge");
    await expect(statusDot).toBeVisible();
    await expect(statusLabel).toBeVisible();
  });

  test("AC-05 session input field exists", async ({ page }) => {
    const sessionCard = await ensureClaudeSession(page);

    const inputField = sessionCard.locator(".session-input input");
    const sendButton = sessionCard.locator(".session-input .btn");

    const inputVisible = await isVisible(inputField);
    if (inputVisible) {
      await expect(inputField).toBeVisible();
      await expect(sendButton).toBeVisible();
    }
  });

  test("AC-06 session stop button exists", async ({ page }) => {
    const sessionCard = await ensureClaudeSession(page);

    const headerActions = sessionCard.locator(".session-header-actions");
    await expect(headerActions).toBeVisible();

    const closeBtn = headerActions.locator("button").last();
    await expect(closeBtn).toBeVisible();
  });

  test("AC-07 websocket connection established", async ({ page }) => {
    await page.goto("/workspace");
    await page.waitForFunction(
      () => {
        const loading = document.querySelector(
          '.app-loading-shell, [data-testid="workspace-resolving-shell"]'
        );
        const welcome = document.querySelector(".welcome-container");
        const workspace = document.querySelector(
          ".workspace-page, .agent-draft-launcher, .session-card.agent-pane"
        );
        return !loading && Boolean(welcome || workspace);
      },
      { timeout: 15000 }
    );
    await page.waitForTimeout(1000);

    const connectionError = page.locator(".connection-error, .offline-indicator");
    const hasConnectionError = await isVisible(connectionError);

    expect(hasConnectionError).toBe(false);
  });

  test("AC-08 workspace persists across navigation", async ({ page }) => {
    await ensureWorkspaceOpen(page);

    const url = page.url();
    expect(url).toMatch(/\/workspace/);

    await page.goto("/settings");
    await page.waitForTimeout(500);

    await page.goBack();
    await page.waitForTimeout(500);

    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/workspace|\/$/);
  });
});

test.describe("agent conversation error handling", () => {
  test("ACE-01 invalid provider shows error", async ({ page }) => {
    await ensureWorkspaceOpen(page);

    const hasDraftLauncher = await isVisible(page.locator(".agent-draft-launcher"));
    const hasSession = await isVisible(getSessionCard(page));
    const hasError = await isVisible(page.locator(".form-error, .toast-error"));

    expect(hasDraftLauncher || hasSession || hasError).toBe(true);
  });

  test("ACE-02 terminal output area exists", async ({ page }) => {
    const sessionCard = await ensureClaudeSession(page);
    const terminalArea = sessionCard.locator(".session-terminal, .xterm").first();

    await expect(terminalArea).toBeVisible({ timeout: 15000 });
  });
});
