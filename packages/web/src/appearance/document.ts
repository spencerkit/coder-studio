import { getThemeById, resolveStoredThemeId } from "../theme";
import type { AppearancePersonalization } from "./personalization";
import { resolveAppearancePersonalizationForViewport } from "./personalization";

export function resolveCurrentAppearanceViewport(): "desktop" | "mobile" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }

  return window.matchMedia("(max-width: 899px), (pointer: coarse)").matches ? "mobile" : "desktop";
}

export function applyResolvedTheme(themeId: unknown): string {
  const resolvedTheme = getThemeById(resolveStoredThemeId(themeId));
  document.documentElement.setAttribute("data-theme", resolvedTheme.documentThemeAttr);
  return resolvedTheme.id;
}

export function applyAppearancePersonalizationToDocument(
  personalization: AppearancePersonalization,
  themeId: string
): void {
  const root = document.documentElement;
  const effective = resolveAppearancePersonalizationForViewport(
    personalization,
    resolveCurrentAppearanceViewport()
  );
  const isHighContrast = themeId === "hc-dark" || themeId === "hc-light";
  const glassEnabled = !isHighContrast && effective.glassEnabled;
  const clampedBlur = isHighContrast ? 0 : Math.min(Math.max(effective.backgroundBlur, 0), 24);
  const clampedOpacity = isHighContrast
    ? 1
    : Math.min(Math.max(effective.surfaceOpacity, 0), 100) / 100;
  const clampedGlassIntensity = glassEnabled
    ? Math.min(Math.max(effective.glassIntensity, 0), 40)
    : 0;

  root.style.setProperty(
    "--app-bg-image",
    effective.backgroundMode === "image" && effective.backgroundAssetId
      ? `url(/api/appearance-assets/${effective.backgroundAssetId})`
      : "none"
  );
  root.style.setProperty("--app-bg-fit", effective.backgroundFit);
  root.style.setProperty(
    "--app-bg-dim",
    String(Math.min(Math.max(effective.backgroundDimness, 0), 100) / 100)
  );
  root.style.setProperty("--app-bg-blur", `${clampedBlur}px`);
  root.style.setProperty("--app-surface-opacity", String(clampedOpacity));
  root.style.setProperty(
    "--app-surface-backdrop-filter",
    glassEnabled ? `blur(${clampedGlassIntensity}px)` : "none"
  );
  root.setAttribute("data-appearance-glass", glassEnabled ? "on" : "off");
}
