import { useMemo, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { createTranslator, type Locale } from "../../i18n";
import { Settings } from "../../components/Settings";
import { TopBar } from "../../components/TopBar";
import {
  applyGeneralSettingsPatch,
} from "../../shared/app/claude-settings.ts";
import { workbenchState } from "../../state/workbench";
import type { AppSettings, BrowserNotificationSupport, SettingsPanel } from "../../types/app";
import { buildWorkspaceTabItems, getBrowserNotificationPermissionState } from "../workspace";

type SettingsScreenProps = {
  locale: Locale;
  settingsDraft: AppSettings;
  onSelectLocale: (locale: Locale) => void;
  onCommitSettings: (nextSettings: AppSettings) => void;
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

  const commitSettings = (nextSettings: AppSettings) => {
    onCommitSettings(nextSettings);
  };

  const onGeneralSettingsChange = (patch: Partial<AppSettings["general"]>) => {
    commitSettings(applyGeneralSettingsPatch(settingsDraft, patch));
  };

  const onSettingsIdlePolicyChange = (patch: Partial<AppSettings["general"]["idlePolicy"]>) => {
    commitSettings(applyGeneralSettingsPatch(settingsDraft, { idlePolicy: patch }));
  };

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
        historyOpen={false}
        onSwitchWorkspace={() => {}}
        onToggleHistory={() => {}}
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
        onSettingsIdlePolicyChange={onSettingsIdlePolicyChange}
        onClaudeSettingsChange={commitSettings}
        onSelectLocale={onSelectLocale}
        t={t}
      />
    </div>
  );
};
