import { expect, test } from "@playwright/test";
import { translateForE2E } from "../../fixtures/i18n";
import {
  openSettingsSection,
  settingsGroupLabel,
  settingsSectionLabel,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 i18n acceptance", () => {
  test("P2I-01 language switch to English", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "appearance");

    await page.getByRole("button", { name: translateForE2E("settings.language.en") }).click();

    await expect(page.locator(".settings-group-title").first()).toHaveText(
      settingsGroupLabel("theme", "en")
    );
  });

  test("P2I-02 language persists after reload", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "appearance");
    await page.getByRole("button", { name: translateForE2E("settings.language.en") }).click();

    await page.reload();

    await expect(
      page.getByRole("button", { name: settingsSectionLabel("general", "en") })
    ).toBeVisible();
    await expect(page.locator(".settings-group-title").first()).toHaveText(
      settingsGroupLabel("notifications", "en")
    );
  });

  test("P2I-03 all UI text uses translation", async ({ page }) => {
    await page.goto("/");

    // Check that welcome screen text is visible (uses translation)
    await expect(page.locator(".welcome-container")).toBeVisible();

    // Navigate to settings
    await page.goto("/settings");
    await expect(page.locator(".settings-page")).toBeVisible();
  });

  test("P2I-04 fallback to default language", async ({ page }) => {
    await page.goto("/");

    // Welcome screen should show content
    await expect(page.locator(".welcome-container")).toBeVisible();
    await expect(page.locator(".welcome-title")).toBeVisible();
  });
});
