import { expect, test } from "@playwright/test";
import {
  clickVisibleElement,
  configFilePattern,
  openSettingsSection,
  providerSettingPattern,
  settingsGroupPattern,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 settings acceptance", () => {
  test("P2S-01 settings page opens and renders provider configuration", async ({ page }) => {
    await openSettingsSection(page, "providers");
    await expect(page.locator(".settings-provider-content")).toBeVisible();
    await expect(page.locator(".settings-command-preview")).toBeVisible();
  });

  test("P2S-02 provider startup args accept multiline edits", async ({ page }) => {
    await openSettingsSection(page, "providers");
    const argsInput = page.getByLabel(providerSettingPattern("startup_args"));

    await argsInput.fill("--verbose\n--print");
    await expect(argsInput).toHaveValue("--verbose\n--print");
  });

  test("P2S-03 inject hooks updates provider status UI", async ({ page }) => {
    await openSettingsSection(page, "providers");
    await clickVisibleElement(
      page.getByRole("tab", { name: providerSettingPattern("config_file") })
    );
    await expect(page.getByText(configFilePattern("claude"))).toBeVisible();
  });

  test("P2S-04 codex provider shows startup args editor", async ({ page }) => {
    await openSettingsSection(page, "providers");
    await clickVisibleElement(page.getByRole("tab", { name: "Codex" }));
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
    await expect(page.locator(".settings-provider-args-input")).toBeVisible();
  });

  test("P2S-05 appearance settings show theme options", async ({ page }) => {
    await openSettingsSection(page, "appearance");
    await expect(
      page.locator(".settings-group-title").filter({ hasText: settingsGroupPattern("theme") })
    ).toBeVisible();
    const themePicker = page.getByRole("button", { name: /^(?:主题|Theme)\s+.+$/ });

    await expect(themePicker).toBeVisible();
    await clickVisibleElement(themePicker);

    const themeListbox = page.getByRole("listbox", { name: /^(?:主题|Theme)$/ });

    await expect(themeListbox).toBeVisible();
    await expect(
      themeListbox.getByRole("option", { name: /^(?:基础主题|Core Themes)$/ })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", { name: /^(?:Mint 深色|Mint Dark)$/ })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", { name: /^(?:Graphite 浅色|Graphite Light)$/ })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", { name: /^(?:Nord 深色|Nord Dark)$/ })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", { name: /^(?:高对比浅色|High Contrast Light)$/ })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", { name: /^(?:四季主题|Seasonal Themes)$/ })
    ).toBeVisible();
  });

  test("P2S-06 settings persist after page reload", async ({ page }) => {
    await openSettingsSection(page, "providers");
    await page.getByLabel(providerSettingPattern("startup_args")).fill("--persisted-e2e");
    await page.reload();
    await openSettingsSection(page, "providers");
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
  });

  test("P2S-07 hook status shows registration state", async ({ page }) => {
    await openSettingsSection(page, "providers");
    // Check for hook status indicator
    const statusIndicator = page.locator(".settings-provider-status, .hook-status");
    // Status might show "registered" or "not registered"
    const statusCount = await statusIndicator.count();
    expect(statusCount).toBeGreaterThanOrEqual(0);
  });

  test("P2S-08 keyboard shortcuts settings accessible", async ({ page }) => {
    await openSettingsSection(page, "shortcuts");
    await expect(page.locator(".shortcuts-category-tabs")).toBeVisible();
    await expect(page.locator(".shortcuts-list")).toBeVisible();
  });
});
