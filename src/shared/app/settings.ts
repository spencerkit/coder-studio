import type { AppRoute, AppSettings } from "../../types/app";

const APP_SETTINGS_STORAGE_KEY = "coder-studio.app-settings";
const SETTINGS_ROUTE_HASH = "#/settings";

export const defaultAppSettings = (): AppSettings => ({
  agentProvider: "claude",
  agentCommand: "claude",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true
  }
});

export const cloneAppSettings = (settings: AppSettings): AppSettings => ({
  agentProvider: settings.agentProvider,
  agentCommand: settings.agentCommand,
  idlePolicy: { ...settings.idlePolicy }
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
      }
    };
  } catch {
    return fallback;
  }
};

export const persistStoredAppSettings = (settings: AppSettings) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

export const readCurrentRoute = (): AppRoute => {
  if (typeof window === "undefined") return "workspace";
  return window.location.hash === SETTINGS_ROUTE_HASH ? "settings" : "workspace";
};

export const routeHashFor = (route: AppRoute) => (route === "settings" ? SETTINGS_ROUTE_HASH : "");
