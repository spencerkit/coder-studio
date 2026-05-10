import { expect, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";
import {
  enterDirectory,
  openWelcomeWorkspaceLaunchModal,
  waitForWorkspaceLaunchModal,
} from "../helpers/workspace-session";

test.describe("session flow", () => {
  test("SF-01 open workspace via launch modal", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    await expect(page.locator(".launch-title")).toHaveText(
      translatePatternForE2E("workspace.launch.title")
    );
    await expect(page.locator(".launch-hint")).toHaveText(
      translatePatternForE2E("workspace.launch.hint")
    );
  });

  test("SF-02 workspace launch modal has directory browser", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    await expect(page.locator(".fp-root-chips")).toBeVisible();

    const startButton = page.getByRole("button", {
      name: translatePatternForE2E("workspace.launch.start"),
    });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();
  });

  test("SF-03 workspace launch modal open button disabled without selection", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    const startButton = page.getByRole("button", {
      name: translatePatternForE2E("workspace.launch.start"),
    });
    await expect(startButton).toBeDisabled();
  });

  test("SF-04 workspace launch modal cancel works", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    await page.getByRole("button", { name: /^(Close|关闭)$/ }).click();

    await expect(page.locator(".launch-modal")).toHaveCount(0);
    await expect(page.locator(".welcome-container")).toBeVisible();
  });

  test("SF-05 workspace launch modal can select directory", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    const directoryItem = page.locator(".fp-dir").first();
    await expect(directoryItem).toBeVisible();
    await directoryItem.click();

    await expect(page.locator(".fp-dir.selected")).toHaveCount(1);
    await expect(page.locator(".fp-dir-action")).toBeVisible();

    const startButton = page.getByRole("button", {
      name: translatePatternForE2E("workspace.launch.start"),
    });
    await expect(startButton).toBeEnabled();
  });

  test("SF-06 workspace launch modal can navigate directories", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    const activePathChip = page.locator(".fp-chip.active").last();
    const beforePath = ((await activePathChip.textContent()) ?? "").trim();

    await enterDirectory(page, "workspace");

    await expect(activePathChip).not.toHaveText(beforePath, { timeout: 10000 });
    await expect(
      page.locator(".fp-btn").filter({ hasText: translatePatternForE2E("workspace.launch.go_up") })
    ).toBeVisible();
  });

  test("SF-07 keyboard shortcuts work in modal", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    await page.keyboard.press("Escape");

    await expect(page.locator(".launch-modal")).toHaveCount(0);
  });
});
