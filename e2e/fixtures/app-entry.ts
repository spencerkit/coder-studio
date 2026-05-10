import { expect, type Locator, type Page } from "@playwright/test";
import { translatePatternForE2E } from "./i18n.js";
import {
  expectOpenWorkspaceButton,
  expectSettingsButton,
  expectWelcomeCopy,
} from "./phase1-i18n.js";

export const APP_ENTRY_SELECTOR =
  ".welcome-container, .workspace-page, .agent-draft-launcher, .session-card.agent-pane[data-session-id]";

export async function expectAppEntry(page: Page): Promise<void> {
  await expect(page.locator(APP_ENTRY_SELECTOR).first()).toBeVisible();
}

export async function isWelcomeVisible(page: Page): Promise<boolean> {
  return await page
    .locator(".welcome-container")
    .isVisible()
    .catch(() => false);
}

export async function expectWelcomeCardIfVisible(page: Page): Promise<void> {
  await expectAppEntry(page);
  if (await isWelcomeVisible(page)) {
    await expect(page.locator(".welcome-card")).toBeVisible();
  }
}

export async function expectWelcomeCopyIfVisible(page: Page): Promise<void> {
  await expectAppEntry(page);
  if (await isWelcomeVisible(page)) {
    await expectWelcomeCopy(page);
  }
}

export async function expectPrimaryWorkspaceAction(page: Page): Promise<Locator> {
  await expectAppEntry(page);

  const welcomeButton = page.locator(".welcome-btn").first();
  if (await welcomeButton.isVisible().catch(() => false)) {
    await expectOpenWorkspaceButton(welcomeButton);
    return welcomeButton;
  }

  const newWorkspaceButton = page
    .getByRole("button", {
      name: translatePatternForE2E("tooltip.new_workspace"),
    })
    .first();
  await expect(newWorkspaceButton).toBeVisible();
  return newWorkspaceButton;
}

export async function expectSettingsEntryPoint(page: Page): Promise<Locator> {
  await expectAppEntry(page);

  const welcomeSettings = page.locator(".welcome-link").first();
  if (await welcomeSettings.isVisible().catch(() => false)) {
    await expectSettingsButton(welcomeSettings);
    return welcomeSettings;
  }

  const settingsButton = page
    .getByRole("button", {
      name: translatePatternForE2E("action.settings"),
    })
    .first();
  await expect(settingsButton).toBeVisible();
  return settingsButton;
}
