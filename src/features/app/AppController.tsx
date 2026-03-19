import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AuthGate from "../../components/AuthGate";
import { applyLocale, getPreferredLocale, persistLocale, type Locale } from "../../i18n";
import { SettingsScreen } from "../../features/settings";
import WorkspaceScreen from "../../features/workspace/WorkspaceScreen";
import type { AppRoute, AppSettings } from "../../types/app";
import {
  cloneAppSettings,
  persistStoredAppSettings,
  readStoredAppSettings,
} from "../../shared/app/settings";

export default function AppController() {
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readStoredAppSettings());
  const navigate = useNavigate();
  const location = useLocation();
  const route: AppRoute = location.pathname === "/settings" ? "settings" : "workspace";

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

  const navigateToRoute = (nextRoute: AppRoute) => {
    navigate(nextRoute === "settings" ? "/settings" : "/");
  };

  const onSelectLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    persistLocale(nextLocale);
  };

  const onCommitSettings = (nextSettings: AppSettings) => {
    const normalized = cloneAppSettings(nextSettings);
    setAppSettings(normalized);
  };

  return (
    <AuthGate locale={locale} onSelectLocale={onSelectLocale}>
      <Routes>
        <Route
          path="/"
          element={
            <WorkspaceScreen
              locale={locale}
              appSettings={appSettings}
              onOpenSettings={() => navigateToRoute("settings")}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsScreen
              locale={locale}
              appSettings={appSettings}
              onSelectLocale={onSelectLocale}
              onCommitSettings={onCommitSettings}
              onCloseSettings={() => navigateToRoute("workspace")}
            />
          }
        />
        <Route path="*" element={<Navigate to={route === "settings" ? "/settings" : "/"} replace />} />
      </Routes>
    </AuthGate>
  );
}
