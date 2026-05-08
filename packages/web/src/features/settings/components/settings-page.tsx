/**
 * Settings Page Component
 *
 * Configuration page for provider, appearance, and notifications.
 */

import {
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  resolveSupervisorEvaluationTimeoutSec,
} from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { localeAtom, themeAtom } from "../../../atoms/app-ui";
import {
  connectionStatusAtom,
  dispatchCommandAtom,
  serverInfoAtom,
} from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";
import { Input, Notice, Pill, Switch } from "../../../components/ui";
import { useViewport } from "../../../hooks/use-viewport";
import { useTranslation } from "../../../lib/i18n";
import { notificationPreferencesAtom } from "../../notifications/atoms";
import { PageHeader } from "../../shared/components/page-header";
import { type ProviderInfo, ProviderSettings } from "./provider-settings";
import { resolveSettingsExitTargetFromBrowserHistory } from "./settings-navigation";
import {
  MOBILE_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "./settings-sections";
import { ShortcutsSettings } from "./shortcuts-settings";

type NotificationCapabilityStatus = "available" | "limited" | "unsupported";
type NotificationPermissionState = NotificationPermission | "unavailable";
type SettingsNavigationState =
  | {
      kind: "root";
      lastSection: SettingsSection;
    }
  | {
      kind: "detail";
      section: SettingsSection;
    };

type SettingsContentLayoutMode = "default" | "fill-height";

const DEFAULT_SETTINGS_SECTION: SettingsSection = SETTINGS_SECTIONS[0].id;

function isStandaloneWebApp(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

function isMobileUserAgent(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const { userAgent = "", maxTouchPoints = 0, platform = "" } = window.navigator;
  const ua = userAgent.toLowerCase();

  return (
    /android|iphone|ipad|ipod|mobile/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

function detectNotificationCapability(): NotificationCapabilityStatus {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  if (!isMobileUserAgent()) {
    return "available";
  }

  return isStandaloneWebApp() ? "available" : "limited";
}

function formatProviderAdditionalArgs(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.filter((item): item is string => typeof item === "string").join("\n");
}

function loadProviderAdditionalArgs(
  settings: Record<string, unknown>,
  providers: ProviderInfo[]
): Record<string, string> {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      formatProviderAdditionalArgs(settings[`providers.${provider.id}.additionalArgs`]),
    ])
  );
}

/**
 * Settings Page
 *
 * PRD §13:
 *   - Two-column layout: sidebar (200px) + content area
 *   - Navigation sections: General, Provider (per provider), Appearance
 *   - General: notifications
 *   - Provider: config fields and command preview
 *   - Appearance: theme, terminal renderer, language
 */
export function SettingsPage() {
  const t = useTranslation();
  const settingsLoadFailedUnknown = t("settings.load_failed_unknown");
  const navigate = useNavigate();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const serverInfo = useAtomValue(serverInfoAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const [navigationState, setNavigationState] = useState<SettingsNavigationState>(() =>
    isMobile
      ? { kind: "root", lastSection: DEFAULT_SETTINGS_SECTION }
      : { kind: "detail", section: DEFAULT_SETTINGS_SECTION }
  );

  // Provider settings state (would come from server in real implementation)
  const [providers] = useState<ProviderInfo[]>([
    { id: "claude", displayName: "Claude" },
    { id: "codex", displayName: "Codex" },
  ]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [supervisorEvaluationTimeoutSec, setSupervisorEvaluationTimeoutSec] = useState(
    DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC
  );
  const [terminalRenderer, setTerminalRendererState] = useState<"standard" | "compatibility">(
    "standard"
  );
  const [providerAdditionalArgsById, setProviderAdditionalArgsById] = useState<
    Record<string, string>
  >({});
  const [contentLayoutMode, setContentLayoutMode] = useState<SettingsContentLayoutMode>("default");
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  const [locale, setLocaleState] = useAtom(localeAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const settingsLoadFailedUnknownRef = useRef(settingsLoadFailedUnknown);
  const appearanceSelectionVersionRef = useRef({
    locale: 0,
    terminalRenderer: 0,
  });
  const detailSection =
    navigationState.kind === "detail" ? navigationState.section : navigationState.lastSection;
  const availableSections = isMobile ? MOBILE_SETTINGS_SECTIONS : SETTINGS_SECTIONS;
  const activeSectionMeta =
    availableSections.find((section) => section.id === detailSection) ?? availableSections[0];

  useEffect(() => {
    settingsLoadFailedUnknownRef.current = settingsLoadFailedUnknown;
  }, [settingsLoadFailedUnknown]);

  useEffect(() => {
    setNavigationState((state) => {
      if (isMobile) {
        return state.kind === "root" ? state : { kind: "root", lastSection: state.section };
      }

      return state.kind === "detail" ? state : { kind: "detail", section: state.lastSection };
    });
  }, [isMobile]);

  useEffect(() => {
    if (connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      const appearanceSelectionVersionAtRequestStart = {
        ...appearanceSelectionVersionRef.current,
      };
      const result = await dispatch<Record<string, unknown>>("settings.get", {});
      if (!result.ok || !result.data) {
        if (!cancelled) {
          setSettingsLoadError(result.error?.message ?? settingsLoadFailedUnknownRef.current);
        }
        return;
      }

      const settings = result.data;
      if (cancelled) return;
      setSettingsLoadError(null);
      if (typeof settings["notifications.enabled"] === "boolean") {
        setNotificationsEnabled(settings["notifications.enabled"]);
      }
      if (typeof settings["notifications.soundEnabled"] === "boolean") {
        setSoundEnabled(settings["notifications.soundEnabled"]);
      }
      setSupervisorEvaluationTimeoutSec(
        resolveSupervisorEvaluationTimeoutSec(settings["supervisor.evaluationTimeoutSec"])
      );
      setNotificationPreferences({
        enabled:
          typeof settings["notifications.enabled"] === "boolean"
            ? settings["notifications.enabled"]
            : true,
        soundEnabled:
          typeof settings["notifications.soundEnabled"] === "boolean"
            ? settings["notifications.soundEnabled"]
            : true,
      });
      if (
        settings["appearance.terminalRenderer"] === "standard" ||
        settings["appearance.terminalRenderer"] === "compatibility"
      ) {
        if (
          appearanceSelectionVersionRef.current.terminalRenderer ===
          appearanceSelectionVersionAtRequestStart.terminalRenderer
        ) {
          setTerminalRendererState(settings["appearance.terminalRenderer"]);
        }
      }
      if (settings["appearance.locale"] === "zh" || settings["appearance.locale"] === "en") {
        if (
          appearanceSelectionVersionRef.current.locale ===
          appearanceSelectionVersionAtRequestStart.locale
        ) {
          setLocaleState(settings["appearance.locale"]);
        }
      }
      setProviderAdditionalArgsById(loadProviderAdditionalArgs(settings, providers));
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [connectionStatus, dispatch, setLocaleState, setNotificationPreferences, settingsRefreshKey]);

  const handleLocaleSelection = (value: "zh" | "en") => {
    appearanceSelectionVersionRef.current.locale += 1;
    setLocaleState(value);
  };

  const handleTerminalRendererSelection = (value: "standard" | "compatibility") => {
    appearanceSelectionVersionRef.current.terminalRenderer += 1;
    setTerminalRendererState(value);
  };

  useEffect(() => {
    if (detailSection !== "providers") {
      setContentLayoutMode("default");
    }
  }, [detailSection]);

  const handlePageExit = () => {
    const target = resolveSettingsExitTargetFromBrowserHistory(Boolean(activeWorkspaceId));

    if (target === "history") {
      navigate(-1);
      return;
    }

    navigate(target);
  };

  const handleBack = () => {
    if (isMobile && navigationState.kind === "detail") {
      setNavigationState({ kind: "root", lastSection: navigationState.section });
      return;
    }

    handlePageExit();
  };

  // Render content based on active section
  const renderContent = () => {
    switch (detailSection) {
      case "general":
        return (
          <GeneralSettings
            notificationsEnabled={notificationsEnabled}
            setNotificationsEnabled={setNotificationsEnabled}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
            supervisorEvaluationTimeoutSec={supervisorEvaluationTimeoutSec}
            setSupervisorEvaluationTimeoutSec={setSupervisorEvaluationTimeoutSec}
          />
        );
      case "appearance":
        return (
          <AppearanceSettings
            locale={locale}
            setLocale={handleLocaleSelection}
            terminalRenderer={terminalRenderer}
            setTerminalRenderer={handleTerminalRendererSelection}
            theme={theme}
            setTheme={setTheme}
          />
        );
      case "providers":
        return (
          <ProviderSettings
            providers={providers}
            additionalArgsById={providerAdditionalArgsById}
            setAdditionalArgsById={setProviderAdditionalArgsById}
            isMobile={isMobile}
            onLayoutModeChange={setContentLayoutMode}
          />
        );
      case "shortcuts":
        return isMobile ? null : <ShortcutsSettings />;
      default:
        return null;
    }
  };

  const renderMobileRoot = () => (
    <main className="settings-content settings-content--mobile-root">
      <div className="settings-mobile-list">
        {availableSections.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className="settings-mobile-item"
            onClick={() => setNavigationState({ kind: "detail", section: id })}
          >
            <span className="settings-mobile-item__icon">
              <Icon size={18} />
            </span>
            <span className="settings-mobile-item__label">{t(labelKey)}</span>
            <ChevronRight size={16} className="settings-mobile-item__arrow" />
          </button>
        ))}
      </div>
    </main>
  );

  const shouldShowMobileRoot = isMobile && navigationState.kind === "root";
  const headerTitle = isMobile
    ? t(shouldShowMobileRoot ? "settings.title" : activeSectionMeta.labelKey)
    : t("settings.title");

  return (
    <div className={`settings-page ${isMobile ? "settings-page--mobile" : ""}`}>
      <header className="settings-header">
        <PageHeader
          title={headerTitle}
          titleAs="div"
          onBack={handleBack}
          backLabel={t("action.back")}
        />
      </header>

      {shouldShowMobileRoot ? (
        renderMobileRoot()
      ) : (
        <div
          className={`settings-body ${isMobile ? "settings-body--mobile" : ""} ${contentLayoutMode === "fill-height" ? "settings-body--fill-height" : ""}`}
        >
          {isMobile ? null : (
            <aside className="settings-sidebar">
              <nav className="settings-nav">
                {availableSections.map(({ id, labelKey, Icon }) => (
                  <SettingsNavItem
                    key={id}
                    icon={<Icon size={16} />}
                    label={t(labelKey)}
                    active={detailSection === id}
                    onClick={() => setNavigationState({ kind: "detail", section: id })}
                  />
                ))}
              </nav>
            </aside>
          )}

          <main
            className={`settings-content ${isMobile ? "settings-content--mobile" : ""} ${contentLayoutMode === "fill-height" ? "settings-content--fill-height" : ""}`}
          >
            {settingsLoadError && (
              <Notice
                role="alert"
                tone="error"
                title={t("settings.load_failed")}
                message={settingsLoadError}
                action={
                  <button
                    type="button"
                    className="settings-link"
                    onClick={() => setSettingsRefreshKey((value) => value + 1)}
                  >
                    {t("action.refresh")}
                  </button>
                }
              />
            )}
            {renderContent()}
          </main>
        </div>
      )}

      <footer className={`settings-footer ${isMobile ? "settings-footer--mobile" : ""}`}>
        <span className="settings-autosave">{t("settings.autosave_hint")}</span>
        <span className="settings-version">v{serverInfo?.version ?? "0.0.0"}</span>
      </footer>
    </div>
  );
}

interface SettingsNavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SettingsNavItem({ icon, label, active, onClick }: SettingsNavItemProps) {
  return (
    <button
      className={`settings-nav-item ${active ? "settings-nav-item-active" : ""}`}
      onClick={onClick}
    >
      <span className="settings-nav-icon">{icon}</span>
      <span className="settings-nav-label">{label}</span>
      {active && <ChevronRight size={14} className="settings-nav-arrow" />}
    </button>
  );
}

interface GeneralSettingsProps {
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (value: boolean) => void;
  supervisorEvaluationTimeoutSec: number;
  setSupervisorEvaluationTimeoutSec: (value: number) => void;
}

function parseSupervisorTimeoutInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC
  ) {
    return null;
  }

  return parsed;
}

function GeneralSettings({
  notificationsEnabled,
  setNotificationsEnabled,
  soundEnabled,
  setSoundEnabled,
  supervisorEvaluationTimeoutSec,
  setSupervisorEvaluationTimeoutSec,
}: GeneralSettingsProps) {
  const t = useTranslation();
  const notificationsLabelId = useId();
  const notificationsDescId = useId();
  const soundLabelId = useId();
  const soundDescId = useId();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>("unavailable");
  const [notificationCapability, setNotificationCapability] =
    useState<NotificationCapabilityStatus>("unsupported");
  const [supervisorTimeoutDraft, setSupervisorTimeoutDraft] = useState(
    String(supervisorEvaluationTimeoutSec)
  );
  const [supervisorTimeoutError, setSupervisorTimeoutError] = useState<string | null>(null);

  const saveSettings = async (settings: Record<string, unknown>) => {
    return await dispatch("settings.update", { settings });
  };

  const syncNotificationPreferences = (next: { enabled: boolean; soundEnabled: boolean }) => {
    setNotificationPreferences(next);
  };

  useEffect(() => {
    setNotificationCapability(detectNotificationCapability());

    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
      return;
    }

    setNotificationPermission("unavailable");
  }, []);

  useEffect(() => {
    setSupervisorTimeoutDraft(String(supervisorEvaluationTimeoutSec));
  }, [supervisorEvaluationTimeoutSec]);

  useEffect(() => {
    setSupervisorTimeoutError(null);
  }, [supervisorEvaluationTimeoutSec]);

  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  const commitSupervisorTimeout = async () => {
    const parsed = parseSupervisorTimeoutInput(supervisorTimeoutDraft);
    if (parsed === null) {
      setSupervisorTimeoutDraft(String(supervisorEvaluationTimeoutSec));
      setSupervisorTimeoutError(
        t("settings.supervisor.validation_error", {
          max: MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
        })
      );
      return;
    }

    if (parsed === supervisorEvaluationTimeoutSec) {
      setSupervisorTimeoutDraft(String(parsed));
      setSupervisorTimeoutError(null);
      return;
    }

    const result = await saveSettings({
      supervisor: {
        evaluationTimeoutSec: parsed,
      },
    });

    if (!result.ok) {
      setSupervisorTimeoutDraft(String(supervisorEvaluationTimeoutSec));
      setSupervisorTimeoutError(result.error?.message || t("settings.config_files.save_failed"));
      return;
    }

    setSupervisorEvaluationTimeoutSec(parsed);
    setSupervisorTimeoutDraft(String(parsed));
    setSupervisorTimeoutError(null);
  };

  return (
    <div className="settings-section">
      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.notifications")}</h3>
        <p className="settings-group-desc">{t("settings.notifications_channel_hint")}</p>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id={notificationsLabelId}>
              {t("settings.notifications_enabled")}
            </span>
            <span className="settings-toggle-desc" id={notificationsDescId}>
              {t("settings.notifications_enabled_hint")}
            </span>
          </div>
          <Switch
            aria-describedby={notificationsDescId}
            aria-labelledby={notificationsLabelId}
            checked={notificationsEnabled}
            className="settings-toggle"
            onCheckedChange={(nextEnabled) => {
              setNotificationsEnabled(nextEnabled);
              syncNotificationPreferences({
                enabled: nextEnabled,
                soundEnabled,
              });
              void saveSettings({ notifications: { enabled: nextEnabled } });
            }}
          />
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id={soundLabelId}>
              {t("settings.notification_sound")}
            </span>
            <span className="settings-toggle-desc" id={soundDescId}>
              {t("settings.notification_sound_hint")}
            </span>
          </div>
          <Switch
            aria-describedby={soundDescId}
            aria-labelledby={soundLabelId}
            checked={soundEnabled}
            className="settings-toggle"
            disabled={!notificationsEnabled}
            onCheckedChange={(nextSoundEnabled) => {
              setSoundEnabled(nextSoundEnabled);
              syncNotificationPreferences({
                enabled: notificationsEnabled,
                soundEnabled: nextSoundEnabled,
              });
              void saveSettings({ notifications: { soundEnabled: nextSoundEnabled } });
            }}
          />
        </div>

        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.notification_status")}</span>
          <span className={`settings-info-value settings-capability-${notificationCapability}`}>
            {notificationCapability === "available" && t("settings.notification_status_available")}
            {notificationCapability === "limited" && (
              <>
                {t("settings.notification_status_limited")}
                <span className="settings-status-hint">
                  {t("settings.notification_status_limited_hint")}
                </span>
              </>
            )}
            {notificationCapability === "unsupported" && (
              <>
                {t("settings.notification_status_unsupported")}
                <span className="settings-status-hint">
                  {t("settings.notification_status_unsupported_hint")}
                </span>
              </>
            )}
          </span>
        </div>

        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.notification_permission")}</span>
          <span className={`settings-info-value settings-permission-${notificationPermission}`}>
            {notificationPermission === "granted" && t("settings.permission_granted")}
            {notificationPermission === "denied" && (
              <>
                {t("settings.permission_denied")}
                <span className="settings-status-hint">{t("settings.permission_denied_hint")}</span>
              </>
            )}
            {notificationPermission === "default" && notificationCapability === "available" && (
              <button className="settings-link" onClick={requestNotificationPermission}>
                {t("settings.permission_request")}
              </button>
            )}
            {notificationPermission === "default" && notificationCapability === "limited" && (
              <>
                {t("settings.permission_unavailable")}
                <span className="settings-status-hint">
                  {t("settings.permission_limited_hint")}
                </span>
              </>
            )}
            {notificationPermission === "unavailable" && (
              <>
                {t("settings.permission_unavailable")}
                <span className="settings-status-hint">
                  {t("settings.permission_unavailable_hint")}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.supervisor.title")}</h3>
        <p className="settings-group-desc">{t("settings.supervisor.hint")}</p>

        <div className="settings-config-field settings-config-field--inline">
          <label className="settings-config-label" htmlFor="supervisor-evaluation-timeout">
            {t("settings.supervisor.evaluation_timeout")}
          </label>
          <div className="settings-config-control">
            <Input
              id="supervisor-evaluation-timeout"
              className="settings-input-compact"
              type="number"
              min={1}
              max={MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC}
              step={1}
              inputMode="numeric"
              invalid={Boolean(supervisorTimeoutError)}
              value={supervisorTimeoutDraft}
              onChange={(event) => {
                setSupervisorTimeoutDraft(event.target.value);
                if (supervisorTimeoutError) {
                  setSupervisorTimeoutError(null);
                }
              }}
              onBlur={() => {
                void commitSupervisorTimeout();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitSupervisorTimeout();
                }
              }}
            />
          </div>
          {supervisorTimeoutError ? (
            <span className="form-error" role="alert">
              {supervisorTimeoutError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface AppearanceSettingsProps {
  locale: string;
  setLocale: (value: "zh" | "en") => void;
  terminalRenderer: "standard" | "compatibility";
  setTerminalRenderer: (value: "standard" | "compatibility") => void;
  theme: "dark" | "light";
  setTheme: (value: "dark" | "light") => void;
}

function AppearanceSettings({
  locale,
  setLocale,
  terminalRenderer,
  setTerminalRenderer,
  theme,
  setTheme,
}: AppearanceSettingsProps) {
  const t = useTranslation();
  const themeTitleId = useId();
  const themeDescId = useId();
  const terminalRendererTitleId = useId();
  const terminalRendererDescId = useId();
  const languageTitleId = useId();
  const languageDescId = useId();
  const dispatch = useAtomValue(dispatchCommandAtom);

  const saveSettings = async (settings: Record<string, unknown>) => {
    await dispatch("settings.update", { settings });
  };

  const handleThemeChange = (newTheme: "dark" | "light") => {
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    void saveSettings({ appearance: { theme: newTheme } });
  };

  return (
    <div className="settings-section">
      <div className="settings-group">
        <h3 className="settings-group-title" id={themeTitleId}>
          {t("settings.theme.title")}
        </h3>
        <p className="settings-group-desc" id={themeDescId}>
          {t("settings.theme.hint")}
        </p>

        <div
          aria-describedby={themeDescId}
          aria-labelledby={themeTitleId}
          className="settings-pills"
          role="group"
        >
          <Pill
            leadingIcon={theme === "dark" ? <Check size={12} /> : undefined}
            onClick={() => handleThemeChange("dark")}
            active={theme === "dark"}
          >
            {t("settings.theme.dark")}
          </Pill>
          <Pill
            leadingIcon={theme === "light" ? <Check size={12} /> : undefined}
            onClick={() => handleThemeChange("light")}
            active={theme === "light"}
          >
            {t("settings.theme.light")}
          </Pill>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title" id={terminalRendererTitleId}>
          {t("settings.terminal_renderer")}
        </h3>
        <p className="settings-group-desc" id={terminalRendererDescId}>
          {t("settings.terminal_renderer_hint")}
        </p>

        <div
          aria-describedby={terminalRendererDescId}
          aria-labelledby={terminalRendererTitleId}
          className="settings-pills"
          role="group"
        >
          <Pill
            leadingIcon={terminalRenderer === "standard" ? <Check size={12} /> : undefined}
            onClick={() => {
              setTerminalRenderer("standard");
              void saveSettings({ appearance: { terminalRenderer: "standard" } });
            }}
            active={terminalRenderer === "standard"}
          >
            {t("settings.terminal_standard")}
          </Pill>
          <Pill
            leadingIcon={terminalRenderer === "compatibility" ? <Check size={12} /> : undefined}
            onClick={() => {
              setTerminalRenderer("compatibility");
              void saveSettings({ appearance: { terminalRenderer: "compatibility" } });
            }}
            active={terminalRenderer === "compatibility"}
          >
            {t("settings.terminal_compatibility")}
          </Pill>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title" id={languageTitleId}>
          {t("settings.language.title")}
        </h3>
        <p className="settings-group-desc" id={languageDescId}>
          {t("settings.language.hint")}
        </p>

        <div
          aria-describedby={languageDescId}
          aria-labelledby={languageTitleId}
          className="settings-pills"
          role="group"
        >
          <Pill
            leadingIcon={locale === "zh" ? <Check size={12} /> : undefined}
            onClick={() => {
              setLocale("zh");
              void saveSettings({ appearance: { locale: "zh" } });
            }}
            active={locale === "zh"}
          >
            {t("settings.language.zh")}
          </Pill>
          <Pill
            leadingIcon={locale === "en" ? <Check size={12} /> : undefined}
            onClick={() => {
              setLocale("en");
              void saveSettings({ appearance: { locale: "en" } });
            }}
            active={locale === "en"}
          >
            {t("settings.language.en")}
          </Pill>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
