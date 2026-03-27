import type { AppSettings } from "../../types/app";

const APP_SETTINGS_STORAGE_KEY = "coder-studio.app-settings";
const readBoolean = (value: unknown, fallback: boolean) => (
  typeof value === "boolean" ? value : fallback
);

export const defaultAppSettings = (): AppSettings => ({
  agentProvider: "claude",
  agentCommand: "claude",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true
  },
  completionNotifications: {
    enabled: true,
    onlyWhenBackground: true
  },
  terminalCompatibilityMode: "standard"
});

export const cloneAppSettings = (settings: AppSettings): AppSettings => ({
  agentProvider: settings.agentProvider,
  agentCommand: settings.agentCommand,
  idlePolicy: { ...settings.idlePolicy },
  completionNotifications: { ...settings.completionNotifications },
  terminalCompatibilityMode: settings.terminalCompatibilityMode
});

export const readStoredAppSettings = (): AppSettings => {
  const fallback = defaultAppSettings();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      agentProvider: "claude",
      agentCommand: typeof parsed.agentCommand === "string" && parsed.agentCommand.trim() ? parsed.agentCommand : fallback.agentCommand,
      idlePolicy: {
        enabled: parsed.idlePolicy?.enabled ?? fallback.idlePolicy.enabled,
        idleMinutes: Number.isFinite(parsed.idlePolicy?.idleMinutes) ? Math.max(1, Number(parsed.idlePolicy?.idleMinutes)) : fallback.idlePolicy.idleMinutes,
        maxActive: Number.isFinite(parsed.idlePolicy?.maxActive) ? Math.max(1, Number(parsed.idlePolicy?.maxActive)) : fallback.idlePolicy.maxActive,
        pressure: parsed.idlePolicy?.pressure ?? fallback.idlePolicy.pressure
      },
      completionNotifications: {
        enabled: readBoolean(parsed.completionNotifications?.enabled, fallback.completionNotifications.enabled),
        onlyWhenBackground: readBoolean(parsed.completionNotifications?.onlyWhenBackground, fallback.completionNotifications.onlyWhenBackground)
      },
      terminalCompatibilityMode: parsed.terminalCompatibilityMode === "compatibility"
        ? "compatibility"
        : fallback.terminalCompatibilityMode
    };
  } catch {
    return fallback;
  }
};

export const persistStoredAppSettings = (settings: AppSettings) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};
