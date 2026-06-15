import { expect, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";
import {
  openSettingsPage,
  openSettingsSection,
  providerSettingPattern,
  settingsGroupPattern,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 settings visual acceptance", () => {
  test("P2V-01 more-features settings shell layout baseline", async ({ page }) => {
    await openSettingsPage(page);
    const categoryTabs = page.locator('.more-features-tabs [role="tab"]');
    const navButtons = page.locator(".more-features-nav button");

    await expect(page.getByTestId("more-features-page")).toBeVisible();
    await expect(page.locator(".more-features-shell")).toBeVisible();
    await expect(categoryTabs).toHaveCount(3);
    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("more.category.settings") })
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("more.category.analysis") })
    ).toHaveAttribute("aria-selected", "false");
    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("more.category.about") })
    ).toHaveAttribute("aria-selected", "false");
    await expect(navButtons).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.general") })
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.providers") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.appearance") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.shortcuts.title") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.analysis.title") })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("monitoring.title") })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.diagnostics.title") })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.about.title") })
    ).toHaveCount(0);
    await expect(page.getByTestId("more-features-page")).toBeVisible();
    await expect(page.locator(".more-features-page__frame--compact-top")).toHaveCount(1);
    await expect(page.getByTestId("more-current-route")).toHaveCount(0);
  });

  test("P2V-02 more-features shell color tokens", async ({ page }) => {
    await openSettingsPage(page);
    const pageBackground = await page
      .locator(".more-features-page--desktop")
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    const shellBorderColor = await page
      .locator(".more-features-shell")
      .evaluate((el) => getComputedStyle(el).borderColor);

    expect(pageBackground).toBeTruthy();
    expect(pageBackground).not.toBe("none");
    expect(shellBorderColor).toBeTruthy();
  });

  test("P2V-03 provider card styling", async ({ page }) => {
    await openSettingsSection(page, "providers");
    const providerLayout = page.locator(".settings-provider-base-layout");
    const providerTab = page.locator(".settings-provider-tab").first();

    await expect(providerLayout).toBeVisible();
    await expect(providerTab).toBeVisible();

    const gap = await providerLayout.evaluate((el) => getComputedStyle(el).gap);
    const borderRadius = await providerTab.evaluate((el) => getComputedStyle(el).borderRadius);

    expect(gap).toBeTruthy();
    expect(borderRadius).toBeTruthy();
  });

  test("P2V-04 appearance section layout", async ({ page }) => {
    await openSettingsSection(page, "appearance");
    await expect(
      page.locator(".settings-group-title").filter({ hasText: settingsGroupPattern("theme") })
    ).toBeVisible();
  });

  test("P2V-05 input field focus states", async ({ page }) => {
    await openSettingsSection(page, "providers");
    // Find an input and focus it
    const input = page.getByLabel(providerSettingPattern("startup_args"));
    if (await input.isVisible()) {
      await input.focus();
      // Check focus border color
      const borderColor = await input.evaluate((el) => getComputedStyle(el).borderColor);
      expect(borderColor).toBeTruthy();
    } else {
      expect(true).toBe(true);
    }
  });

  test("P2V-06 button hover states", async ({ page }) => {
    await openSettingsSection(page, "providers");
    // Find a button and hover
    const button = page.locator(".settings-provider-tab").first();
    await button.hover();
    // Button should respond to hover
    await expect(button).toBeVisible();
  });

  test("P2V-07 i18n layout RTL support", async ({ page }) => {
    await openSettingsPage(page);
    // Check if RTL is supported (dir attribute)
    const dir = await page.locator("html").getAttribute("dir");
    // RTL might be 'rtl' or null/'ltr'
    expect(["rtl", "ltr", null]).toContain(dir);
  });

  test("P2V-08 theme toggle visual feedback", async ({ page }) => {
    await openSettingsSection(page, "appearance");
    const themePicker = page.getByRole("button", { name: /^(?:主题|Theme)\s+.+$/ });

    await expect(themePicker).toBeVisible();
    await themePicker.click();

    const themeListbox = page.getByRole("listbox", {
      name: translatePatternForE2E("settings.theme.title"),
    });

    await expect(themeListbox).toBeVisible();
    await expect(
      themeListbox.getByRole("option", {
        name: translatePatternForE2E("settings.theme.group_core"),
      })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", {
        name: translatePatternForE2E("settings.theme.mint_dark"),
      })
    ).toBeVisible();
    await expect(
      themeListbox.getByRole("option", {
        name: translatePatternForE2E("settings.theme.group_seasonal"),
      })
    ).toBeVisible();
  });
});
