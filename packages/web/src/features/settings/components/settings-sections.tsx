import type { LucideIcon } from "lucide-react";
import { Globe, Keyboard, Palette, Settings } from "lucide-react";

export type SettingsSection = "general" | "appearance" | "providers" | "shortcuts";

export interface SettingsSectionMeta {
  id: SettingsSection;
  labelKey: string;
  Icon: LucideIcon;
}

export const SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.general", Icon: Settings },
  { id: "providers", labelKey: "settings.providers", Icon: Globe },
  { id: "appearance", labelKey: "settings.appearance", Icon: Palette },
  { id: "shortcuts", labelKey: "settings.shortcuts.title", Icon: Keyboard },
] as const satisfies readonly SettingsSectionMeta[];

export const MOBILE_SETTINGS_SECTIONS = SETTINGS_SECTIONS.filter(
  (section) => section.id !== "shortcuts"
);
