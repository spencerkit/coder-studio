import { expect, type Locator, type Page } from "@playwright/test";
import { translateForE2E } from "./i18n.js";

export async function expectWelcomeCopy(page: Page): Promise<void> {
  await expect(page.locator(".welcome-kicker")).toHaveText(translateForE2E("welcome.kicker"));
  await expect(page.locator(".welcome-title")).toHaveText(translateForE2E("welcome.title"));
  await expect(page.locator(".welcome-body")).toContainText(translateForE2E("welcome.description"));
}

export async function expectOpenWorkspaceButton(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(translateForE2E("action.open_workspace"));
}

export async function expectSettingsButton(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(translateForE2E("action.settings"));
}
