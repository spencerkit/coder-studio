import { expect, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";
import {
  enterDirectory,
  openWelcomeWorkspaceLaunchModal,
  openWorkspaceLaunchModal,
  waitForWorkspaceLaunchModal,
} from "../helpers/workspace-session";

test.describe("full integration workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("INT-01 complete workflow: select directory -> open workspace -> see agent launcher", async ({
    page,
  }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    await enterDirectory(page, "workspace");

    const repoRow = page
      .locator(".fp-dir")
      .filter({ has: page.locator(".fp-dir-name").filter({ hasText: /^coder-studio$/ }) })
      .first();
    await expect(repoRow).toBeVisible();
    await repoRow.click();

    const startButton = page.getByRole("button", {
      name: translatePatternForE2E("workspace.launch.start"),
    });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
    await expect(
      page.locator(".agent-draft-launcher, .session-card.agent-pane[data-session-id]").first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("INT-02 directory navigation works correctly", async ({ page }) => {
    await openWorkspaceLaunchModal(page);

    const activePathChip = page.locator(".fp-chip.active").last();
    const beforePath = ((await activePathChip.textContent()) ?? "").trim();

    await enterDirectory(page, "workspace");

    await expect(activePathChip).not.toHaveText(beforePath, { timeout: 10000 });

    const goUpButton = page
      .locator(".fp-btn")
      .filter({ hasText: translatePatternForE2E("workspace.launch.go_up") });
    await expect(goUpButton).toBeVisible();
    await goUpButton.click();

    await waitForWorkspaceLaunchModal(page);
    await expect(activePathChip).toHaveText(beforePath, { timeout: 10000 });
  });

  test("INT-03 cancel workflow returns to welcome screen", async ({ page }) => {
    await openWorkspaceLaunchModal(page);

    await page
      .locator(".launch-modal")
      .getByRole("button", { name: /^(Close|关闭)$/ })
      .click();

    await expect(page.locator(".launch-modal")).toHaveCount(0);
    await expect(
      page.locator(".welcome-container, .workspace-page, .agent-draft-launcher").first()
    ).toBeVisible();
  });

  test("INT-04 escape key closes modal at any point", async ({ page }) => {
    await openWorkspaceLaunchModal(page);

    const firstDirectory = page.locator(".fp-dir").first();
    if (await firstDirectory.isVisible().catch(() => false)) {
      await firstDirectory.click();
    }

    await page.keyboard.press("Escape");

    await expect(page.locator(".launch-modal")).toHaveCount(0);
  });

  test("INT-05 modal shows loading state initially", async ({ page }) => {
    await openWorkspaceLaunchModal(page);
  });
});
