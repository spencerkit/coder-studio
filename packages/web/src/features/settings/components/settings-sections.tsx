import type { IconSemantic } from "../../../theme";

export type SettingsSection =
  | "general"
  | "providers"
  | "appearance"
  | "shortcuts"
  | "monitoring"
  | "analysis"
  | "diagnostics"
  | "about";

export interface SettingsSectionMeta {
  id: SettingsSection;
  labelKey: string;
  iconSemantic: IconSemantic;
}

const VISIBLE_SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.general", iconSemantic: "nav.settings.general" },
  { id: "providers", labelKey: "settings.providers", iconSemantic: "nav.settings.providers" },
  { id: "appearance", labelKey: "settings.appearance", iconSemantic: "nav.settings.appearance" },
  { id: "shortcuts", labelKey: "settings.shortcuts.title", iconSemantic: "nav.settings.shortcuts" },
] as const satisfies readonly SettingsSectionMeta[];

const HIDDEN_SETTINGS_SECTIONS = [
  { id: "monitoring", labelKey: "monitoring.title", iconSemantic: "nav.settings.monitoring" },
  { id: "analysis", labelKey: "settings.analysis.title", iconSemantic: "nav.settings.analysis" },
  {
    id: "diagnostics",
    labelKey: "settings.diagnostics.title",
    iconSemantic: "nav.settings.diagnostics",
  },
  { id: "about", labelKey: "settings.about.title", iconSemantic: "nav.settings.about" },
] as const satisfies readonly SettingsSectionMeta[];

export const SETTINGS_SECTIONS = VISIBLE_SETTINGS_SECTIONS;
export const MOBILE_SETTINGS_SECTIONS = SETTINGS_SECTIONS;
export const ALL_SETTINGS_SECTIONS = [
  ...VISIBLE_SETTINGS_SECTIONS,
  ...HIDDEN_SETTINGS_SECTIONS,
] as const satisfies readonly SettingsSectionMeta[];
