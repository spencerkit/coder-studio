import type { DesktopPreferencesPatch, DesktopPreferencesSnapshot } from "@coder-studio/core";

export interface DesktopPreferencesBridge {
  getDesktopPreferences(): Promise<DesktopPreferencesSnapshot>;
  initializeDesktopTheme(themeId: string): Promise<DesktopPreferencesSnapshot>;
  updateDesktopPreferences(patch: DesktopPreferencesPatch): Promise<DesktopPreferencesSnapshot>;
  onDesktopPreferencesChanged(listener: (snapshot: DesktopPreferencesSnapshot) => void): () => void;
}

export function getDesktopPreferencesBridge(): DesktopPreferencesBridge | null {
  const bridge = window.coderStudioDesktop;
  if (
    bridge?.desktopPreferencesApiVersion !== 1 ||
    typeof bridge.getDesktopPreferences !== "function" ||
    typeof bridge.initializeDesktopTheme !== "function" ||
    typeof bridge.updateDesktopPreferences !== "function" ||
    typeof bridge.onDesktopPreferencesChanged !== "function"
  ) {
    return null;
  }
  return {
    getDesktopPreferences: () => bridge.getDesktopPreferences!(),
    initializeDesktopTheme: (themeId) => bridge.initializeDesktopTheme!(themeId),
    updateDesktopPreferences: (patch) => bridge.updateDesktopPreferences!(patch),
    onDesktopPreferencesChanged: (listener) => bridge.onDesktopPreferencesChanged!(listener),
  };
}

export function readDesktopThemeId(snapshot: DesktopPreferencesSnapshot): string | null {
  const themeId = snapshot.appearance?.themeId;
  return typeof themeId === "string" && themeId.length > 0 ? themeId : null;
}
