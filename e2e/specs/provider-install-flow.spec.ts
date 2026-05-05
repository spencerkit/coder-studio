import fs from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

function resetMockProviderBinaries(): void {
  fs.rmSync("/tmp/cs-provider-mock/bin/claude", { force: true });
  fs.rmSync("/tmp/cs-provider-mock/bin/codex", { force: true });
}

async function waitForWorkspaceEntry(page: Page): Promise<void> {
  await page.goto("/workspace");
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(
        '.app-loading-shell, [data-testid="workspace-resolving-shell"]'
      );
      const welcome = document.querySelector(".welcome-btn");
      const workspace = document.querySelector(
        ".workspace-page, .agent-draft-launcher, .session-card.agent-pane"
      );

      return !loading && Boolean(welcome || workspace);
    },
    { timeout: 20000 }
  );
}

async function ensureWorkspaceOpen(page: Page): Promise<void> {
  await waitForWorkspaceEntry(page);

  const draftLauncher = page.locator(".agent-draft-launcher").first();
  const sessionPane = page.locator(".session-card.agent-pane").first();

  if (
    page.url().includes("/workspace") ||
    (await draftLauncher.isVisible().catch(() => false)) ||
    (await sessionPane.isVisible().catch(() => false))
  ) {
    await expect(
      page.locator(".agent-draft-launcher, .session-card.agent-pane").first()
    ).toBeVisible({
      timeout: 15000,
    });
    return;
  }

  await expect(page.locator(".welcome-btn")).toBeVisible({ timeout: 15000 });
  await page.locator(".welcome-btn").click();
  await page.locator(".command-palette-item").first().click();
  await expect(page.locator(".launch-modal")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".fp-dir-list .fp-dir").first()).toBeVisible({ timeout: 10000 });

  await page
    .locator(".fp-dir")
    .filter({ hasText: /^workspace$/ })
    .first()
    .dblclick();
  await expect(page.locator(".fp-dir-list .directory-loading")).toHaveCount(0);
  await page
    .locator(".fp-dir")
    .filter({ hasText: /^coder-studio$/ })
    .first()
    .click();

  const startButton = page.getByRole("button", { name: "Start Workspace" });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
}

async function ensureDraftLauncher(page: Page): Promise<Locator> {
  await ensureWorkspaceOpen(page);

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

test.describe("provider install launcher flow", () => {
  test.beforeEach(() => {
    resetMockProviderBinaries();
  });

  test("PIF-01 Claude shows install action, installs, and creates a session", async ({ page }) => {
    const draftLauncher = await ensureDraftLauncher(page);
    const claudeCard = draftLauncher.locator(".agent-provider-card-claude").first();

    await expect(claudeCard.locator(".agent-provider-card-cta")).toBeVisible({ timeout: 15000 });

    await claudeCard.click();

    await expect(claudeCard).toBeDisabled({ timeout: 15000 });
    await expect(claudeCard.locator(".agent-provider-card-status")).toBeVisible({ timeout: 15000 });

    const sessionCard = page.locator(".session-card.agent-pane[data-session-id]").first();
    await expect(sessionCard).toBeVisible({ timeout: 20000 });
  });

  test("PIF-02 Codex install failure shows error guidance and docs link", async ({ page }) => {
    const draftLauncher = await ensureDraftLauncher(page);
    const codexCard = draftLauncher.locator(".agent-provider-card-codex").first();

    await expect(codexCard.locator(".agent-provider-card-cta")).toBeVisible({ timeout: 15000 });

    await codexCard.click();

    await expect(codexCard).toContainText("permission denied", { timeout: 20000 });
    await expect(codexCard.locator(".agent-provider-card-guide a")).toHaveAttribute(
      "href",
      /openai\.com|github\.com|platform\.openai\.com/i,
      { timeout: 10000 }
    );
  });
});
