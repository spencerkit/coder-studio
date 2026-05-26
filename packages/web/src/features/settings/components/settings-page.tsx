/**
 * Settings Page Component
 *
 * Configuration page for provider, appearance, and notifications.
 */

import {
  createDefaultMonitoringSettings,
  createDefaultUpdateSettings,
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  DEFAULT_SUPERVISOR_RETRY_DELAY_SEC,
  DEFAULT_SUPERVISOR_RETRY_ENABLED,
  DEFAULT_SUPERVISOR_RETRY_MAX_COUNT,
  DEFAULT_SUPERVISOR_RETRY_ON_EVALUATOR_ERROR,
  DEFAULT_SUPERVISOR_RETRY_ON_TIMEOUT,
  deriveMonitoringMode,
  type LspRuntimeMode,
  MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  MAX_SUPERVISOR_RETRY_DELAY_SEC,
  MAX_SUPERVISOR_RETRY_MAX_COUNT,
  type MonitoringMode,
  type MonitoringSettings,
  resolveMonitoringSettings,
  resolveSupervisorEvaluationTimeoutSec,
  resolveSupervisorRetryDelaySec,
  resolveSupervisorRetryEnabled,
  resolveSupervisorRetryMaxCount,
  resolveSupervisorRetryOnEvaluatorError,
  resolveSupervisorRetryOnTimeout,
  resolveUpdateAutoCheckEnabled,
  resolveUpdateCheckIntervalSec,
} from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  type AppearanceBackgroundFit,
  type AppearanceBackgroundMode,
  type AppearancePersonalization,
  type AppearancePersonalizationOverrides,
  deleteAppearanceAsset,
  resolveAppearancePersonalizationSetting,
  uploadAppearanceAsset,
} from "../../../appearance";
import { appearancePersonalizationAtom, localeAtom, themeAtom } from "../../../atoms/app-ui";
import { connectionStatusAtom, serverInfoAtom } from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";
import { Button, Input, Notice, Pill, Select, Switch, ThemedIcon } from "../../../components/ui";
import { useViewport } from "../../../hooks/use-viewport";
import { useTranslation } from "../../../lib/i18n";
import { getThemeById, resolveStoredThemeId, THEMES } from "../../../theme";
import { lspRuntimeModeAtom } from "../../code-editor/lsp/runtime-mode";
import { buildDiagnosticsPath } from "../../diagnostics";
import { useMonitoringData } from "../../monitoring";
import { notificationPreferencesAtom } from "../../notifications/atoms";
import { MobilePageHeader } from "../../shared/components/mobile-page-header";
import { PageHeader } from "../../shared/components/page-header";
import {
  getTerminalFontSizePreference,
  hasExplicitTerminalFontSizeSetting,
  hasLegacyTerminalFontSizeSetting,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  resolveTerminalCopyOnSelectSetting,
  resolveTerminalFontSizeSetting,
  terminalPreferencesAtom,
} from "../../terminal-panel/preferences";
import { AboutSettings } from "./about-settings";
import { MonitoringSettingsSubpage } from "./monitoring-settings-subpage";
import { type ProviderInfo, ProviderSettings } from "./provider-settings";
import { resolveSettingsExitTargetFromBrowserHistory } from "./settings-navigation";
import {
  MOBILE_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "./settings-sections";
import { ShortcutsSettings } from "./shortcuts-settings";
import { useSessionGateDispatch } from "./use-session-gate-dispatch";

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
type AppearanceAssetScope = "common" | "desktop" | "mobile";
type AppearanceOverrideTarget = Exclude<AppearanceAssetScope, "common">;

const DEFAULT_SETTINGS_SECTION: SettingsSection = SETTINGS_SECTIONS[0].id;
const TERMINAL_FONT_SIZE_SAVE_THROTTLE_MS = 500;
const PERSONALIZATION_OVERRIDE_FIELDS = [
  "backgroundAssetId",
  "backgroundDimness",
  "backgroundBlur",
  "glassEnabled",
  "glassIntensity",
  "surfaceOpacity",
] as const;

type PersonalizationOverrideField = (typeof PERSONALIZATION_OVERRIDE_FIELDS)[number];

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

function getMobileSectionHintKey(section: SettingsSection) {
  switch (section) {
    case "general":
      return "settings.notifications_channel_hint";
    case "monitoring":
      return "monitoring.command_description";
    case "providers":
      return "settings.provider.command_preview_hint";
    case "appearance":
      return "settings.theme.hint";
    case "shortcuts":
      return "settings.shortcuts.hint";
    case "about":
      return "settings.about.description";
  }
}

const MOBILE_SETTINGS_GROUPS = [
  {
    titleKey: "settings.mobile_groups.workspace_runtime",
    sections: ["general", "monitoring", "providers"],
  },
  {
    titleKey: "settings.mobile_groups.interface_interaction",
    sections: ["appearance", "shortcuts", "about"],
  },
] as const satisfies readonly {
  titleKey: string;
  sections: readonly SettingsSection[];
}[];

function resolveMobileSettingsGroups(
  availableSections: readonly {
    id: SettingsSection;
    labelKey: string;
    iconSemantic: Parameters<typeof ThemedIcon>[0]["semantic"];
  }[]
) {
  const sectionsById = new Map(availableSections.map((section) => [section.id, section]));
  const groupedSectionIds = MOBILE_SETTINGS_GROUPS.flatMap((group) => group.sections);

  if (groupedSectionIds.length !== availableSections.length) {
    throw new Error("Mobile settings groups are out of sync with available sections.");
  }

  for (const sectionId of groupedSectionIds) {
    if (!sectionsById.has(sectionId)) {
      throw new Error(`Missing mobile settings section mapping for "${sectionId}".`);
    }
  }

  return MOBILE_SETTINGS_GROUPS.map((group) => ({
    titleKey: group.titleKey,
    sections: group.sections.map((sectionId) => sectionsById.get(sectionId)!),
  }));
}

interface MonitoringSettingsSectionProps {
  readonly mode: MonitoringMode;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly settings: MonitoringSettings;
}

function MonitoringSettingsSection({ mode, onChange, settings }: MonitoringSettingsSectionProps) {
  const monitoringData = useMonitoringData();

  return (
    <MonitoringSettingsSubpage
      mode={mode}
      monitoringData={monitoringData}
      onChange={onChange}
      settings={settings}
    />
  );
}

/**
 * Settings Page
 *
 * PRD §13:
 *   - Two-column layout: sidebar (200px) + content area
 *   - Navigation sections: General, Provider (per provider), Appearance
 *   - General: notifications, terminal behavior
 *   - Provider: config fields and command preview
 *   - Appearance: theme, language
 */
export function SettingsPage() {
  const t = useTranslation();
  const settingsLoadFailedUnknown = t("settings.load_failed_unknown");
  const location = useLocation();
  const navigate = useNavigate();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const dispatch = useSessionGateDispatch();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const serverInfo = useAtomValue(serverInfoAtom);
  const resolvedActiveWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const activeWorkspaceId = resolvedActiveWorkspaceId;
  const requestedSection = (() => {
    const section = new URLSearchParams(location.search).get("section");
    return SETTINGS_SECTIONS.some((item) => item.id === section)
      ? (section as SettingsSection)
      : null;
  })();
  const [navigationState, setNavigationState] = useState<SettingsNavigationState>(() => {
    if (requestedSection) {
      return { kind: "detail", section: requestedSection };
    }

    return isMobile
      ? { kind: "root", lastSection: DEFAULT_SETTINGS_SECTION }
      : { kind: "detail", section: DEFAULT_SETTINGS_SECTION };
  });

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
  const [supervisorRetryEnabled, setSupervisorRetryEnabled] = useState(
    DEFAULT_SUPERVISOR_RETRY_ENABLED
  );
  const [supervisorRetryMaxCount, setSupervisorRetryMaxCount] = useState(
    DEFAULT_SUPERVISOR_RETRY_MAX_COUNT
  );
  const [supervisorRetryDelaySec, setSupervisorRetryDelaySec] = useState(
    DEFAULT_SUPERVISOR_RETRY_DELAY_SEC
  );
  const [supervisorRetryOnTimeout, setSupervisorRetryOnTimeout] = useState(
    DEFAULT_SUPERVISOR_RETRY_ON_TIMEOUT
  );
  const [supervisorRetryOnEvaluatorError, setSupervisorRetryOnEvaluatorError] = useState(
    DEFAULT_SUPERVISOR_RETRY_ON_EVALUATOR_ERROR
  );
  const [lspRuntimeMode, setLspRuntimeMode] = useState<LspRuntimeMode>("auto");
  const [terminalRenderer, setTerminalRendererState] = useState<"standard" | "compatibility">(
    "standard"
  );
  const [providerAdditionalArgsById, setProviderAdditionalArgsById] = useState<
    Record<string, string>
  >({});
  const [monitoringSettings, setMonitoringSettings] = useState<MonitoringSettings>(
    createDefaultMonitoringSettings()
  );
  const defaultUpdateSettings = createDefaultUpdateSettings();
  const [updateAutoCheckEnabled, setUpdateAutoCheckEnabled] = useState(
    defaultUpdateSettings.autoCheckEnabled
  );
  const [updateCheckIntervalSec, setUpdateCheckIntervalSec] = useState(
    defaultUpdateSettings.checkIntervalSec
  );
  const [contentLayoutMode, setContentLayoutMode] = useState<SettingsContentLayoutMode>("default");
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  const [locale, setLocaleState] = useAtom(localeAtom);
  const [personalization, setPersonalization] = useAtom(appearancePersonalizationAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const terminalPreferences = useAtomValue(terminalPreferencesAtom);
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const setTerminalPreferences = useSetAtom(terminalPreferencesAtom);
  const setHydratedLspRuntimeMode = useSetAtom(lspRuntimeModeAtom);
  const store = useStore();
  const settingsLoadFailedUnknownRef = useRef(settingsLoadFailedUnknown);
  const monitoringSettingsHydratedRef = useRef(false);
  const appearanceSelectionVersionRef = useRef({
    theme: 0,
    personalization: 0,
    locale: 0,
    lspRuntimeMode: 0,
    terminalRenderer: 0,
    terminalCopyOnSelect: 0,
    desktopTerminalFontSize: 0,
    mobileTerminalFontSize: 0,
  });
  const updateSelectionVersionRef = useRef({
    autoCheckEnabled: 0,
    checkIntervalSec: 0,
  });
  const monitoringSelectionVersionRef = useRef(0);
  const detailSection =
    navigationState.kind === "detail" ? navigationState.section : navigationState.lastSection;
  const availableSections = isMobile ? MOBILE_SETTINGS_SECTIONS : SETTINGS_SECTIONS;
  const activeSectionMeta =
    availableSections.find((section) => section.id === detailSection) ?? availableSections[0];

  const syncTerminalPreferences = (
    next: Partial<{
      copyOnSelect: boolean;
      fontSize: number;
      desktopFontSize: number;
      mobileFontSize: number;
    }>
  ) => {
    setTerminalPreferences({
      ...store.get(terminalPreferencesAtom),
      ...next,
    });
  };

  const selectSettingsSection = (section: SettingsSection) => {
    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.set("section", section);
    const nextSearch = nextSearchParams.toString();

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true }
    );

    setNavigationState({ kind: "detail", section });
  };

  useEffect(() => {
    settingsLoadFailedUnknownRef.current = settingsLoadFailedUnknown;
  }, [settingsLoadFailedUnknown]);

  useEffect(() => {
    setNavigationState((state) => {
      if (requestedSection) {
        return state.kind === "detail" && state.section === requestedSection
          ? state
          : { kind: "detail", section: requestedSection };
      }

      if (isMobile) {
        return state.kind === "root" ? state : { kind: "root", lastSection: state.section };
      }

      return state.kind === "detail" ? state : { kind: "detail", section: state.lastSection };
    });
  }, [isMobile, requestedSection]);

  useEffect(() => {
    if (connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      const appearanceSelectionVersionAtRequestStart = {
        ...appearanceSelectionVersionRef.current,
      };
      const updateSelectionVersionAtRequestStart = {
        ...updateSelectionVersionRef.current,
      };
      const monitoringSelectionVersionAtRequestStart = monitoringSelectionVersionRef.current;
      const result = await dispatch<Record<string, unknown>>("settings.get", {});
      if (result === null) {
        return;
      }

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
      if (monitoringSelectionVersionRef.current === monitoringSelectionVersionAtRequestStart) {
        setMonitoringSettings(resolveMonitoringSettings(settings));
        monitoringSettingsHydratedRef.current = true;
      }
      if (
        updateSelectionVersionRef.current.autoCheckEnabled ===
        updateSelectionVersionAtRequestStart.autoCheckEnabled
      ) {
        setUpdateAutoCheckEnabled(
          resolveUpdateAutoCheckEnabled(settings["updates.autoCheckEnabled"])
        );
      }
      if (
        updateSelectionVersionRef.current.checkIntervalSec ===
        updateSelectionVersionAtRequestStart.checkIntervalSec
      ) {
        setUpdateCheckIntervalSec(
          resolveUpdateCheckIntervalSec(settings["updates.checkIntervalSec"])
        );
      }
      if (
        appearanceSelectionVersionRef.current.lspRuntimeMode ===
        appearanceSelectionVersionAtRequestStart.lspRuntimeMode
      ) {
        if (settings["lsp.mode"] === "auto" || settings["lsp.mode"] === "off") {
          setLspRuntimeMode(settings["lsp.mode"]);
          setHydratedLspRuntimeMode(settings["lsp.mode"]);
        } else {
          setLspRuntimeMode("auto");
          setHydratedLspRuntimeMode("auto");
        }
      }
      setSupervisorEvaluationTimeoutSec(
        resolveSupervisorEvaluationTimeoutSec(settings["supervisor.evaluationTimeoutSec"])
      );
      setSupervisorRetryEnabled(resolveSupervisorRetryEnabled(settings["supervisor.retryEnabled"]));
      setSupervisorRetryMaxCount(
        resolveSupervisorRetryMaxCount(settings["supervisor.retryMaxCount"])
      );
      setSupervisorRetryDelaySec(
        resolveSupervisorRetryDelaySec(settings["supervisor.retryDelaySec"])
      );
      setSupervisorRetryOnTimeout(
        resolveSupervisorRetryOnTimeout(settings["supervisor.retryOnTimeout"])
      );
      setSupervisorRetryOnEvaluatorError(
        resolveSupervisorRetryOnEvaluatorError(settings["supervisor.retryOnEvaluatorError"])
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
      const shouldHydrateTerminalCopyOnSelect =
        appearanceSelectionVersionRef.current.terminalCopyOnSelect ===
        appearanceSelectionVersionAtRequestStart.terminalCopyOnSelect;
      const shouldHydrateDesktopTerminalFontSize =
        appearanceSelectionVersionRef.current.desktopTerminalFontSize ===
        appearanceSelectionVersionAtRequestStart.desktopTerminalFontSize;
      const shouldHydrateMobileTerminalFontSize =
        appearanceSelectionVersionRef.current.mobileTerminalFontSize ===
        appearanceSelectionVersionAtRequestStart.mobileTerminalFontSize;
      if (
        shouldHydrateTerminalCopyOnSelect ||
        shouldHydrateDesktopTerminalFontSize ||
        shouldHydrateMobileTerminalFontSize
      ) {
        const currentTerminalPreferences = store.get(terminalPreferencesAtom);
        const desktopFontSize = shouldHydrateDesktopTerminalFontSize
          ? resolveTerminalFontSizeSetting(settings, "desktop")
          : getTerminalFontSizePreference(currentTerminalPreferences, "desktop");
        const mobileFontSize = shouldHydrateMobileTerminalFontSize
          ? resolveTerminalFontSizeSetting(settings, "mobile")
          : getTerminalFontSizePreference(currentTerminalPreferences, "mobile");
        const hasLegacyTerminalFontSize = hasLegacyTerminalFontSizeSetting(settings);
        const hasExplicitDesktopFontSize = hasExplicitTerminalFontSizeSetting(settings, "desktop");
        const hasExplicitMobileFontSize = hasExplicitTerminalFontSizeSetting(settings, "mobile");
        setTerminalPreferences({
          copyOnSelect: shouldHydrateTerminalCopyOnSelect
            ? resolveTerminalCopyOnSelectSetting(settings)
            : currentTerminalPreferences.copyOnSelect,
          desktopFontSize,
          mobileFontSize,
          fontSize:
            hasExplicitDesktopFontSize || hasExplicitMobileFontSize || hasLegacyTerminalFontSize
              ? desktopFontSize
              : currentTerminalPreferences.fontSize,
        });
      }
      if (settings["appearance.locale"] === "zh" || settings["appearance.locale"] === "en") {
        if (
          appearanceSelectionVersionRef.current.locale ===
          appearanceSelectionVersionAtRequestStart.locale
        ) {
          setLocaleState(settings["appearance.locale"]);
        }
      }
      if (
        appearanceSelectionVersionRef.current.personalization ===
        appearanceSelectionVersionAtRequestStart.personalization
      ) {
        setPersonalization(resolveAppearancePersonalizationSetting(settings));
      }
      const hasServerThemeSetting =
        Object.prototype.hasOwnProperty.call(settings, "appearance.themeId") ||
        Object.prototype.hasOwnProperty.call(settings, "appearance.theme");
      if (
        hasServerThemeSetting &&
        appearanceSelectionVersionRef.current.theme ===
          appearanceSelectionVersionAtRequestStart.theme
      ) {
        const resolvedThemeId = resolveStoredThemeId(
          settings["appearance.themeId"] ?? settings["appearance.theme"]
        );
        setTheme(resolvedThemeId);
        document.documentElement.setAttribute(
          "data-theme",
          getThemeById(resolvedThemeId).documentThemeAttr
        );
      }
      setProviderAdditionalArgsById(loadProviderAdditionalArgs(settings, providers));
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [
    connectionStatus,
    dispatch,
    setLocaleState,
    setNotificationPreferences,
    setPersonalization,
    setHydratedLspRuntimeMode,
    setTerminalPreferences,
    setTheme,
    settingsRefreshKey,
    store,
  ]);

  const handleLocaleSelection = (value: "zh" | "en") => {
    appearanceSelectionVersionRef.current.locale += 1;
    setLocaleState(value);
  };

  const handleThemeSelection = (value: string) => {
    appearanceSelectionVersionRef.current.theme += 1;
    setTheme(value);
  };

  const saveAppearancePersonalization = async (next: AppearancePersonalization) => {
    const previous = personalization;
    appearanceSelectionVersionRef.current.personalization += 1;
    setPersonalization(next);

    const result = await dispatch("settings.update", {
      settings: {
        appearance: {
          personalization: next,
        },
      },
    });

    if (!result.ok) {
      setPersonalization(previous);
      setSettingsLoadError(result.error?.message ?? settingsLoadFailedUnknownRef.current);
      return false;
    }

    return true;
  };

  const handleTerminalRendererSelection = (value: "standard" | "compatibility") => {
    appearanceSelectionVersionRef.current.terminalRenderer += 1;
    setTerminalRendererState(value);
  };

  const handleTerminalCopyOnSelectSelection = (value: boolean) => {
    appearanceSelectionVersionRef.current.terminalCopyOnSelect += 1;
    syncTerminalPreferences({ copyOnSelect: value });
  };

  const handleDesktopTerminalFontSizeSelection = (value: number) => {
    appearanceSelectionVersionRef.current.desktopTerminalFontSize += 1;
    syncTerminalPreferences({
      desktopFontSize: value,
      fontSize: value,
    });
  };

  const handleMobileTerminalFontSizeSelection = (value: number) => {
    appearanceSelectionVersionRef.current.mobileTerminalFontSize += 1;
    syncTerminalPreferences({
      mobileFontSize: value,
    });
  };

  const handleLspRuntimeModeSelection = async (nextMode: LspRuntimeMode) => {
    if (nextMode === lspRuntimeMode) {
      return;
    }

    appearanceSelectionVersionRef.current.lspRuntimeMode += 1;

    const persistResult = await dispatch("settings.update", {
      settings: {
        lsp: {
          mode: nextMode,
        },
      },
    });
    if (persistResult === null || !persistResult.ok) {
      return;
    }

    const runtimeResult = await dispatch("lsp.setMode", { mode: nextMode });
    if (runtimeResult === null || !runtimeResult.ok) {
      return;
    }

    setLspRuntimeMode(nextMode);
    setHydratedLspRuntimeMode(nextMode);
  };

  const saveUpdateSettings = async (updates: {
    autoCheckEnabled?: boolean;
    checkIntervalSec?: number;
  }) => {
    return await dispatch("settings.update", {
      settings: {
        updates,
      },
    });
  };

  const handleUpdateAutoCheckChange = async (value: boolean) => {
    updateSelectionVersionRef.current.autoCheckEnabled += 1;
    setUpdateAutoCheckEnabled(value);
    const result = await saveUpdateSettings({ autoCheckEnabled: value });
    if (result === null) {
      return;
    }
    if (!result.ok) {
      setUpdateAutoCheckEnabled((current) => !value);
    }
  };

  const handleUpdateIntervalChange = async (value: number) => {
    if (value === updateCheckIntervalSec) {
      return;
    }
    const previous = updateCheckIntervalSec;
    updateSelectionVersionRef.current.checkIntervalSec += 1;
    setUpdateCheckIntervalSec(value);
    const result = await saveUpdateSettings({ checkIntervalSec: value });
    if (result === null) {
      return;
    }
    if (!result.ok) {
      setUpdateCheckIntervalSec(previous);
    }
  };

  const handleMonitoringSettingsChange = async (nextSettings: MonitoringSettings) => {
    const previousSettings = monitoringSettings;
    const monitoringWasHydrated = monitoringSettingsHydratedRef.current;
    monitoringSelectionVersionRef.current += 1;
    const requestVersion = monitoringSelectionVersionRef.current;
    setMonitoringSettings(nextSettings);

    const result = await dispatch("settings.update", {
      settings: {
        monitoring: nextSettings,
      },
    });

    if (result === null || !result.ok) {
      if (monitoringSelectionVersionRef.current === requestVersion) {
        setMonitoringSettings(previousSettings);
        if (!monitoringWasHydrated) {
          setSettingsRefreshKey((value) => value + 1);
        }
      }
      throw result?.error ?? new Error("monitoring update failed");
    }
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
      navigate(
        {
          pathname: location.pathname,
          search: "",
        },
        { replace: true }
      );
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
            supervisorRetryEnabled={supervisorRetryEnabled}
            setSupervisorRetryEnabled={setSupervisorRetryEnabled}
            supervisorRetryMaxCount={supervisorRetryMaxCount}
            setSupervisorRetryMaxCount={setSupervisorRetryMaxCount}
            supervisorRetryDelaySec={supervisorRetryDelaySec}
            setSupervisorRetryDelaySec={setSupervisorRetryDelaySec}
            supervisorRetryOnTimeout={supervisorRetryOnTimeout}
            setSupervisorRetryOnTimeout={setSupervisorRetryOnTimeout}
            supervisorRetryOnEvaluatorError={supervisorRetryOnEvaluatorError}
            setSupervisorRetryOnEvaluatorError={setSupervisorRetryOnEvaluatorError}
            lspRuntimeMode={lspRuntimeMode}
            onLspRuntimeModeSelect={handleLspRuntimeModeSelection}
            terminalRenderer={terminalRenderer}
            setTerminalRenderer={handleTerminalRendererSelection}
            terminalCopyOnSelect={terminalPreferences.copyOnSelect}
            setTerminalCopyOnSelect={handleTerminalCopyOnSelectSelection}
            activeWorkspaceId={activeWorkspaceId}
          />
        );
      case "monitoring":
        return (
          <MonitoringSettingsSection
            mode={deriveMonitoringMode(monitoringSettings)}
            onChange={handleMonitoringSettingsChange}
            settings={monitoringSettings}
          />
        );
      case "appearance":
        return (
          <AppearanceSettings
            desktopTerminalFontSize={getTerminalFontSizePreference(terminalPreferences, "desktop")}
            mobileTerminalFontSize={getTerminalFontSizePreference(terminalPreferences, "mobile")}
            locale={locale}
            personalization={personalization}
            setDesktopTerminalFontSize={handleDesktopTerminalFontSizeSelection}
            setLocale={handleLocaleSelection}
            setMobileTerminalFontSize={handleMobileTerminalFontSizeSelection}
            savePersonalization={saveAppearancePersonalization}
            theme={theme}
            setTheme={handleThemeSelection}
          />
        );
      case "providers":
        return (
          <ProviderSettings
            providers={providers}
            additionalArgsById={providerAdditionalArgsById}
            setAdditionalArgsById={setProviderAdditionalArgsById}
            isMobile={isMobile}
            activeWorkspaceId={activeWorkspaceId}
            onLayoutModeChange={setContentLayoutMode}
          />
        );
      case "shortcuts":
        return <ShortcutsSettings />;
      case "about":
        return (
          <AboutSettings
            autoCheckEnabled={updateAutoCheckEnabled}
            checkIntervalSec={updateCheckIntervalSec}
            onAutoCheckEnabledChange={handleUpdateAutoCheckChange}
            onCheckIntervalChange={handleUpdateIntervalChange}
            locale={locale}
          />
        );
      default:
        return null;
    }
  };

  const renderMobileRoot = () => (
    <main className="settings-content settings-content--mobile-root">
      <div className="settings-mobile-root" data-testid="settings-mobile-root">
        {resolveMobileSettingsGroups(availableSections).map((group) => (
          <section key={group.titleKey} className="settings-mobile-group">
            <h2 className="settings-mobile-group__title">{t(group.titleKey)}</h2>
            <div className="settings-mobile-group__list">
              {group.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="settings-mobile-item"
                  aria-label={t(section.labelKey)}
                  onClick={() => selectSettingsSection(section.id)}
                >
                  <span className="settings-mobile-item__icon-shell" aria-hidden="true">
                    <span className="settings-mobile-item__icon">
                      <ThemedIcon semantic={section.iconSemantic} size={18} />
                    </span>
                  </span>
                  <span className="settings-mobile-item__copy">
                    <span className="settings-mobile-item__label">{t(section.labelKey)}</span>
                    <span className="settings-mobile-item__hint">
                      {t(getMobileSectionHintKey(section.id))}
                    </span>
                  </span>
                  <ChevronRight size={16} className="settings-mobile-item__arrow" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );

  const shouldShowMobileRoot = isMobile && navigationState.kind === "root";
  const isMobileDetailView = isMobile && navigationState.kind === "detail";
  const headerTitle = isMobile
    ? t(shouldShowMobileRoot ? "settings.title" : activeSectionMeta.labelKey)
    : t("settings.title");

  return (
    <div className={`settings-page ${isMobile ? "settings-page--mobile" : ""}`}>
      <header className="settings-header">
        {isMobile ? (
          <MobilePageHeader
            title={headerTitle}
            titleAs="div"
            onBack={handleBack}
            backLabel={t("action.back")}
          />
        ) : (
          <PageHeader
            title={t("settings.title")}
            titleAs="h1"
            level="secondary"
            onBack={handleBack}
            backLabel={t("action.back")}
          />
        )}
      </header>

      {shouldShowMobileRoot ? (
        renderMobileRoot()
      ) : (
        <div
          className={`settings-body ${isMobile ? "settings-body--mobile" : ""} ${isMobileDetailView ? "settings-body--mobile-detail" : ""} ${contentLayoutMode === "fill-height" ? "settings-body--fill-height" : ""}`}
        >
          {isMobile ? null : (
            <aside className="settings-sidebar">
              <nav className="settings-nav">
                {availableSections.map(({ id, labelKey, iconSemantic }) => (
                  <SettingsNavItem
                    key={id}
                    icon={<ThemedIcon semantic={iconSemantic} size={16} />}
                    label={t(labelKey)}
                    active={detailSection === id}
                    onClick={() => selectSettingsSection(id)}
                  />
                ))}
              </nav>
            </aside>
          )}

          <main
            className={`settings-content ${isMobile ? "settings-content--mobile" : ""} ${isMobileDetailView ? "settings-content--mobile-detail" : ""} ${contentLayoutMode === "fill-height" ? "settings-content--fill-height" : ""}`}
          >
            <div className="settings-content-surface">
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
            </div>
          </main>
        </div>
      )}

      <footer className={`settings-footer ${isMobile ? "settings-footer--mobile" : ""}`}>
        <div className="settings-footer__meta">
          <span className="settings-autosave">{t("settings.autosave_hint")}</span>
          <span className="settings-version">v{serverInfo?.version ?? "0.0.0"}</span>
        </div>
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
  supervisorRetryEnabled: boolean;
  setSupervisorRetryEnabled: (value: boolean) => void;
  supervisorRetryMaxCount: number;
  setSupervisorRetryMaxCount: (value: number) => void;
  supervisorRetryDelaySec: number;
  setSupervisorRetryDelaySec: (value: number) => void;
  supervisorRetryOnTimeout: boolean;
  setSupervisorRetryOnTimeout: (value: boolean) => void;
  supervisorRetryOnEvaluatorError: boolean;
  setSupervisorRetryOnEvaluatorError: (value: boolean) => void;
  lspRuntimeMode: LspRuntimeMode;
  onLspRuntimeModeSelect: (value: LspRuntimeMode) => Promise<void>;
  terminalRenderer: "standard" | "compatibility";
  setTerminalRenderer: (value: "standard" | "compatibility") => void;
  terminalCopyOnSelect: boolean;
  setTerminalCopyOnSelect: (value: boolean) => void;
  activeWorkspaceId: string | null;
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

function parseSupervisorRetryMaxCountInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_SUPERVISOR_RETRY_MAX_COUNT) {
    return null;
  }

  return parsed;
}

function parseSupervisorRetryDelayInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SUPERVISOR_RETRY_DELAY_SEC) {
    return null;
  }

  return parsed;
}

function parseTerminalFontSizeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TERMINAL_FONT_SIZE ||
    parsed > MAX_TERMINAL_FONT_SIZE
  ) {
    return null;
  }

  return parsed;
}

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function clearPersonalizationOverrides(
  overrides: AppearancePersonalizationOverrides
): AppearancePersonalizationOverrides {
  const next: AppearancePersonalizationOverrides = {};

  for (const field of PERSONALIZATION_OVERRIDE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) {
      const value = overrides[field];
      if (value !== undefined) {
        next[field] = value;
      }
    }
  }

  return next;
}

function GeneralSettings({
  notificationsEnabled,
  setNotificationsEnabled,
  soundEnabled,
  setSoundEnabled,
  supervisorEvaluationTimeoutSec,
  setSupervisorEvaluationTimeoutSec,
  supervisorRetryEnabled,
  setSupervisorRetryEnabled,
  supervisorRetryMaxCount,
  setSupervisorRetryMaxCount,
  supervisorRetryDelaySec,
  setSupervisorRetryDelaySec,
  supervisorRetryOnTimeout,
  setSupervisorRetryOnTimeout,
  supervisorRetryOnEvaluatorError,
  setSupervisorRetryOnEvaluatorError,
  lspRuntimeMode,
  onLspRuntimeModeSelect,
  terminalRenderer,
  setTerminalRenderer,
  terminalCopyOnSelect,
  setTerminalCopyOnSelect,
  activeWorkspaceId,
}: GeneralSettingsProps) {
  const t = useTranslation();
  const navigate = useNavigate();
  const notificationsLabelId = useId();
  const notificationsDescId = useId();
  const soundLabelId = useId();
  const soundDescId = useId();
  const terminalRendererTitleId = useId();
  const terminalRendererDescId = useId();
  const lspRuntimeModeTitleId = useId();
  const lspRuntimeModeDescId = useId();
  const copyOnSelectLabelId = useId();
  const copyOnSelectDescId = useId();
  const dispatch = useSessionGateDispatch();
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>("unavailable");
  const [notificationCapability, setNotificationCapability] =
    useState<NotificationCapabilityStatus>("unsupported");
  const [supervisorTimeoutDraft, setSupervisorTimeoutDraft] = useState(
    String(supervisorEvaluationTimeoutSec)
  );
  const [supervisorTimeoutError, setSupervisorTimeoutError] = useState<string | null>(null);
  const [supervisorRetryMaxCountDraft, setSupervisorRetryMaxCountDraft] = useState(
    String(supervisorRetryMaxCount)
  );
  const [supervisorRetryDelayDraft, setSupervisorRetryDelayDraft] = useState(
    String(supervisorRetryDelaySec)
  );
  const [supervisorRetryMaxCountError, setSupervisorRetryMaxCountError] = useState<string | null>(
    null
  );
  const [supervisorRetryDelayError, setSupervisorRetryDelayError] = useState<string | null>(null);

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
    setSupervisorRetryMaxCountDraft(String(supervisorRetryMaxCount));
  }, [supervisorRetryMaxCount]);

  useEffect(() => {
    setSupervisorRetryDelayDraft(String(supervisorRetryDelaySec));
  }, [supervisorRetryDelaySec]);

  useEffect(() => {
    setSupervisorTimeoutError(null);
  }, [supervisorEvaluationTimeoutSec]);

  useEffect(() => {
    setSupervisorRetryMaxCountError(null);
  }, [supervisorRetryMaxCount]);

  useEffect(() => {
    setSupervisorRetryDelayError(null);
  }, [supervisorRetryDelaySec]);

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

    if (result === null) {
      return;
    }

    if (!result.ok) {
      setSupervisorTimeoutDraft(String(supervisorEvaluationTimeoutSec));
      setSupervisorTimeoutError(result.error?.message || t("settings.config_files.save_failed"));
      return;
    }

    setSupervisorEvaluationTimeoutSec(parsed);
    setSupervisorTimeoutDraft(String(parsed));
    setSupervisorTimeoutError(null);
  };

  const commitSupervisorRetryMaxCount = async () => {
    const parsed = parseSupervisorRetryMaxCountInput(supervisorRetryMaxCountDraft);
    if (parsed === null) {
      setSupervisorRetryMaxCountDraft(String(supervisorRetryMaxCount));
      setSupervisorRetryMaxCountError(
        t("settings.supervisor.retry_max_count_validation_error", {
          max: MAX_SUPERVISOR_RETRY_MAX_COUNT,
        })
      );
      return;
    }

    if (parsed === supervisorRetryMaxCount) {
      setSupervisorRetryMaxCountDraft(String(parsed));
      setSupervisorRetryMaxCountError(null);
      return;
    }

    const result = await saveSettings({
      supervisor: {
        retryMaxCount: parsed,
      },
    });

    if (result === null) {
      return;
    }

    if (!result.ok) {
      setSupervisorRetryMaxCountDraft(String(supervisorRetryMaxCount));
      setSupervisorRetryMaxCountError(
        result.error?.message || t("settings.config_files.save_failed")
      );
      return;
    }

    setSupervisorRetryMaxCount(parsed);
    setSupervisorRetryMaxCountDraft(String(parsed));
    setSupervisorRetryMaxCountError(null);
  };

  const commitSupervisorRetryDelay = async () => {
    const parsed = parseSupervisorRetryDelayInput(supervisorRetryDelayDraft);
    if (parsed === null) {
      setSupervisorRetryDelayDraft(String(supervisorRetryDelaySec));
      setSupervisorRetryDelayError(
        t("settings.supervisor.retry_delay_validation_error", {
          max: MAX_SUPERVISOR_RETRY_DELAY_SEC,
        })
      );
      return;
    }

    if (parsed === supervisorRetryDelaySec) {
      setSupervisorRetryDelayDraft(String(parsed));
      setSupervisorRetryDelayError(null);
      return;
    }

    const result = await saveSettings({
      supervisor: {
        retryDelaySec: parsed,
      },
    });

    if (result === null) {
      return;
    }

    if (!result.ok) {
      setSupervisorRetryDelayDraft(String(supervisorRetryDelaySec));
      setSupervisorRetryDelayError(result.error?.message || t("settings.config_files.save_failed"));
      return;
    }

    setSupervisorRetryDelaySec(parsed);
    setSupervisorRetryDelayDraft(String(parsed));
    setSupervisorRetryDelayError(null);
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
        <h3 className="settings-group-title" id={lspRuntimeModeTitleId}>
          {t("settings.lsp_runtime_mode")}
        </h3>
        <p className="settings-group-desc" id={lspRuntimeModeDescId}>
          {t("settings.lsp_runtime_mode_hint")}
        </p>

        <div
          aria-describedby={lspRuntimeModeDescId}
          aria-labelledby={lspRuntimeModeTitleId}
          className="settings-pills"
          role="group"
        >
          <Pill
            leadingIcon={lspRuntimeMode === "auto" ? <Check size={12} /> : undefined}
            onClick={() => {
              void onLspRuntimeModeSelect("auto");
            }}
            active={lspRuntimeMode === "auto"}
          >
            {t("settings.lsp_runtime_mode_auto")}
          </Pill>
          <Pill
            leadingIcon={lspRuntimeMode === "off" ? <Check size={12} /> : undefined}
            onClick={() => {
              void onLspRuntimeModeSelect("off");
            }}
            active={lspRuntimeMode === "off"}
          >
            {t("settings.lsp_runtime_mode_off")}
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

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id={copyOnSelectLabelId}>
              {t("settings.copy_on_select")}
            </span>
            <span className="settings-toggle-desc" id={copyOnSelectDescId}>
              {t("settings.copy_on_select_hint")}
            </span>
          </div>
          <Switch
            aria-describedby={copyOnSelectDescId}
            aria-labelledby={copyOnSelectLabelId}
            checked={terminalCopyOnSelect}
            className="settings-toggle"
            onCheckedChange={(nextValue) => {
              setTerminalCopyOnSelect(nextValue);
              void saveSettings({ appearance: { terminalCopyOnSelect: nextValue } });
            }}
          />
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

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id="supervisor-retry-enabled-label">
              {t("settings.supervisor.retry_enabled")}
            </span>
            <span className="settings-toggle-desc" id="supervisor-retry-enabled-desc">
              {t("settings.supervisor.retry_enabled_hint")}
            </span>
          </div>
          <Switch
            aria-describedby="supervisor-retry-enabled-desc"
            aria-labelledby="supervisor-retry-enabled-label"
            checked={supervisorRetryEnabled}
            className="settings-toggle"
            onCheckedChange={(nextValue) => {
              setSupervisorRetryEnabled(nextValue);
              void saveSettings({ supervisor: { retryEnabled: nextValue } });
            }}
          />
        </div>

        <div className="settings-config-field settings-config-field--inline">
          <label className="settings-config-label" htmlFor="supervisor-retry-max-count">
            {t("settings.supervisor.retry_max_count")}
          </label>
          <div className="settings-config-control">
            <Input
              id="supervisor-retry-max-count"
              className="settings-input-compact"
              type="number"
              min={0}
              max={MAX_SUPERVISOR_RETRY_MAX_COUNT}
              step={1}
              inputMode="numeric"
              invalid={Boolean(supervisorRetryMaxCountError)}
              value={supervisorRetryMaxCountDraft}
              onChange={(event) => {
                setSupervisorRetryMaxCountDraft(event.target.value);
                if (supervisorRetryMaxCountError) {
                  setSupervisorRetryMaxCountError(null);
                }
              }}
              onBlur={() => {
                void commitSupervisorRetryMaxCount();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitSupervisorRetryMaxCount();
                }
              }}
            />
          </div>
          {supervisorRetryMaxCountError ? (
            <span className="form-error" role="alert">
              {supervisorRetryMaxCountError}
            </span>
          ) : null}
        </div>

        <div className="settings-config-field settings-config-field--inline">
          <label className="settings-config-label" htmlFor="supervisor-retry-delay-sec">
            {t("settings.supervisor.retry_delay_sec")}
          </label>
          <div className="settings-config-control">
            <Input
              id="supervisor-retry-delay-sec"
              className="settings-input-compact"
              type="number"
              min={1}
              max={MAX_SUPERVISOR_RETRY_DELAY_SEC}
              step={1}
              inputMode="numeric"
              invalid={Boolean(supervisorRetryDelayError)}
              value={supervisorRetryDelayDraft}
              onChange={(event) => {
                setSupervisorRetryDelayDraft(event.target.value);
                if (supervisorRetryDelayError) {
                  setSupervisorRetryDelayError(null);
                }
              }}
              onBlur={() => {
                void commitSupervisorRetryDelay();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitSupervisorRetryDelay();
                }
              }}
            />
          </div>
          {supervisorRetryDelayError ? (
            <span className="form-error" role="alert">
              {supervisorRetryDelayError}
            </span>
          ) : null}
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id="supervisor-retry-on-timeout-label">
              {t("settings.supervisor.retry_on_timeout")}
            </span>
            <span className="settings-toggle-desc" id="supervisor-retry-on-timeout-desc">
              {t("settings.supervisor.retry_on_timeout_hint")}
            </span>
          </div>
          <Switch
            aria-describedby="supervisor-retry-on-timeout-desc"
            aria-labelledby="supervisor-retry-on-timeout-label"
            checked={supervisorRetryOnTimeout}
            className="settings-toggle"
            onCheckedChange={(nextValue) => {
              setSupervisorRetryOnTimeout(nextValue);
              void saveSettings({ supervisor: { retryOnTimeout: nextValue } });
            }}
          />
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id="supervisor-retry-on-evaluator-error-label">
              {t("settings.supervisor.retry_on_evaluator_error")}
            </span>
            <span className="settings-toggle-desc" id="supervisor-retry-on-evaluator-error-desc">
              {t("settings.supervisor.retry_on_evaluator_error_hint")}
            </span>
          </div>
          <Switch
            aria-describedby="supervisor-retry-on-evaluator-error-desc"
            aria-labelledby="supervisor-retry-on-evaluator-error-label"
            checked={supervisorRetryOnEvaluatorError}
            className="settings-toggle"
            onCheckedChange={(nextValue) => {
              setSupervisorRetryOnEvaluatorError(nextValue);
              void saveSettings({ supervisor: { retryOnEvaluatorError: nextValue } });
            }}
          />
        </div>
      </div>

      <div className="settings-toggle-row settings-toggle-row--action">
        <div className="settings-toggle-info">
          <span className="settings-toggle-label">{t("diagnostics.title")}</span>
          <span className="settings-toggle-desc">{t("diagnostics.settings_hint")}</span>
        </div>
        <Button
          className="settings-diagnostics-button"
          leadingIcon={<ThemedIcon semantic="state.warning" size={16} />}
          onClick={() =>
            navigate(
              buildDiagnosticsPath({
                context: "manual_check",
                workspaceId: activeWorkspaceId ?? undefined,
              })
            )
          }
          size="sm"
          variant="ghost"
        >
          {t("action.open")}
        </Button>
      </div>
    </div>
  );
}

interface AppearanceSettingsProps {
  desktopTerminalFontSize: number;
  locale: string;
  mobileTerminalFontSize: number;
  personalization: AppearancePersonalization;
  setDesktopTerminalFontSize: (value: number) => void;
  setLocale: (value: "zh" | "en") => void;
  setMobileTerminalFontSize: (value: number) => void;
  savePersonalization: (value: AppearancePersonalization) => Promise<boolean>;
  theme: string;
  setTheme: (value: string) => void;
}

function AppearanceSettings({
  desktopTerminalFontSize,
  locale,
  mobileTerminalFontSize,
  personalization,
  setDesktopTerminalFontSize,
  setLocale,
  setMobileTerminalFontSize,
  savePersonalization,
  theme,
  setTheme,
}: AppearanceSettingsProps) {
  const t = useTranslation();
  const themeTitleId = useId();
  const themeDescId = useId();
  const themeSelectId = useId();
  const languageTitleId = useId();
  const languageDescId = useId();
  const desktopTerminalFontSizeLabelId = useId();
  const desktopTerminalFontSizeDescId = useId();
  const mobileTerminalFontSizeLabelId = useId();
  const mobileTerminalFontSizeDescId = useId();
  const backgroundFileInputId = useId();
  const commonGlassLabelId = useId();
  const commonGlassDescId = useId();
  const desktopOverrideLabelId = useId();
  const desktopOverrideDescId = useId();
  const desktopGlassLabelId = useId();
  const desktopGlassDescId = useId();
  const mobileOverrideLabelId = useId();
  const mobileOverrideDescId = useId();
  const mobileGlassLabelId = useId();
  const mobileGlassDescId = useId();
  const dispatch = useSessionGateDispatch();
  const currentThemeId = resolveStoredThemeId(theme);
  const themeOptions = THEMES.map((registeredTheme) => ({
    value: registeredTheme.id,
    label: t(registeredTheme.labelKey),
  }));
  const [desktopTerminalFontSizeDraft, setDesktopTerminalFontSizeDraft] = useState(
    String(desktopTerminalFontSize)
  );
  const [desktopTerminalFontSizeError, setDesktopTerminalFontSizeError] = useState<string | null>(
    null
  );
  const [mobileTerminalFontSizeDraft, setMobileTerminalFontSizeDraft] = useState(
    String(mobileTerminalFontSize)
  );
  const [mobileTerminalFontSizeError, setMobileTerminalFontSizeError] = useState<string | null>(
    null
  );
  const [assetActionError, setAssetActionError] = useState<string | null>(null);
  const [backgroundDimnessDraft, setBackgroundDimnessDraft] = useState(
    String(personalization.common.backgroundDimness)
  );
  const [backgroundBlurDraft, setBackgroundBlurDraft] = useState(
    String(personalization.common.backgroundBlur)
  );
  const [glassIntensityDraft, setGlassIntensityDraft] = useState(
    String(personalization.common.glassIntensity)
  );
  const [surfaceOpacityDraft, setSurfaceOpacityDraft] = useState(
    String(personalization.common.surfaceOpacity)
  );
  const [backgroundDimnessError, setBackgroundDimnessError] = useState<string | null>(null);
  const [backgroundBlurError, setBackgroundBlurError] = useState<string | null>(null);
  const [glassIntensityError, setGlassIntensityError] = useState<string | null>(null);
  const [surfaceOpacityError, setSurfaceOpacityError] = useState<string | null>(null);
  const [desktopSurfaceOpacityDraft, setDesktopSurfaceOpacityDraft] = useState(
    personalization.desktop.surfaceOpacity === undefined
      ? String(personalization.common.surfaceOpacity)
      : String(personalization.desktop.surfaceOpacity)
  );
  const [mobileSurfaceOpacityDraft, setMobileSurfaceOpacityDraft] = useState(
    personalization.mobile.surfaceOpacity === undefined
      ? String(personalization.common.surfaceOpacity)
      : String(personalization.mobile.surfaceOpacity)
  );
  const [desktopSurfaceOpacityError, setDesktopSurfaceOpacityError] = useState<string | null>(null);
  const [mobileSurfaceOpacityError, setMobileSurfaceOpacityError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastTerminalFontSizeCommitAtRef = useRef<
    Record<"desktopTerminalFontSize" | "mobileTerminalFontSize", number>
  >({
    desktopTerminalFontSize: 0,
    mobileTerminalFontSize: 0,
  });

  const saveSettings = async (settings: Record<string, unknown>) => {
    return await dispatch("settings.update", { settings });
  };

  useEffect(() => {
    setDesktopTerminalFontSizeDraft(String(desktopTerminalFontSize));
  }, [desktopTerminalFontSize]);

  useEffect(() => {
    setMobileTerminalFontSizeDraft(String(mobileTerminalFontSize));
  }, [mobileTerminalFontSize]);

  useEffect(() => {
    setDesktopTerminalFontSizeError(null);
  }, [desktopTerminalFontSize]);

  useEffect(() => {
    setMobileTerminalFontSizeError(null);
  }, [mobileTerminalFontSize]);

  useEffect(() => {
    setBackgroundDimnessDraft(String(personalization.common.backgroundDimness));
    setBackgroundBlurDraft(String(personalization.common.backgroundBlur));
    setGlassIntensityDraft(String(personalization.common.glassIntensity));
    setSurfaceOpacityDraft(String(personalization.common.surfaceOpacity));
    setDesktopSurfaceOpacityDraft(
      String(personalization.desktop.surfaceOpacity ?? personalization.common.surfaceOpacity)
    );
    setMobileSurfaceOpacityDraft(
      String(personalization.mobile.surfaceOpacity ?? personalization.common.surfaceOpacity)
    );
  }, [personalization]);

  const handleThemeChange = (nextThemeId: string) => {
    const resolvedTheme = getThemeById(nextThemeId);
    if (resolvedTheme.id === currentThemeId) {
      return;
    }

    setTheme(resolvedTheme.id);
    document.documentElement.setAttribute("data-theme", resolvedTheme.documentThemeAttr);
    void saveSettings({ appearance: { themeId: resolvedTheme.id } });
  };

  const updateCommon = <K extends keyof AppearancePersonalization["common"]>(
    key: K,
    value: AppearancePersonalization["common"][K]
  ) => {
    return {
      ...personalization,
      common: {
        ...personalization.common,
        [key]: value,
      },
    };
  };

  const buildCommonForBackgroundMode = (mode: AppearanceBackgroundMode) => {
    if (mode === "image") {
      return personalization.common;
    }

    return {
      ...personalization.common,
      backgroundAssetId: null,
    };
  };

  const updateOverride = (
    target: AppearanceOverrideTarget,
    key: PersonalizationOverrideField,
    value: string | number | boolean | null | undefined
  ) => {
    const nextOverrides = {
      ...personalization[target],
      [key]: value,
    };

    if (value === undefined) {
      delete nextOverrides[key];
    }

    return {
      ...personalization,
      [target]: clearPersonalizationOverrides(nextOverrides),
    };
  };

  const isOverrideEnabled = (target: AppearanceOverrideTarget) =>
    Object.keys(personalization[target]).length > 0;

  const toggleOverride = (target: AppearanceOverrideTarget, enabled: boolean) => {
    if (enabled) {
      return {
        ...personalization,
        [target]: clearPersonalizationOverrides({
          ...personalization[target],
          surfaceOpacity:
            personalization[target].surfaceOpacity ?? personalization.common.surfaceOpacity,
        }),
      };
    }

    return {
      ...personalization,
      [target]: {},
    };
  };

  const saveNextPersonalization = async (next: AppearancePersonalization) => {
    setAssetActionError(null);
    const saved = await savePersonalization(next);
    return saved;
  };

  const commitBoundedCommonField = async (
    draft: string,
    currentValue: number,
    min: number,
    max: number,
    setDraft: (value: string) => void,
    setError: (value: string | null) => void,
    key: "backgroundDimness" | "backgroundBlur" | "glassIntensity" | "surfaceOpacity"
  ) => {
    const parsed = parseBoundedInteger(draft, min, max);
    if (parsed === null) {
      setDraft(String(currentValue));
      setError(
        t("settings.terminal_font_size_validation_error", {
          min,
          max,
        })
      );
      return;
    }

    if (parsed === currentValue) {
      setDraft(String(parsed));
      setError(null);
      return;
    }

    const saved = await saveNextPersonalization(updateCommon(key, parsed));
    if (!saved) {
      setDraft(String(currentValue));
      setError(t("settings.config_files.save_failed"));
      return;
    }

    setDraft(String(parsed));
    setError(null);
  };

  const commitBoundedOverrideField = async (
    target: AppearanceOverrideTarget,
    draft: string,
    fallbackValue: number,
    min: number,
    max: number,
    setDraft: (value: string) => void,
    setError: (value: string | null) => void,
    key: "backgroundDimness" | "backgroundBlur" | "glassIntensity" | "surfaceOpacity"
  ) => {
    const parsed = parseBoundedInteger(draft, min, max);
    if (parsed === null) {
      setDraft(String(fallbackValue));
      setError(
        t("settings.terminal_font_size_validation_error", {
          min,
          max,
        })
      );
      return;
    }

    const saved = await saveNextPersonalization(updateOverride(target, key, parsed));
    if (!saved) {
      setDraft(String(fallbackValue));
      setError(t("settings.config_files.save_failed"));
      return;
    }

    setDraft(String(parsed));
    setError(null);
  };

  const handleBackgroundFileSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: AppearanceAssetScope
  ) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const uploaded = await uploadAppearanceAsset(file);
      if (target === "common") {
        const saved = await saveNextPersonalization(
          updateCommon("backgroundAssetId", uploaded.assetId)
        );
        if (!saved) {
          setAssetActionError(t("settings.config_files.save_failed"));
        }
      } else {
        const saved = await saveNextPersonalization(
          updateOverride(target, "backgroundAssetId", uploaded.assetId)
        );
        if (!saved) {
          setAssetActionError(t("settings.config_files.save_failed"));
        }
      }
    } catch {
      setAssetActionError(t("settings.appearance_asset_upload_failed"));
    }
  };

  const openFilePicker = (target: AppearanceAssetScope) => {
    if (fileInputRef.current) {
      fileInputRef.current.dataset.scope = target;
      fileInputRef.current.click();
    }
  };

  const removeBackgroundAsset = async (target: AppearanceAssetScope) => {
    const currentAssetId =
      target === "common"
        ? personalization.common.backgroundAssetId
        : personalization[target].backgroundAssetId;

    if (!currentAssetId) {
      return;
    }

    try {
      await deleteAppearanceAsset(currentAssetId);
      if (target === "common") {
        const saved = await saveNextPersonalization(updateCommon("backgroundAssetId", null));
        if (!saved) {
          setAssetActionError(t("settings.config_files.save_failed"));
        }
      } else {
        const saved = await saveNextPersonalization(
          updateOverride(target, "backgroundAssetId", null)
        );
        if (!saved) {
          setAssetActionError(t("settings.config_files.save_failed"));
        }
      }
    } catch {
      setAssetActionError(t("settings.appearance_asset_delete_failed"));
    }
  };

  const renderAssetButtons = (target: AppearanceAssetScope, hasAsset: boolean) => (
    <div className="settings-appearance-actions">
      <Button
        aria-label={
          hasAsset
            ? t("settings.appearance_background_replace")
            : t("settings.appearance_background_upload")
        }
        size="sm"
        variant="secondary"
        onClick={() => openFilePicker(target)}
      >
        {hasAsset
          ? t("settings.appearance_background_replace")
          : t("settings.appearance_background_upload")}
      </Button>
      {hasAsset ? (
        <Button
          aria-label={t("settings.appearance_background_remove")}
          size="sm"
          variant="ghost"
          onClick={() => void removeBackgroundAsset(target)}
        >
          {t("settings.appearance_background_remove")}
        </Button>
      ) : null}
    </div>
  );

  const renderAssetSummary = (
    target: AppearanceAssetScope,
    label: string,
    assetId: string | null | undefined,
    hasAsset: boolean
  ) => (
    <div className="settings-appearance-asset-summary">
      <div className="settings-toggle-info settings-appearance-asset-meta">
        <span className="settings-toggle-label">{label}</span>
        <span className="settings-toggle-desc settings-appearance-asset-id">
          {assetId ? assetId : t("settings.appearance_uses_shared_value")}
        </span>
      </div>
      {renderAssetButtons(target, hasAsset)}
    </div>
  );

  const commitTerminalFontSize = async (
    draft: string,
    currentValue: number,
    settingKey: "desktopTerminalFontSize" | "mobileTerminalFontSize",
    setValue: (value: number) => void,
    setDraft: (value: string) => void,
    setError: (value: string | null) => void
  ) => {
    const parsed = parseTerminalFontSizeInput(draft);
    if (parsed === null) {
      setDraft(String(currentValue));
      setError(
        t("settings.terminal_font_size_validation_error", {
          min: MIN_TERMINAL_FONT_SIZE,
          max: MAX_TERMINAL_FONT_SIZE,
        })
      );
      return;
    }

    if (parsed === currentValue) {
      setDraft(String(parsed));
      setError(null);
      return;
    }

    const now = Date.now();
    if (
      now - lastTerminalFontSizeCommitAtRef.current[settingKey] <
      TERMINAL_FONT_SIZE_SAVE_THROTTLE_MS
    ) {
      return;
    }
    lastTerminalFontSizeCommitAtRef.current[settingKey] = now;

    const result = await dispatch("settings.update", {
      settings: {
        appearance: {
          [settingKey]: parsed,
        },
      },
    });

    if (result === null) {
      return;
    }

    if (!result.ok) {
      setDraft(String(currentValue));
      setError(result.error?.message || t("settings.config_files.save_failed"));
      return;
    }

    setValue(parsed);
    setDraft(String(parsed));
    setError(null);
  };

  return (
    <div className="settings-section">
      <input
        ref={fileInputRef}
        id={backgroundFileInputId}
        accept="image/png,image/jpeg,image/webp"
        className="settings-appearance-file-input"
        type="file"
        onChange={(event) => {
          const scope =
            (event.currentTarget.dataset.scope as AppearanceAssetScope | undefined) ?? "common";
          void handleBackgroundFileSelection(event, scope);
        }}
      />

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.appearance_background_material")}</h3>
        <p className="settings-group-desc">{t("settings.appearance_background_material_hint")}</p>

        <div className="settings-appearance-panels">
          <div className="settings-appearance-panel settings-appearance-panel--asset">
            <div className="settings-config-field settings-config-field--inline">
              <label className="settings-config-label" htmlFor="appearance-background-mode">
                {t("settings.appearance_background_mode")}
              </label>
              <div className="settings-config-control">
                <Select
                  desktopMode="listbox"
                  id="appearance-background-mode"
                  aria-label={t("settings.appearance_background_mode")}
                  className="settings-input-compact"
                  mobileSheetTitle={t("settings.appearance_background_mode")}
                  options={[
                    {
                      value: "none",
                      label: t("settings.appearance_background_mode_off"),
                    },
                    {
                      value: "image",
                      label: t("settings.appearance_background_mode_image"),
                    },
                  ]}
                  value={personalization.common.backgroundMode}
                  onValueChange={(value) => {
                    const nextMode = value as AppearanceBackgroundMode;
                    const next = {
                      ...personalization,
                      common: buildCommonForBackgroundMode(nextMode),
                    };
                    next.common.backgroundMode = nextMode;
                    void saveNextPersonalization(next);
                  }}
                />
              </div>
            </div>

            {personalization.common.backgroundMode === "image"
              ? renderAssetSummary(
                  "common",
                  t("settings.appearance_background_upload"),
                  personalization.common.backgroundAssetId,
                  Boolean(personalization.common.backgroundAssetId)
                )
              : null}

            <div className="settings-config-field settings-config-field--inline">
              <label className="settings-config-label" htmlFor="appearance-background-fit">
                {t("settings.appearance_background_fit")}
              </label>
              <div className="settings-config-control">
                <Select
                  desktopMode="listbox"
                  id="appearance-background-fit"
                  aria-label={t("settings.appearance_background_fit")}
                  className="settings-input-compact"
                  mobileSheetTitle={t("settings.appearance_background_fit")}
                  options={[
                    {
                      value: "cover",
                      label: t("settings.appearance_background_fit_cover"),
                    },
                    {
                      value: "contain",
                      label: t("settings.appearance_background_fit_contain"),
                    },
                  ]}
                  value={personalization.common.backgroundFit}
                  onValueChange={(value) => {
                    void saveNextPersonalization(
                      updateCommon("backgroundFit", value as AppearanceBackgroundFit)
                    );
                  }}
                />
              </div>
            </div>
          </div>

          <div className="settings-appearance-panel settings-appearance-panel--material">
            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label" id={commonGlassLabelId}>
                  {t("settings.appearance_glass_enabled")}
                </span>
                <span className="settings-toggle-desc" id={commonGlassDescId}>
                  {t("settings.appearance_uses_shared_value")}
                </span>
              </div>
              <Switch
                aria-describedby={commonGlassDescId}
                aria-labelledby={commonGlassLabelId}
                checked={personalization.common.glassEnabled}
                className="settings-toggle"
                onCheckedChange={(nextValue) => {
                  void saveNextPersonalization(updateCommon("glassEnabled", nextValue));
                }}
              />
            </div>

            <div className="settings-appearance-material-grid">
              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-background-dimness">
                  {t("settings.appearance_background_dimness")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-background-dimness"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(backgroundDimnessError)}
                    max={100}
                    min={0}
                    step={1}
                    type="number"
                    value={backgroundDimnessDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        backgroundDimnessDraft,
                        personalization.common.backgroundDimness,
                        0,
                        100,
                        setBackgroundDimnessDraft,
                        setBackgroundDimnessError,
                        "backgroundDimness"
                      );
                    }}
                    onChange={(event) => {
                      setBackgroundDimnessDraft(event.target.value);
                      setBackgroundDimnessError(null);
                    }}
                  />
                </div>
                {backgroundDimnessError ? (
                  <span className="form-error" role="alert">
                    {backgroundDimnessError}
                  </span>
                ) : null}
              </div>

              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-background-blur">
                  {t("settings.appearance_background_blur")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-background-blur"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(backgroundBlurError)}
                    max={40}
                    min={0}
                    step={1}
                    type="number"
                    value={backgroundBlurDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        backgroundBlurDraft,
                        personalization.common.backgroundBlur,
                        0,
                        40,
                        setBackgroundBlurDraft,
                        setBackgroundBlurError,
                        "backgroundBlur"
                      );
                    }}
                    onChange={(event) => {
                      setBackgroundBlurDraft(event.target.value);
                      setBackgroundBlurError(null);
                    }}
                  />
                </div>
                {backgroundBlurError ? (
                  <span className="form-error" role="alert">
                    {backgroundBlurError}
                  </span>
                ) : null}
              </div>

              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-glass-intensity">
                  {t("settings.appearance_glass_intensity")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-glass-intensity"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(glassIntensityError)}
                    max={100}
                    min={0}
                    step={1}
                    type="number"
                    value={glassIntensityDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        glassIntensityDraft,
                        personalization.common.glassIntensity,
                        0,
                        100,
                        setGlassIntensityDraft,
                        setGlassIntensityError,
                        "glassIntensity"
                      );
                    }}
                    onChange={(event) => {
                      setGlassIntensityDraft(event.target.value);
                      setGlassIntensityError(null);
                    }}
                  />
                </div>
                {glassIntensityError ? (
                  <span className="form-error" role="alert">
                    {glassIntensityError}
                  </span>
                ) : null}
              </div>

              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-surface-opacity">
                  {t("settings.appearance_surface_opacity")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-surface-opacity"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(surfaceOpacityError)}
                    max={100}
                    min={0}
                    step={1}
                    type="number"
                    value={surfaceOpacityDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        surfaceOpacityDraft,
                        personalization.common.surfaceOpacity,
                        0,
                        100,
                        setSurfaceOpacityDraft,
                        setSurfaceOpacityError,
                        "surfaceOpacity"
                      );
                    }}
                    onChange={(event) => {
                      setSurfaceOpacityDraft(event.target.value);
                      setSurfaceOpacityError(null);
                    }}
                  />
                </div>
                {surfaceOpacityError ? (
                  <span className="form-error" role="alert">
                    {surfaceOpacityError}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="settings-appearance-overrides">
            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label" id={desktopOverrideLabelId}>
                  {t("settings.appearance_override_desktop")}
                </span>
                <span className="settings-toggle-desc" id={desktopOverrideDescId}>
                  {isOverrideEnabled("desktop")
                    ? t("settings.appearance_override_enabled")
                    : t("settings.appearance_uses_shared_value")}
                </span>
              </div>
              <Switch
                aria-describedby={desktopOverrideDescId}
                aria-labelledby={desktopOverrideLabelId}
                checked={isOverrideEnabled("desktop")}
                className="settings-toggle"
                onCheckedChange={(nextValue) => {
                  void saveNextPersonalization(toggleOverride("desktop", nextValue));
                }}
              />
            </div>

            {isOverrideEnabled("desktop") ? (
              <div className="settings-appearance-override-panel">
                {personalization.common.backgroundMode === "image"
                  ? renderAssetSummary(
                      "desktop",
                      t("settings.appearance_override_desktop"),
                      personalization.desktop.backgroundAssetId,
                      Object.prototype.hasOwnProperty.call(
                        personalization.desktop,
                        "backgroundAssetId"
                      )
                    )
                  : null}
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-label" id={desktopGlassLabelId}>
                      {t("settings.appearance_glass_enabled")}
                    </span>
                    <span className="settings-toggle-desc" id={desktopGlassDescId}>
                      {t("settings.appearance_override_desktop")}
                    </span>
                  </div>
                  <Switch
                    aria-describedby={desktopGlassDescId}
                    aria-labelledby={desktopGlassLabelId}
                    checked={
                      personalization.desktop.glassEnabled ?? personalization.common.glassEnabled
                    }
                    className="settings-toggle"
                    onCheckedChange={(nextValue) => {
                      void saveNextPersonalization(
                        updateOverride("desktop", "glassEnabled", nextValue)
                      );
                    }}
                  />
                </div>
                <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                  <label
                    className="settings-config-label"
                    htmlFor="appearance-desktop-surface-opacity"
                  >
                    {t("settings.appearance_surface_opacity")}
                  </label>
                  <div className="settings-config-control">
                    <Input
                      id="appearance-desktop-surface-opacity"
                      className="settings-input-compact"
                      inputMode="numeric"
                      invalid={Boolean(desktopSurfaceOpacityError)}
                      max={100}
                      min={0}
                      step={1}
                      type="number"
                      value={desktopSurfaceOpacityDraft}
                      onBlur={() => {
                        void commitBoundedOverrideField(
                          "desktop",
                          desktopSurfaceOpacityDraft,
                          personalization.desktop.surfaceOpacity ??
                            personalization.common.surfaceOpacity,
                          0,
                          100,
                          setDesktopSurfaceOpacityDraft,
                          setDesktopSurfaceOpacityError,
                          "surfaceOpacity"
                        );
                      }}
                      onChange={(event) => {
                        setDesktopSurfaceOpacityDraft(event.target.value);
                        setDesktopSurfaceOpacityError(null);
                      }}
                    />
                  </div>
                  {desktopSurfaceOpacityError ? (
                    <span className="form-error" role="alert">
                      {desktopSurfaceOpacityError}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label" id={mobileOverrideLabelId}>
                  {t("settings.appearance_override_mobile")}
                </span>
                <span className="settings-toggle-desc" id={mobileOverrideDescId}>
                  {isOverrideEnabled("mobile")
                    ? t("settings.appearance_override_enabled")
                    : t("settings.appearance_uses_shared_value")}
                </span>
              </div>
              <Switch
                aria-describedby={mobileOverrideDescId}
                aria-labelledby={mobileOverrideLabelId}
                checked={isOverrideEnabled("mobile")}
                className="settings-toggle"
                onCheckedChange={(nextValue) => {
                  void saveNextPersonalization(toggleOverride("mobile", nextValue));
                }}
              />
            </div>

            {isOverrideEnabled("mobile") ? (
              <div className="settings-appearance-override-panel">
                {personalization.common.backgroundMode === "image"
                  ? renderAssetSummary(
                      "mobile",
                      t("settings.appearance_override_mobile"),
                      personalization.mobile.backgroundAssetId,
                      Object.prototype.hasOwnProperty.call(
                        personalization.mobile,
                        "backgroundAssetId"
                      )
                    )
                  : null}
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-label" id={mobileGlassLabelId}>
                      {t("settings.appearance_glass_enabled")}
                    </span>
                    <span className="settings-toggle-desc" id={mobileGlassDescId}>
                      {t("settings.appearance_override_mobile")}
                    </span>
                  </div>
                  <Switch
                    aria-describedby={mobileGlassDescId}
                    aria-labelledby={mobileGlassLabelId}
                    checked={
                      personalization.mobile.glassEnabled ?? personalization.common.glassEnabled
                    }
                    className="settings-toggle"
                    onCheckedChange={(nextValue) => {
                      void saveNextPersonalization(
                        updateOverride("mobile", "glassEnabled", nextValue)
                      );
                    }}
                  />
                </div>
                <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                  <label
                    className="settings-config-label"
                    htmlFor="appearance-mobile-surface-opacity"
                  >
                    {t("settings.appearance_surface_opacity")}
                  </label>
                  <div className="settings-config-control">
                    <Input
                      id="appearance-mobile-surface-opacity"
                      className="settings-input-compact"
                      inputMode="numeric"
                      invalid={Boolean(mobileSurfaceOpacityError)}
                      max={100}
                      min={0}
                      step={1}
                      type="number"
                      value={mobileSurfaceOpacityDraft}
                      onBlur={() => {
                        void commitBoundedOverrideField(
                          "mobile",
                          mobileSurfaceOpacityDraft,
                          personalization.mobile.surfaceOpacity ??
                            personalization.common.surfaceOpacity,
                          0,
                          100,
                          setMobileSurfaceOpacityDraft,
                          setMobileSurfaceOpacityError,
                          "surfaceOpacity"
                        );
                      }}
                      onChange={(event) => {
                        setMobileSurfaceOpacityDraft(event.target.value);
                        setMobileSurfaceOpacityError(null);
                      }}
                    />
                  </div>
                  {mobileSurfaceOpacityError ? (
                    <span className="form-error" role="alert">
                      {mobileSurfaceOpacityError}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {assetActionError ? (
          <span className="form-error" role="alert">
            {assetActionError}
          </span>
        ) : null}
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.terminal_appearance")}</h3>
        <p className="settings-group-desc">{t("settings.terminal_font_size_hint")}</p>

        <div className="settings-config-field settings-config-field--inline">
          <label
            className="settings-config-label"
            htmlFor="desktop-terminal-font-size"
            id={desktopTerminalFontSizeLabelId}
          >
            {t("settings.desktop_terminal_font_size")}
          </label>
          <div className="settings-config-control">
            <Input
              id="desktop-terminal-font-size"
              aria-describedby={desktopTerminalFontSizeDescId}
              aria-labelledby={desktopTerminalFontSizeLabelId}
              className="settings-input-compact"
              type="number"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              inputMode="numeric"
              invalid={Boolean(desktopTerminalFontSizeError)}
              value={desktopTerminalFontSizeDraft}
              onChange={(event) => {
                setDesktopTerminalFontSizeDraft(event.target.value);
                if (desktopTerminalFontSizeError) {
                  setDesktopTerminalFontSizeError(null);
                }
              }}
              onBlur={() => {
                void commitTerminalFontSize(
                  desktopTerminalFontSizeDraft,
                  desktopTerminalFontSize,
                  "desktopTerminalFontSize",
                  setDesktopTerminalFontSize,
                  setDesktopTerminalFontSizeDraft,
                  setDesktopTerminalFontSizeError
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTerminalFontSize(
                    desktopTerminalFontSizeDraft,
                    desktopTerminalFontSize,
                    "desktopTerminalFontSize",
                    setDesktopTerminalFontSize,
                    setDesktopTerminalFontSizeDraft,
                    setDesktopTerminalFontSizeError
                  );
                }
              }}
            />
          </div>
          <span className="settings-toggle-desc" id={desktopTerminalFontSizeDescId}>
            {t("settings.desktop_terminal_font_size_hint")}
          </span>
          {desktopTerminalFontSizeError ? (
            <span className="form-error" role="alert">
              {desktopTerminalFontSizeError}
            </span>
          ) : null}
        </div>

        <div className="settings-config-field settings-config-field--inline">
          <label
            className="settings-config-label"
            htmlFor="mobile-terminal-font-size"
            id={mobileTerminalFontSizeLabelId}
          >
            {t("settings.mobile_terminal_font_size")}
          </label>
          <div className="settings-config-control">
            <Input
              id="mobile-terminal-font-size"
              aria-describedby={mobileTerminalFontSizeDescId}
              aria-labelledby={mobileTerminalFontSizeLabelId}
              className="settings-input-compact"
              type="number"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              inputMode="numeric"
              invalid={Boolean(mobileTerminalFontSizeError)}
              value={mobileTerminalFontSizeDraft}
              onChange={(event) => {
                setMobileTerminalFontSizeDraft(event.target.value);
                if (mobileTerminalFontSizeError) {
                  setMobileTerminalFontSizeError(null);
                }
              }}
              onBlur={() => {
                void commitTerminalFontSize(
                  mobileTerminalFontSizeDraft,
                  mobileTerminalFontSize,
                  "mobileTerminalFontSize",
                  setMobileTerminalFontSize,
                  setMobileTerminalFontSizeDraft,
                  setMobileTerminalFontSizeError
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTerminalFontSize(
                    mobileTerminalFontSizeDraft,
                    mobileTerminalFontSize,
                    "mobileTerminalFontSize",
                    setMobileTerminalFontSize,
                    setMobileTerminalFontSizeDraft,
                    setMobileTerminalFontSizeError
                  );
                }
              }}
            />
          </div>
          <span className="settings-toggle-desc" id={mobileTerminalFontSizeDescId}>
            {t("settings.mobile_terminal_font_size_hint")}
          </span>
          {mobileTerminalFontSizeError ? (
            <span className="form-error" role="alert">
              {mobileTerminalFontSizeError}
            </span>
          ) : null}
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title" id={themeTitleId}>
          {t("settings.theme.title")}
        </h3>
        <p className="settings-group-desc" id={themeDescId}>
          {t("settings.theme.hint")}
        </p>
        <Select
          desktopMode="listbox"
          id={themeSelectId}
          aria-describedby={themeDescId}
          aria-label={t("settings.theme.title")}
          className="settings-input-compact"
          mobileSheetTitle={t("settings.theme.title")}
          options={themeOptions}
          value={currentThemeId}
          onValueChange={handleThemeChange}
        />
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
