import type { IconSemantic } from "../../../theme";

export type SettingsSection = "general" | "appearance" | "providers" | "shortcuts" | "diagnostics";

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
  {
    id: "diagnostics",
    labelKey: "settings.help_diagnostics",
    iconSemantic: "nav.settings.diagnostics",
  },
] as const satisfies readonly SettingsSectionMeta[];

export const MOBILE_SETTINGS_SECTIONS = SETTINGS_SECTIONS;
