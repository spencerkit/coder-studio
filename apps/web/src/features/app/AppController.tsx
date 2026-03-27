import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AuthGate from "../../components/AuthGate";
import { applyLocale, getPreferredLocale, persistLocale, type Locale } from "../../i18n";
import { SettingsScreen } from "../../features/settings";
import WorkspaceScreen from "../../features/workspace/WorkspaceScreen";
import type { AppRoute, AppSettings } from "../../types/app";
import { WorkbenchRuntimeCoordinator } from "./WorkbenchRuntimeCoordinator";
import {
  clearStoredAppSettings,
  cloneAppSettings,
  readStoredAppSettings,
} from "../../shared/app/settings";
import {
  defaultAppSettings,
} from "../../shared/app/claude-settings.ts";
import {
  hydrateConfirmedAppSettings,
  persistConfirmedAppSettings,
} from "../../services/http/settings.service.ts";

export default function AppController() {
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => defaultAppSettings());
  const [lastWorkspacePath, setLastWorkspacePath] = useState("/workspace");
  const appSettingsRef = useRef(appSettings);
  const navigate = useNavigate();
  const location = useLocation();
  const route: AppRoute = location.pathname === "/settings" ? "settings" : "workspace";

  useEffect(() => {
    appSettingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    const hydrateAppSettings = async () => {
      const legacySettings = readStoredAppSettings();
      const preferredLocale = getPreferredLocale();
      const fallbackDefaults = defaultAppSettings();
      const hydrated = await hydrateConfirmedAppSettings({
        fallbackSettings: fallbackDefaults,
        legacySettings,
        preferredLocale,
      });

      if (hydrated.clearLegacyStorage) {
        clearStoredAppSettings();
      }
      if (cancelled) {
        return;
      }

      setAppSettings(hydrated.settings);
      setLocale(hydrated.settings.general.locale);
      persistLocale(hydrated.settings.general.locale);
    };

    void hydrateAppSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith("/workspace")) {
      setLastWorkspacePath(location.pathname || "/workspace");
    }
  }, [location.pathname]);

  const navigateToRoute = (nextRoute: AppRoute) => {
    navigate(nextRoute === "settings" ? "/settings" : lastWorkspacePath);
  };

  const onSelectLocale = (nextLocale: Locale) => {
    const nextSettings = cloneAppSettings(appSettingsRef.current);
    nextSettings.general.locale = nextLocale;
    void persistConfirmedAppSettings(appSettingsRef.current, nextSettings)
      .then((saved) => {
        setAppSettings(saved);
        setLocale(saved.general.locale);
        persistLocale(saved.general.locale);
      });
  };

  const onCommitSettings = (nextSettings: AppSettings) => {
    const normalized = cloneAppSettings(nextSettings);
    void persistConfirmedAppSettings(appSettingsRef.current, normalized)
      .then((saved) => {
        setAppSettings(saved);
        setLocale(saved.general.locale);
        persistLocale(saved.general.locale);
      });
  };

  return (
    <AuthGate locale={locale} onSelectLocale={onSelectLocale}>
      <WorkbenchRuntimeCoordinator
        locale={locale}
        appSettings={appSettings}
      />
      <Routes>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route
          path="/workspace"
          element={
            <WorkspaceScreen
              locale={locale}
              appSettings={appSettings}
              onOpenSettings={() => navigateToRoute("settings")}
            />
          }
        />
        <Route
          path="/workspace/:workspaceId"
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
              onCloseSettings={() => navigate(lastWorkspacePath)}
            />
          }
        />
        <Route path="*" element={<Navigate to={route === "settings" ? "/settings" : lastWorkspacePath} replace />} />
      </Routes>
    </AuthGate>
  );
}
