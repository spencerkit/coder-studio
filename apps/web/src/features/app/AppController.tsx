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
  appSettingsPayloadEquals,
  defaultAppSettings,
  mergeLegacySettingsIntoAppSettings,
} from "../../shared/app/claude-settings.ts";
import {
  getAppSettings,
  updateAppSettings,
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

      try {
        const serverSettings = await getAppSettings();
        const shouldMigrateLegacy = legacySettings !== null
          && appSettingsPayloadEquals(serverSettings, fallbackDefaults);
        const shouldSyncLocale = appSettingsPayloadEquals(serverSettings, fallbackDefaults)
          && preferredLocale !== serverSettings.general.locale;

        let resolvedSettings = serverSettings;
        if (shouldMigrateLegacy || shouldSyncLocale) {
          const draft = shouldMigrateLegacy
            ? mergeLegacySettingsIntoAppSettings(serverSettings, legacySettings)
            : cloneAppSettings(serverSettings);
          draft.general.locale = shouldMigrateLegacy && legacySettings?.locale
            ? legacySettings.locale
            : preferredLocale;
          resolvedSettings = await updateAppSettings(draft);
        }

        clearStoredAppSettings();
        if (cancelled) {
          return;
        }

        const normalized = cloneAppSettings(resolvedSettings);
        setAppSettings(normalized);
        setLocale(normalized.general.locale);
        persistLocale(normalized.general.locale);
      } catch {
        if (cancelled) {
          return;
        }

        const fallback = legacySettings ?? fallbackDefaults;
        const normalized = cloneAppSettings(fallback);
        setAppSettings(normalized);
        setLocale(normalized.general.locale);
        persistLocale(normalized.general.locale);
      }
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
    setLocale(nextLocale);
    persistLocale(nextLocale);

    const nextSettings = cloneAppSettings(appSettingsRef.current);
    nextSettings.general.locale = nextLocale;
    setAppSettings(nextSettings);
    void updateAppSettings(nextSettings)
      .then((saved) => {
        setAppSettings(cloneAppSettings(saved));
      })
      .catch(() => {
        // Keep the in-memory locale if persistence fails.
      });
  };

  const onCommitSettings = (nextSettings: AppSettings) => {
    const normalized = cloneAppSettings(nextSettings);
    setAppSettings(normalized);
    void updateAppSettings(normalized)
      .then((saved) => {
        setAppSettings(cloneAppSettings(saved));
      })
      .catch(() => {
        // Keep the optimistic draft if persistence fails.
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
