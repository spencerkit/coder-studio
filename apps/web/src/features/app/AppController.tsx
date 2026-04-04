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
} from "../../shared/app/settings-storage";
import {
  buildAppSettingsPatch,
  defaultAppSettings,
} from "../../shared/app/app-settings";
import {
  applyAppSettingsUpdater,
  createAppSettingsDraftStore,
  createSequencedAppSettingsSaver,
  createPersistableAppSettings,
  deriveRuntimeAppSettings,
  hydrateConfirmedAppSettings,
  updateAppSettingsPatch,
} from "../../services/http/settings.service";

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
    const previousSettings = draftSettingsRef.current.get();
    const nextSettings = draftSettingsRef.current.update((draft) => {
      draft.general.locale = nextLocale;
    });
    setAppSettings(nextSettings);
    setSettingsDraft(nextSettings);
    setLocale(nextLocale);
    const previousPersistable = createPersistableAppSettings(
      previousSettings,
      confirmedSettingsRef.current,
      true,
    );
    const nextPersistable = createPersistableAppSettings(
      nextSettings,
      confirmedSettingsRef.current,
      true,
    );
    const patch = buildAppSettingsPatch(previousPersistable, nextPersistable);
    if (Object.keys(patch).length === 0) {
      return;
    }
    void saveCoordinatorRef.current.save(
      confirmedSettingsRef.current,
      nextPersistable,
      async () => updateAppSettingsPatch(patch),
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
    const previousSettings = draftSettingsRef.current.get();
    const normalized = applyAppSettingsUpdater(draftSettingsRef.current, updater);
    setSettingsDraft(normalized);
    const previousPersistable = createPersistableAppSettings(
      previousSettings,
      confirmedSettingsRef.current,
      localePreferenceExplicitRef.current,
    );
    const nextPersistable = createPersistableAppSettings(
      normalized,
      confirmedSettingsRef.current,
      localePreferenceExplicitRef.current,
    );
    const patch = buildAppSettingsPatch(previousPersistable, nextPersistable);
    if (Object.keys(patch).length === 0) {
      return;
    }
    void saveCoordinatorRef.current.saveWithPersist(
      confirmedSettingsRef.current,
      async () => updateAppSettingsPatch(patch),
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
