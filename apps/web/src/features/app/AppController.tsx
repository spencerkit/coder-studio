import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AuthGate from "../../components/AuthGate";
import {
  applyLocale,
  clearLocalePreference,
  getPreferredLocale,
  getSystemLocale,
  persistLocale,
  readStoredLocalePreference,
  type Locale,
} from "../../i18n";
import { SettingsScreen } from "../../features/settings";
import WorkspaceScreen from "../../features/workspace/WorkspaceScreen";
import type { AppRoute, AppSettings, AppSettingsUpdater } from "../../types/app";
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
  applyAppSettingsUpdater,
  createAppSettingsDraftStore,
  createSequencedAppSettingsSaver,
  createPersistableAppSettings,
  deriveRuntimeAppSettings,
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
  const localePreferenceExplicitRef = useRef(readStoredLocalePreference() !== null);
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
      const explicitLocale = readStoredLocalePreference();
      const preferredLocale = explicitLocale ?? getSystemLocale();
      const fallbackDefaults = defaultAppSettings();
      const hydrated = await hydrateConfirmedAppSettings({
        fallbackSettings: fallbackDefaults,
        legacySettings,
        preferredLocale,
        preferredLocaleIsExplicit: explicitLocale !== null,
      });

      if (hydrated.clearLegacyStorage) {
        clearStoredAppSettings();
      }
      if (cancelled) {
        return;
      }

      applyRuntimeSettings(hydrated.settings, hydrated.backendConfirmed, hydrated.localeExplicit);
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

  const applyRuntimeSettings = (
    saved: AppSettings,
    confirmedByBackend: boolean,
    localeExplicit = localePreferenceExplicitRef.current,
  ) => {
    const runtimeSettings = deriveRuntimeAppSettings({
      settings: saved,
      localeExplicit,
      systemLocale: getSystemLocale(),
      explicitLocale: readStoredLocalePreference(),
    });

    draftSettingsRef.current.replace(runtimeSettings);
    confirmedSettingsRef.current = cloneAppSettings(saved);
    backendSettingsConfirmedRef.current = confirmedByBackend;
    localePreferenceExplicitRef.current = localeExplicit;
    setAppSettings(runtimeSettings);
    setSettingsDraft(runtimeSettings);
    setLocale(runtimeSettings.general.locale);
    if (localeExplicit) {
      applyLocale(runtimeSettings.general.locale);
    } else {
      clearLocalePreference();
      applyLocale(runtimeSettings.general.locale);
    }
    setBackendSettingsConfirmed(confirmedByBackend);
  };

  const onSelectLocale = (nextLocale: Locale) => {
    persistLocale(nextLocale);
    localePreferenceExplicitRef.current = true;
    const nextSettings = draftSettingsRef.current.update((draft) => {
      draft.general.locale = nextLocale;
    });
    setAppSettings(nextSettings);
    setSettingsDraft(nextSettings);
    setLocale(nextLocale);
    void saveCoordinatorRef.current.save(
      confirmedSettingsRef.current,
      createPersistableAppSettings(nextSettings, confirmedSettingsRef.current, true),
      undefined,
      backendSettingsConfirmedRef.current,
    )
      .then((result) => {
        if (!result.shouldApply) {
          return;
        }
        applyRuntimeSettings(result.settings, result.backendConfirmed, true);
      });
  };

  const onCommitSettings = (updater: AppSettingsUpdater) => {
    const normalized = applyAppSettingsUpdater(draftSettingsRef.current, updater);
    setSettingsDraft(normalized);
    void saveCoordinatorRef.current.save(
      confirmedSettingsRef.current,
      createPersistableAppSettings(
        normalized,
        confirmedSettingsRef.current,
        localePreferenceExplicitRef.current,
      ),
      undefined,
      backendSettingsConfirmedRef.current,
    )
      .then((result) => {
        if (!result.shouldApply) {
          return;
        }
        applyRuntimeSettings(
          result.settings,
          result.backendConfirmed,
          localePreferenceExplicitRef.current,
        );
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
