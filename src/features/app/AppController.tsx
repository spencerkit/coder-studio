import { useEffect, useState } from "react";
import { applyLocale, getPreferredLocale, persistLocale, type Locale } from "../../i18n";
import { SettingsScreen } from "../../features/settings";
import WorkspaceScreen from "../../features/workspace/WorkspaceScreen";
import type { AppRoute, AppSettings } from "../../types/app";
import {
  cloneAppSettings,
  persistStoredAppSettings,
  readCurrentRoute,
  readStoredAppSettings,
  routeHashFor,
} from "../../shared/app/settings";

export default function AppController() {
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const [route, setRoute] = useState<AppRoute>(() => readCurrentRoute());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readStoredAppSettings());

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    try {
      persistStoredAppSettings(appSettings);
    } catch {
      // Keep in-memory settings if persistence fails.
    }
  }, [appSettings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      setRoute(readCurrentRoute());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const navigateToRoute = (nextRoute: AppRoute) => {
    if (typeof window === "undefined") {
      setRoute(nextRoute);
      return;
    }
    const nextHash = routeHashFor(nextRoute);
    if (window.location.hash !== nextHash) {
      if (nextHash) {
        window.location.hash = nextHash;
      } else {
        const nextUrl = `${window.location.pathname}${window.location.search}`;
        window.history.pushState(null, "", nextUrl);
        setRoute("workspace");
      }
      return;
    }
    setRoute(nextRoute);
  };

  const onSelectLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    persistLocale(nextLocale);
  };

  const onCommitSettings = (nextSettings: AppSettings) => {
    const normalized = cloneAppSettings(nextSettings);
    setAppSettings(normalized);
  };

  return route === "settings" ? (
    <SettingsScreen
      locale={locale}
      appSettings={appSettings}
      onSelectLocale={onSelectLocale}
      onCommitSettings={onCommitSettings}
      onCloseSettings={() => navigateToRoute("workspace")}
    />
  ) : (
    <WorkspaceScreen
      locale={locale}
      appSettings={appSettings}
      onOpenSettings={() => navigateToRoute("settings")}
    />
  );
}
