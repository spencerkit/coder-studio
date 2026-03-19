import { useEffect, useMemo, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { createTranslator, type Locale } from "../../i18n";
import { Settings } from "../../components/Settings";
import { TopBar } from "../../components/TopBar";
import { checkCommandAvailability } from "../../services/http/system.service";
import { cloneAppSettings } from "../../shared/app/settings";
import { createTab, persistWorkbenchState, workbenchState } from "../../state/workbench";
import type { AppSettings, SettingsPanel } from "../../types/app";
import { buildWorkspaceTabItems } from "../workspace";

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
  const [state, setState] = useRelaxState(workbenchState);
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
  const t = useMemo(() => createTranslator(locale), [locale]);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  const workspaceTabs = buildWorkspaceTabItems(state.tabs, state.activeTabId, locale);

  const updateState = (updater: (current: typeof state) => typeof state) => {
    setState(updater(state));
  };

  useEffect(() => {
    setSettingsDraft(cloneAppSettings(appSettings));
  }, [appSettings]);

  useEffect(() => {
    persistWorkbenchState(state);
  }, [state]);

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
      idlePolicy: patch.idlePolicy ? { ...patch.idlePolicy } : settingsDraft.idlePolicy
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

  const onAddTab = () => {
    updateState((current) => {
      const nextIndex = current.tabs.length + 1;
      const createdTab = createTab(nextIndex, locale);
      const newTab = {
        ...createdTab,
        agent: {
          ...createdTab.agent,
          provider: appSettings.agentProvider,
          command: appSettings.agentCommand,
        },
        idlePolicy: { ...appSettings.idlePolicy }
      };
      return {
        ...current,
        tabs: [...current.tabs, newTab],
        activeTabId: newTab.id
      };
    });
    onCloseSettings();
  };

  const onRemoveTab = (tabId: string) => {
    updateState((current) => {
      if (current.tabs.length === 1) return current;
      const remainingTabs = current.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId = current.activeTabId === tabId ? (remainingTabs[0]?.id ?? current.activeTabId) : current.activeTabId;
      return { ...current, tabs: remainingTabs, activeTabId };
    });
  };

  const onSwitchWorkspace = (tabId: string) => {
    updateState((current) => ({ ...current, activeTabId: tabId }));
    onCloseSettings();
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

  return (
    <div className="app" data-theme="dark">
      <TopBar
        isSettingsRoute
        locale={locale}
        workspaceTabs={workspaceTabs}
        onSwitchWorkspace={onSwitchWorkspace}
        onAddTab={onAddTab}
        onRemoveTab={onRemoveTab}
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
        onSettingsPanelChange={setActiveSettingsPanel}
        onSettingsChange={onSettingsChange}
        onSettingsIdlePolicyChange={onSettingsIdlePolicyChange}
        onSelectLocale={onSelectLocale}
        t={t}
      />
    </div>
  );
};
