import { expect, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";
import {
  clickVisibleElement,
  configFilePattern,
  openSettingsSection,
  providerSettingPattern,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 provider acceptance", () => {
  test("desktop uses provider sub-navigation and preserves config view across providers", async ({
    page,
  }) => {
    await openSettingsSection(page, "providers");

    await expect(
      page.getByRole("tablist", { name: translatePatternForE2E("settings.providers") })
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Claude" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("tab", { name: "Codex" })).toBeVisible();
    await expect(page.getByRole("tab", { name: providerSettingPattern("base") })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();

    await clickVisibleElement(
      page.getByRole("tab", { name: providerSettingPattern("config_file") })
    );
    await expect(
      page.getByRole("tab", { name: providerSettingPattern("config_file") })
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(configFilePattern("claude"))).toBeVisible();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).not.toBeVisible();

    await clickVisibleElement(page.getByRole("tab", { name: "Codex" }));
    await expect(
      page.getByRole("tab", { name: providerSettingPattern("config_file") })
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(configFilePattern("codex"))).toBeVisible();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).not.toBeVisible();

    await clickVisibleElement(page.getByRole("tab", { name: providerSettingPattern("base") }));
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
  });

  test("desktop scopes startup args per provider", async ({ page }) => {
    await openSettingsSection(page, "providers");

    const argsInput = page.getByLabel(providerSettingPattern("startup_args"));
    await expect(argsInput).toBeVisible();

    await argsInput.fill("--verbose\n--print");
    await expect(argsInput).toHaveValue("--verbose\n--print");

    await clickVisibleElement(page.getByRole("tab", { name: "Codex" }));
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).not.toHaveValue(
      "--verbose\n--print"
    );
  });

  test("mobile enters config editor through secondary action and returns to base settings", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
    });
    const page = await context.newPage();

    try {
      await openSettingsSection(page, "providers");

      await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
      await expect(page.locator(".settings-provider-subnav")).toHaveCount(0);

      await clickVisibleElement(
        page.getByRole("button", { name: providerSettingPattern("open_config_file_editor") })
      );
      await expect(
        page.getByRole("button", { name: providerSettingPattern("back_to_base") })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: translatePatternForE2E("settings.config_files.title"),
        })
      ).toBeVisible();
      await expect(page.getByText(configFilePattern("claude"))).toBeVisible();

      await clickVisibleElement(page.getByRole("tab", { name: "Codex" }));
      await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
      await expect(
        page.getByRole("button", { name: providerSettingPattern("back_to_base") })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
