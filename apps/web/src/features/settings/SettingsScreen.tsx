import { useMemo, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { createTranslator, type Locale } from "../../i18n";
import { Settings } from "../../components/Settings";
import { TopBar } from "../../components/TopBar";
import { installProviderHooks } from "../../services/http/provider-hooks.service";
import {
  applyAgentDefaultsPatch,
  applyGeneralSettingsPatch,
} from "../../shared/app/app-settings";
import { workbenchState } from "../../state/workbench";
import type {
  AppSettings,
  AppSettingsUpdater,
  BrowserNotificationSupport,
  SettingsPanel,
} from "../../types/app";
import { buildWorkspaceTabItems, getBrowserNotificationPermissionState } from "../workspace";

type SettingsScreenProps = {
  locale: Locale;
  settingsDraft: AppSettings;
  onSelectLocale: (locale: Locale) => void;
  onCommitSettings: (updater: AppSettingsUpdater) => void;
  onCloseSettings: () => void;
};

export const SettingsScreen = ({
  locale,
  settingsDraft,
  onSelectLocale,
  onCommitSettings,
  onCloseSettings,
}: SettingsScreenProps) => {
  const [state] = useRelaxState(workbenchState);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>("general");
  const [notificationPermissionState, setNotificationPermissionState] = useState<BrowserNotificationSupport>(() =>
    getBrowserNotificationPermissionState()
  );
  const t = useMemo(() => createTranslator(locale), [locale]);
  const workspaceTabs = buildWorkspaceTabItems(state.tabs, state.activeTabId, locale);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const activeWorkspaceProject = activeTab?.project ?? null;
  const providerInjectionContextKey = [
    activeWorkspaceProject?.path ?? "no-workspace",
    activeWorkspaceProject?.target.type ?? "native",
    activeWorkspaceProject?.target.type === "wsl" ? (activeWorkspaceProject?.target.distro ?? "") : "",
  ].join("::");

  const commitSettings = (updater: AppSettingsUpdater) => {
    onCommitSettings(updater);
  };

  const onGeneralSettingsChange = (patch: Partial<AppSettings["general"]>) => {
    commitSettings((current) => applyGeneralSettingsPatch(current, patch));
  };

  const onAgentDefaultsChange = (patch: Partial<AppSettings["agentDefaults"]>) => {
    commitSettings((current) => applyAgentDefaultsPatch(current, patch));
  };

  const notificationPermissionText = notificationPermissionState === "allowed"
    ? t("notificationPermissionAllowed")
    : notificationPermissionState === "unsupported"
      ? t("notificationPermissionUnsupported")
      : t("notificationPermissionNotEnabled");

  const onInjectProviderHooks = async (providerId: string) => {
    if (!activeWorkspaceProject) {
      throw new Error(t("injectHooksWorkspaceRequired"));
    }

    await installProviderHooks(
      providerId,
      activeWorkspaceProject.path,
      activeWorkspaceProject.target,
    );
  };

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
        notificationPermissionText={notificationPermissionText}
        onSettingsPanelChange={setActiveSettingsPanel}
        onGeneralSettingsChange={onGeneralSettingsChange}
        onAgentDefaultsChange={onAgentDefaultsChange}
        onProviderSettingsChange={commitSettings}
        onInjectProviderHooks={onInjectProviderHooks}
        canInjectProviderHooks={Boolean(activeWorkspaceProject)}
        injectProviderHooksHint={activeWorkspaceProject ? undefined : t("injectHooksWorkspaceRequired")}
        injectionContextKey={providerInjectionContextKey}
        onSelectLocale={onSelectLocale}
        t={t}
      />
    </div>
  );
};
