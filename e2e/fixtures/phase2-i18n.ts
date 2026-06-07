import { type Page } from "@playwright/test";
import { type E2ELocaleCode, translateForE2E } from "./i18n.js";

type SettingsSection = "general" | "appearance" | "providers" | "shortcuts" | "analysis";
type ProviderSettingLabel =
  | "base"
  | "config_file"
  | "open_config_file_editor"
  | "back_to_base"
  | "startup_args";
type SettingsGroupLabel = "notifications" | "theme" | "language";
type ConfigFileLabel = "claude" | "codex";

const SETTINGS_SECTION_KEYS: Record<SettingsSection, Parameters<typeof translateForE2E>[0]> = {
  general: "settings.general",
  appearance: "settings.appearance",
  providers: "settings.providers",
  analysis: "settings.analysis.title",
  shortcuts: "settings.shortcuts.title",
};

const PROVIDER_SETTING_KEYS: Record<ProviderSettingLabel, Parameters<typeof translateForE2E>[0]> = {
  base: "settings.provider.base",
  config_file: "settings.provider.config_file",
  open_config_file_editor: "settings.provider.open_config_file_editor",
  back_to_base: "settings.provider.back_to_base",
  startup_args: "settings.provider.startup_args",
};

const SETTINGS_GROUP_KEYS: Record<SettingsGroupLabel, Parameters<typeof translateForE2E>[0]> = {
  notifications: "settings.notifications",
  theme: "settings.theme.title",
  language: "settings.language.title",
};

const CONFIG_FILE_KEYS: Record<ConfigFileLabel, Parameters<typeof translateForE2E>[0]> = {
  claude: "settings.config_files.claude_config",
  codex: "settings.config_files.codex_config",
};

export const AUTH_PREVIEW_URL = new URL("../../packages/web/auth-preview.html", import.meta.url)
  .href;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localizedPattern(
  key: Parameters<typeof translateForE2E>[0],
  params?: Record<string, string | number>
): RegExp {
  const en = translateForE2E(key, "en", params);
  const zh = translateForE2E(key, "zh", params);
  const values = [...new Set([en, zh])].map(escapeRegExp);
  return new RegExp(`^(?:${values.join("|")})$`);
}

export function settingsSectionLabel(
  section: SettingsSection,
  locale: E2ELocaleCode = "zh"
): string {
  return translateForE2E(SETTINGS_SECTION_KEYS[section], locale);
}

export function settingsSectionPattern(section: SettingsSection): RegExp {
  return localizedPattern(SETTINGS_SECTION_KEYS[section]);
}

export async function openSettingsSection(
  page: Page,
  section: SettingsSection,
  locale?: E2ELocaleCode
): Promise<void> {
  await page
    .getByRole("button", {
      name: locale ? settingsSectionLabel(section, locale) : settingsSectionPattern(section),
    })
    .click();
}

export function providerSettingLabel(
  label: ProviderSettingLabel,
  locale: E2ELocaleCode = "zh"
): string {
  return translateForE2E(PROVIDER_SETTING_KEYS[label], locale);
}

export function providerSettingPattern(label: ProviderSettingLabel): RegExp {
  return localizedPattern(PROVIDER_SETTING_KEYS[label]);
}

export function settingsGroupLabel(
  label: SettingsGroupLabel,
  locale: E2ELocaleCode = "zh"
): string {
  return translateForE2E(SETTINGS_GROUP_KEYS[label], locale);
}

export function settingsGroupPattern(label: SettingsGroupLabel): RegExp {
  return localizedPattern(SETTINGS_GROUP_KEYS[label]);
}

export function configFileLabel(label: ConfigFileLabel, locale: E2ELocaleCode = "zh"): string {
  return translateForE2E(CONFIG_FILE_KEYS[label], locale);
}

export function configFilePattern(label: ConfigFileLabel): RegExp {
  return localizedPattern(CONFIG_FILE_KEYS[label]);
}
