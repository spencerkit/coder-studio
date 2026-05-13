import { type AppThemeDefinition, THEME_IDS, THEMES, type ThemeFamily } from "./registry";

const DEFAULT_THEME_ID = "mint-dark";
const LEGACY_THEME_ID_MAP = {
  dark: "mint-dark",
  light: "mint-light",
} as const;

const themeById = new Map<string, AppThemeDefinition>(THEMES.map((theme) => [theme.id, theme]));

export function getThemeById(themeId: string): AppThemeDefinition {
  return themeById.get(resolveStoredThemeId(themeId)) ?? themeById.get(DEFAULT_THEME_ID)!;
}

export function resolveStoredThemeId(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_THEME_ID;
  }

  if (Object.hasOwn(LEGACY_THEME_ID_MAP, value)) {
    return LEGACY_THEME_ID_MAP[value as keyof typeof LEGACY_THEME_ID_MAP];
  }

  return THEME_IDS.includes(value) ? value : DEFAULT_THEME_ID;
}

export function getThemeFamily(themeId: string): ThemeFamily {
  return getThemeById(themeId).family;
}

export function getThemeVariant(themeId: string): "dark" | "light" {
  return getThemeById(themeId).kind;
}

export function getThemeIdForFamilyVariant(
  family: ThemeFamily,
  variant: "dark" | "light"
): string | null {
  return THEMES.find((theme) => theme.family === family && theme.kind === variant)?.id ?? null;
}
