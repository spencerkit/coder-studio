export {
  BASE_ICON_THEME,
  createIconTheme,
  getIconPresentation,
  ICON_SEMANTICS,
  type IconPresentationDefinition,
  type IconSemantic,
  type IconSurface,
  type IconThemeDefinition,
  type IconTone,
  type ResolvedIconPresentation,
  registerIconThemes,
} from "./icon-theme";
export {
  type AppThemeDefinition,
  createWorkspaceMonacoTheme,
  type MonacoThemeDefinition,
  type TerminalThemeDefinition,
  THEME_IDS,
  THEMES,
  type ThemeFamily,
  type ThemeKind,
} from "./registry";
export {
  getThemeById,
  getThemeFamily,
  getThemeIdForFamilyVariant,
  getThemeVariant,
  resolveStoredThemeId,
} from "./resolve";
export { useTerminalThemeBackground } from "./use-terminal-theme-background";
