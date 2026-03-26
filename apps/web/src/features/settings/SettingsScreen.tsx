import { useEffect, useMemo, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { createTranslator, type Locale } from "../../i18n";
import { Settings } from "../../components/Settings";
import { TopBar } from "../../components/TopBar";
import { checkCommandAvailability } from "../../services/http/system.service";
import { cloneAppSettings } from "../../shared/app/settings";
import { workbenchState } from "../../state/workbench";
import type { AppSettings, BrowserNotificationSupport, SettingsPanel } from "../../types/app";
import { buildWorkspaceTabItems, getBrowserNotificationPermissionState } from "../workspace";

type SettingsScreenProps = {
  locale: Locale;
  appSettings: AppSettings;
  onSelectLocale: (locale: Locale) => void;
  onCommitSettings: (nextSettings: AppSettings) => void;
  onCloseSettings: () => void;
};

export const SettingsScreen = ({
  locale,
  appSettings,
  onSelectLocale,
  onCommitSettings,
  onCloseSettings,
}: SettingsScreenProps) => {
  const [state] = useRelaxState(workbenchState);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() => cloneAppSettings(appSettings));
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>("general");
  const [agentCommandStatus, setAgentCommandStatus] = useState<{
    loading: boolean;
    available: boolean | null;
    runtimeLabel: string;
    resolvedPath?: string;
    error?: string;
  }>({
    loading: false,
    available: null,
    runtimeLabel: ""
  });
  const [notificationPermissionState, setNotificationPermissionState] = useState<BrowserNotificationSupport>(() =>
    getBrowserNotificationPermissionState()
  );
  const t = useMemo(() => createTranslator(locale), [locale]);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  const workspaceTabs = buildWorkspaceTabItems(state.tabs, state.activeTabId, locale);

  useEffect(() => {
    setSettingsDraft(cloneAppSettings(appSettings));
  }, [appSettings]);

  useEffect(() => {
    const command = settingsDraft.agentCommand.trim();
    if (!command) {
      setAgentCommandStatus({ loading: false, available: null, runtimeLabel: "" });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAgentCommandStatus((current) => ({ ...current, loading: true, error: undefined }));
      try {
        const result = await checkCommandAvailability(command, activeTab?.project?.target ?? { type: "native" }, activeTab?.project?.path);
        if (cancelled) return;
        setAgentCommandStatus({
          loading: false,
          available: result.available,
          runtimeLabel: activeTab?.project?.target?.type === "wsl"
            ? (activeTab.project?.target.distro?.trim() ? `WSL (${activeTab.project.target.distro.trim()})` : "WSL")
            : t("nativeTarget"),
          resolvedPath: result.resolved_path ?? undefined,
          error: result.error ?? undefined
        });
      } catch (error) {
        if (cancelled) return;
        setAgentCommandStatus({
          loading: false,
          available: false,
          runtimeLabel: activeTab?.project?.target?.type === "wsl"
            ? (activeTab.project?.target.distro?.trim() ? `WSL (${activeTab.project.target.distro.trim()})` : "WSL")
            : t("nativeTarget"),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settingsDraft.agentCommand, activeTab?.project?.path, activeTab?.project?.target?.type, activeTab?.project?.target?.type === "wsl" ? activeTab?.project?.target.distro : "", t]);

  const commitSettings = (nextSettings: AppSettings) => {
    setSettingsDraft(cloneAppSettings(nextSettings));
    onCommitSettings(nextSettings);
  };

  const onSettingsChange = (patch: Partial<AppSettings>) => {
    const nextSettings: AppSettings = {
      ...settingsDraft,
      ...patch,
      idlePolicy: patch.idlePolicy
        ? { ...settingsDraft.idlePolicy, ...patch.idlePolicy }
        : settingsDraft.idlePolicy,
      completionNotifications: patch.completionNotifications
        ? { ...settingsDraft.completionNotifications, ...patch.completionNotifications }
        : settingsDraft.completionNotifications
    };
    commitSettings(nextSettings);
  };

  const onSettingsIdlePolicyChange = (patch: Partial<AppSettings["idlePolicy"]>) => {
    const nextSettings: AppSettings = {
      ...settingsDraft,
      idlePolicy: {
        enabled: patch.enabled ?? settingsDraft.idlePolicy.enabled,
        idleMinutes: Math.max(1, Number(patch.idleMinutes ?? settingsDraft.idlePolicy.idleMinutes) || 1),
        maxActive: Math.max(1, Number(patch.maxActive ?? settingsDraft.idlePolicy.maxActive) || 1),
        pressure: patch.pressure ?? settingsDraft.idlePolicy.pressure
      }
    };
    commitSettings(nextSettings);
  };

  const trimmedLaunchCommand = settingsDraft.agentCommand.trim();
  const launchCommandStateClass = agentCommandStatus.loading
    ? "checking"
    : !trimmedLaunchCommand
      ? "idle"
      : agentCommandStatus.available
        ? "available"
        : "missing";
  const launchCommandStatusText = agentCommandStatus.loading
    ? t("launchCommandChecking")
    : !trimmedLaunchCommand
      ? t("launchCommandEmpty")
      : agentCommandStatus.available
        ? t("launchCommandAvailable", { runtime: agentCommandStatus.runtimeLabel || t("nativeTarget") })
        : t("launchCommandMissing", { runtime: agentCommandStatus.runtimeLabel || t("nativeTarget") });
  const launchCommandDetailText = !trimmedLaunchCommand
    ? ""
    : agentCommandStatus.available
      ? (agentCommandStatus.resolvedPath ? t("launchCommandResolvedPath", { path: agentCommandStatus.resolvedPath }) : "")
      : (agentCommandStatus.error ?? "");
  const notificationPermissionText = notificationPermissionState === "allowed"
    ? t("notificationPermissionAllowed")
    : notificationPermissionState === "unsupported"
      ? t("notificationPermissionUnsupported")
      : t("notificationPermissionNotEnabled");

  return (
    <div className="app" data-theme="dark">
      <TopBar
        isSettingsRoute
        locale={locale}
        workspaceTabs={workspaceTabs}
        onSwitchWorkspace={() => {}}
        onAddTab={() => {}}
        onRemoveTab={() => {}}
        onOpenSettings={() => {}}
        onCloseSettings={onCloseSettings}
        onOpenCommandPalette={() => {}}
        t={t}
      />
      <Settings
        locale={locale}
        activeSettingsPanel={activeSettingsPanel}
        settingsDraft={settingsDraft}
        launchCommandStatus={{
          stateClass: launchCommandStateClass,
          text: launchCommandStatusText,
          detailText: launchCommandDetailText
        }}
        notificationPermissionText={notificationPermissionText}
        onSettingsPanelChange={setActiveSettingsPanel}
        onSettingsChange={onSettingsChange}
        onSettingsIdlePolicyChange={onSettingsIdlePolicyChange}
        onSelectLocale={onSelectLocale}
        t={t}
      />
    </div>
  );
};
