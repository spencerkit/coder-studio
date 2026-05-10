import { expect, test } from "@playwright/test";
import {
  configFilePattern,
  openSettingsSection,
  providerSettingPattern,
} from "../../fixtures/phase2-i18n";

test.describe("@phase2 provider acceptance", () => {
  test("desktop uses provider sub-navigation and preserves config view across providers", async ({
    page,
  }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");

    await expect(page.getByRole("tablist", { name: "Providers" })).toBeVisible();
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

    await page.getByRole("tab", { name: providerSettingPattern("config_file") }).click();
    await expect(
      page.getByRole("tab", { name: providerSettingPattern("config_file") })
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(configFilePattern("claude"))).toBeVisible();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).not.toBeVisible();

    await page.getByRole("tab", { name: "Codex" }).click();
    await expect(
      page.getByRole("tab", { name: providerSettingPattern("config_file") })
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(configFilePattern("codex"))).toBeVisible();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).not.toBeVisible();

    await page.getByRole("tab", { name: providerSettingPattern("base") }).click();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
  });

  test("desktop updates startup args per provider and keeps command preview scoped", async ({
    page,
  }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "providers");

    const argsInput = page.getByLabel(providerSettingPattern("startup_args"));
    await expect(argsInput).toBeVisible();

    await argsInput.fill("--verbose\n--print");
    await expect(page.locator(".settings-command-preview")).toContainText("--print");

    await page.getByRole("tab", { name: "Codex" }).click();
    await expect(page.getByLabel(providerSettingPattern("startup_args"))).not.toHaveValue(
      "--verbose\n--print"
    );
    await expect(page.locator(".settings-command-preview")).not.toContainText("--print");
  });

  test("mobile enters config editor through secondary action and returns to base settings", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
    });
    const page = await context.newPage();

    try {
      await page.goto("/settings");
      await openSettingsSection(page, "providers");

      await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
      await expect(page.locator(".settings-provider-subnav")).toHaveCount(0);

      await page
        .getByRole("button", { name: providerSettingPattern("open_config_file_editor") })
        .click();
      await expect(
        page.getByRole("button", { name: providerSettingPattern("back_to_base") })
      ).toBeVisible();
      await expect(page.getByText(configFilePattern("claude"))).toBeVisible();

      await page.getByRole("tab", { name: "Codex" }).click();
      await expect(page.getByLabel(providerSettingPattern("startup_args"))).toBeVisible();
      await expect(
        page.getByRole("button", { name: providerSettingPattern("back_to_base") })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
