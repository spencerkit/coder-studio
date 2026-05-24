import type { IconSemantic } from "../../../theme";

export type SettingsSection = "general" | "appearance" | "providers" | "shortcuts" | "about";

export interface SettingsSectionMeta {
  id: SettingsSection;
  labelKey: string;
  iconSemantic: IconSemantic;
}

export const SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.general", iconSemantic: "nav.settings.general" },
  { id: "providers", labelKey: "settings.providers", iconSemantic: "nav.settings.providers" },
  { id: "appearance", labelKey: "settings.appearance", iconSemantic: "nav.settings.appearance" },
  { id: "shortcuts", labelKey: "settings.shortcuts.title", iconSemantic: "nav.settings.shortcuts" },
  { id: "about", labelKey: "settings.about.title", iconSemantic: "nav.settings.about" },
] as const satisfies readonly SettingsSectionMeta[];

export const MOBILE_SETTINGS_SECTIONS = SETTINGS_SECTIONS;
