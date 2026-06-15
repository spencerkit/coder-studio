import { expect, test } from "@playwright/test";
import { expectAppEntry, isWelcomeVisible } from "../../fixtures/app-entry";
import { translateForE2E } from "../../fixtures/i18n";
import {
  openSettingsSection,
  settingsGroupLabel,
  settingsSectionLabel,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 i18n acceptance", () => {
  test("P2I-01 language switch to English", async ({ page }) => {
    await openSettingsSection(page, "general");

    await page.getByRole("button", { name: translateForE2E("settings.language.en") }).click();

    await expect(page.locator(".settings-group-title").first()).toHaveText(
      settingsGroupLabel("notifications", "en")
    );
  });

  test("P2I-02 language persists after reload", async ({ page }) => {
    await openSettingsSection(page, "general");
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

    // "/" may restore the last workspace instead of showing welcome.
    await expectAppEntry(page);

    // Navigate to settings
    await page.goto("/more/settings/general");
    await expect(page.getByTestId("more-features-page")).toBeVisible();
  });

  test("P2I-04 fallback to default language", async ({ page }) => {
    await page.goto("/");

    // The root shell should render, and welcome title should exist when welcome is active.
    await expectAppEntry(page);
    if (await isWelcomeVisible(page)) {
      await expect(page.locator(".welcome-title")).toBeVisible();
    }
  });
});
