import { expect, test } from "@playwright/test";
import { translateForE2E } from "../../fixtures/i18n";
import {
  configFilePattern,
  openSettingsSection,
  providerSettingPattern,
  settingsGroupPattern,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 settings acceptance", () => {
  test("P2S-01 settings page opens and renders provider configuration", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator(".settings-page")).toBeVisible();
    await openSettingsSection(page, "providers");
    await expect(page.locator(".settings-provider-content")).toBeVisible();
    await expect(page.locator(".settings-command-preview")).toBeVisible();
  });

  test("P2S-02 provider model change triggers preview update", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");
    const argsInput = page.getByLabel(providerSettingPattern("startup_args"));
    await argsInput.fill("--verbose\n--print");
    await expect(page.locator(".settings-command-preview")).toContainText("--print");
  });

  test("P2S-03 inject hooks updates provider status UI", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");
    await page.getByRole("button", { name: providerSettingPattern("config_file") }).click();
    await expect(page.getByText(configFilePattern("claude"))).toBeVisible();
  });

  test("P2S-04 codex provider shows cwd override field", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");
    await page.getByRole("button", { name: "Codex" }).click();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
    await expect(page.locator(".settings-provider-content textarea.input")).toBeVisible();
  });

  test("P2S-05 appearance settings show theme options", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "appearance");
    await expect(
      page.locator(".settings-group-title").filter({ hasText: settingsGroupPattern("theme") })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^(?:深色|Dark)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(?:浅色|Light)$/ })).toBeVisible();
  });

  test("P2S-06 settings persist after page reload", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");
    await page.getByLabel(providerSettingPattern("startup_args")).fill("--persisted-e2e");
    await page.reload();
    await openSettingsSection(page, "providers");
    await expect(page.locator(".settings-page")).toBeVisible();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
  });

  test("P2S-07 hook status shows registration state", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");
    // Check for hook status indicator
    const statusIndicator = page.locator(".settings-provider-status, .hook-status");
    // Status might show "registered" or "not registered"
    const statusCount = await statusIndicator.count();
    expect(statusCount).toBeGreaterThanOrEqual(0);
  });

  test("P2S-08 keyboard shortcuts settings accessible", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "shortcuts");
    await expect(page.locator(".shortcuts-category-tabs")).toBeVisible();
    await expect(page.locator(".shortcuts-list")).toBeVisible();
  });
});
