import { useEffect, useMemo, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { createTranslator, type Locale } from "../../i18n";
import { Settings } from "../../components/Settings";
import { TopBar } from "../../components/TopBar";
import { checkCommandAvailability } from "../../services/http/system.service";
import { cloneAppSettings } from "../../shared/app/settings";
import {
  applyGeneralSettingsPatch,
  resolveClaudeCommandForTarget,
  updateClaudeCommandForTarget,
} from "../../shared/app/claude-settings.ts";
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
  const activeTarget = activeTab?.project?.target ?? { type: "native" as const };
  const workspaceTabs = buildWorkspaceTabItems(state.tabs, state.activeTabId, locale);
  const launchCommandValue = resolveClaudeCommandForTarget(settingsDraft, activeTarget);

  useEffect(() => {
    setSettingsDraft(cloneAppSettings(appSettings));
  }, [appSettings]);

  useEffect(() => {
    const command = launchCommandValue.trim();
    if (!command) {
      setAgentCommandStatus({ loading: false, available: null, runtimeLabel: "" });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAgentCommandStatus((current) => ({ ...current, loading: true, error: undefined }));
      try {
        const result = await checkCommandAvailability(command, activeTarget, activeTab?.project?.path);
        if (cancelled) return;
        setAgentCommandStatus({
          loading: false,
          available: result.available,
          runtimeLabel: activeTarget.type === "wsl"
            ? (activeTarget.distro?.trim() ? `WSL (${activeTarget.distro.trim()})` : "WSL")
            : t("nativeTarget"),
          resolvedPath: result.resolved_path ?? undefined,
          error: result.error ?? undefined
        });
      } catch (error) {
        if (cancelled) return;
        setAgentCommandStatus({
          loading: false,
          available: false,
          runtimeLabel: activeTarget.type === "wsl"
            ? (activeTarget.distro?.trim() ? `WSL (${activeTarget.distro.trim()})` : "WSL")
            : t("nativeTarget"),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeTab?.project?.path,
    activeTarget.type,
    activeTarget.type === "wsl" ? activeTarget.distro : "",
    launchCommandValue,
    t,
  ]);

  const commitSettings = (nextSettings: AppSettings) => {
    setSettingsDraft(cloneAppSettings(nextSettings));
    onCommitSettings(nextSettings);
  };

  const onLaunchCommandChange = (command: string) => {
    commitSettings(updateClaudeCommandForTarget(settingsDraft, activeTarget, command));
  };

  const onGeneralSettingsChange = (patch: Partial<AppSettings["general"]>) => {
    commitSettings(applyGeneralSettingsPatch(settingsDraft, patch));
  };

  const onSettingsIdlePolicyChange = (patch: Partial<AppSettings["general"]["idlePolicy"]>) => {
    commitSettings(applyGeneralSettingsPatch(settingsDraft, { idlePolicy: patch }));
  };

  const trimmedLaunchCommand = launchCommandValue.trim();
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
        launchCommandValue={launchCommandValue}
        launchCommandStatus={{
          stateClass: launchCommandStateClass,
          text: launchCommandStatusText,
          detailText: launchCommandDetailText
        }}
        notificationPermissionText={notificationPermissionText}
        onSettingsPanelChange={setActiveSettingsPanel}
        onGeneralSettingsChange={onGeneralSettingsChange}
        onLaunchCommandChange={onLaunchCommandChange}
        onSettingsIdlePolicyChange={onSettingsIdlePolicyChange}
        onSelectLocale={onSelectLocale}
        t={t}
      />
    </div>
  );
};
