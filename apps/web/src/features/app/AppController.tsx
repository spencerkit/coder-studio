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
  createAppSettingsDraftStore,
  createSequencedAppSettingsSaver,
  hydrateConfirmedAppSettings,
} from "../../services/http/settings.service.ts";

export default function AppController() {
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => defaultAppSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() => defaultAppSettings());
  const [backendSettingsConfirmed, setBackendSettingsConfirmed] = useState(false);
  const [lastWorkspacePath, setLastWorkspacePath] = useState("/workspace");
  const confirmedSettingsRef = useRef(appSettings);
  const backendSettingsConfirmedRef = useRef(false);
  const draftSettingsRef = useRef(createAppSettingsDraftStore(appSettings));
  const saveCoordinatorRef = useRef(createSequencedAppSettingsSaver());
  const navigate = useNavigate();
  const location = useLocation();
  const route: AppRoute = location.pathname === "/settings" ? "settings" : "workspace";

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

      draftSettingsRef.current.replace(hydrated.settings);
      confirmedSettingsRef.current = cloneAppSettings(hydrated.settings);
      backendSettingsConfirmedRef.current = hydrated.backendConfirmed;
      setAppSettings(hydrated.settings);
      setSettingsDraft(hydrated.settings);
      setLocale(hydrated.settings.general.locale);
      persistLocale(hydrated.settings.general.locale);
      setBackendSettingsConfirmed(hydrated.backendConfirmed);
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

  const applyRuntimeSettings = (saved: AppSettings, confirmedByBackend: boolean) => {
    draftSettingsRef.current.replace(saved);
    confirmedSettingsRef.current = cloneAppSettings(saved);
    backendSettingsConfirmedRef.current = confirmedByBackend;
    setAppSettings(saved);
    setSettingsDraft(saved);
    setLocale(saved.general.locale);
    persistLocale(saved.general.locale);
    setBackendSettingsConfirmed(confirmedByBackend);
  };

  const onSelectLocale = (nextLocale: Locale) => {
    const nextSettings = draftSettingsRef.current.update((draft) => {
      draft.general.locale = nextLocale;
    });
    setSettingsDraft(nextSettings);
    void saveCoordinatorRef.current.save(
      confirmedSettingsRef.current,
      nextSettings,
      undefined,
      backendSettingsConfirmedRef.current,
    )
      .then((result) => {
        if (!result.shouldApply) {
          return;
        }
        applyRuntimeSettings(result.settings, result.backendConfirmed);
      });
  };

  const onCommitSettings = (nextSettings: AppSettings) => {
    const normalized = draftSettingsRef.current.replace(cloneAppSettings(nextSettings));
    setSettingsDraft(normalized);
    void saveCoordinatorRef.current.save(
      confirmedSettingsRef.current,
      normalized,
      undefined,
      backendSettingsConfirmedRef.current,
    )
      .then((result) => {
        if (!result.shouldApply) {
          return;
        }
        applyRuntimeSettings(result.settings, result.backendConfirmed);
      });
  };

  return (
    <AuthGate locale={locale} onSelectLocale={onSelectLocale}>
      <WorkbenchRuntimeCoordinator
        locale={locale}
        appSettings={appSettings}
        settingsConfirmed={backendSettingsConfirmed}
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
              settingsDraft={settingsDraft}
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
