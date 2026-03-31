import type { Locale, Translator } from "../../i18n";
import type { AppSettings, AppSettingsUpdater, SettingsPanel } from "../../types/app";
import {
  BUILTIN_PROVIDER_MANIFESTS,
  getProviderPanelId,
} from "../../features/providers/registry.ts";
import { getSettingsDraftLocale } from "../../shared/app/claude-settings.ts";
import { SettingsAppearanceIcon, SettingsConfigIcon, SettingsGeneralIcon } from "../icons";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel.tsx";

type SettingsProps = {
  locale: Locale;
  activeSettingsPanel: SettingsPanel;
  settingsDraft: AppSettings;
  notificationPermissionText: string;
  onSettingsPanelChange: (panel: SettingsPanel) => void;
  onGeneralSettingsChange: (patch: Partial<AppSettings["general"]>) => void;
  onAgentDefaultsChange: (patch: Partial<AppSettings["agentDefaults"]>) => void;
  onSettingsIdlePolicyChange: (patch: Partial<AppSettings["general"]["idlePolicy"]>) => void;
  onProviderSettingsChange: (updater: AppSettingsUpdater) => void;
  onSelectLocale: (locale: Locale) => void;
  t: Translator;
};

const settingsNavItems = (t: Translator) => [
  { id: "general" as const, label: t("settingsGeneral"), icon: <SettingsGeneralIcon />, testId: "general" },
  ...BUILTIN_PROVIDER_MANIFESTS.map((manifest) => ({
    id: getProviderPanelId(manifest.id) as SettingsPanel,
    label: t(manifest.settingsTitleKey),
    icon: <SettingsConfigIcon />,
    testId: manifest.id,
  })),
  { id: "appearance" as const, label: t("settingsAppearance"), icon: <SettingsAppearanceIcon />, testId: "appearance" },
];

const getActiveProviderId = (panel: SettingsPanel): string | null => (
  panel.startsWith("provider:") ? panel.slice("provider:".length) : null
);

export const Settings = ({
  locale,
  activeSettingsPanel,
  settingsDraft,
  notificationPermissionText,
  onSettingsPanelChange,
  onGeneralSettingsChange,
  onAgentDefaultsChange,
  onSettingsIdlePolicyChange,
  onProviderSettingsChange,
  onSelectLocale,
  t,
}: SettingsProps) => {
  const selectedLocale = getSettingsDraftLocale(settingsDraft);
  const activeProviderId = getActiveProviderId(activeSettingsPanel);

  return (
    <main className="settings-route" data-testid="settings-page" data-density="compact">
      <section className="settings-layout settings-document-shell">
        <aside className="settings-sidebar-v2">
          <nav className="settings-nav-list" aria-label={t("settings")}>
            {settingsNavItems(t).map((item) => {
              const isActive = item.id === activeSettingsPanel;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${isActive ? "active" : ""}`}
                  onClick={() => onSettingsPanelChange(item.id)}
                  data-testid={`settings-nav-${item.testId}`}
                >
                  <span className="settings-nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="settings-content-v2">
          <div className="settings-scroll-panel">
            <div className="settings-section-stack">
              {activeSettingsPanel === "general" ? (
                <>
                  <div className="settings-group-card settings-group-card--document">
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("defaultProvider")}</strong>
                        <span>{t("defaultProviderHint")}</span>
                      </div>
                      <div className="settings-row-control">
                        <div className="settings-pill-select">
                          {BUILTIN_PROVIDER_MANIFESTS.map((manifest) => (
                            <button
                              key={manifest.id}
                              type="button"
                              className={`settings-pill-option ${settingsDraft.agentDefaults.provider === manifest.id ? "active" : ""}`}
                              onClick={() => onAgentDefaultsChange({ provider: manifest.id })}
                              data-testid={`settings-default-provider-${manifest.id}`}
                            >
                              {manifest.badgeLabel}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("autoSuspend")}</strong>
                        <span>{t("autoSuspendHint")}</span>
                      </div>
                      <div className="settings-row-control">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={settingsDraft.general.idlePolicy.enabled}
                            onChange={() => onSettingsIdlePolicyChange({ enabled: !settingsDraft.general.idlePolicy.enabled })}
                          />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("idleAfter")}</strong>
                        <span>{t("idleAfterHint")}</span>
                      </div>
                      <div className="settings-row-control settings-number-control">
                        <input
                          className="settings-inline-number"
                          type="number"
                          min={1}
                          value={settingsDraft.general.idlePolicy.idleMinutes}
                          onChange={(event) => onSettingsIdlePolicyChange({ idleMinutes: Number(event.target.value) })}
                          data-testid="settings-idle-minutes"
                        />
                        <span>{t("minutesShort")}</span>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("maxActive")}</strong>
                        <span>{t("maxActiveHint")}</span>
                      </div>
                      <div className="settings-row-control settings-number-control">
                        <input
                          className="settings-inline-number"
                          type="number"
                          min={1}
                          value={settingsDraft.general.idlePolicy.maxActive}
                          onChange={(event) => onSettingsIdlePolicyChange({ maxActive: Number(event.target.value) })}
                          data-testid="settings-max-active"
                        />
                        <span>{t("sessionsWord")}</span>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("memoryPressure")}</strong>
                        <span>{t("memoryPressureHint")}</span>
                      </div>
                      <div className="settings-row-control">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={settingsDraft.general.idlePolicy.pressure}
                            onChange={() => onSettingsIdlePolicyChange({ pressure: !settingsDraft.general.idlePolicy.pressure })}
                          />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="settings-group-card settings-group-card--document">
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("completionNotifications")}</strong>
                        <span>{t("completionNotificationsHint")}</span>
                      </div>
                      <div className="settings-row-control">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={settingsDraft.general.completionNotifications.enabled}
                            onChange={() => onGeneralSettingsChange({
                              completionNotifications: {
                                enabled: !settingsDraft.general.completionNotifications.enabled,
                              },
                            })}
                            data-testid="settings-completion-notifications"
                          />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("notifyOnlyInBackground")}</strong>
                        <span>{t("notifyOnlyInBackgroundHint")}</span>
                      </div>
                      <div className="settings-row-control">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={settingsDraft.general.completionNotifications.onlyWhenBackground}
                            onChange={() => onGeneralSettingsChange({
                              completionNotifications: {
                                onlyWhenBackground: !settingsDraft.general.completionNotifications.onlyWhenBackground,
                              },
                            })}
                            data-testid="settings-notify-only-background"
                          />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{t("notificationPermission")}</strong>
                      </div>
                      <div className="settings-row-control">
                        <span data-testid="settings-notification-permission">{notificationPermissionText}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : activeSettingsPanel.startsWith("provider:") ? (
                <ProviderSettingsPanel
                  providerId={activeProviderId ?? ""}
                  settings={settingsDraft}
                  onChange={onProviderSettingsChange}
                  t={t}
                />
              ) : (
                <div className="settings-group-card settings-group-card--document">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("theme")}</strong>
                      <span>{locale === "zh" ? "当前版本仅保留深色主题。" : "This version uses a dark-only theme."}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-pill-select single">
                        <span className="settings-pill-option active">{t("themeDark")}</span>
                      </div>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("terminalRendering")}</strong>
                      <span>{t("terminalRenderingHint")}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-pill-select">
                        <button
                          type="button"
                          className={`settings-pill-option ${settingsDraft.general.terminalCompatibilityMode === "standard" ? "active" : ""}`}
                          onClick={() => onGeneralSettingsChange({ terminalCompatibilityMode: "standard" })}
                          data-testid="settings-terminal-standard"
                        >
                          {t("terminalRenderingStandard")}
                        </button>
                        <button
                          type="button"
                          className={`settings-pill-option ${settingsDraft.general.terminalCompatibilityMode === "compatibility" ? "active" : ""}`}
                          onClick={() => onGeneralSettingsChange({ terminalCompatibilityMode: "compatibility" })}
                          data-testid="settings-terminal-compatibility"
                        >
                          {t("terminalRenderingCompatibility")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("languageLabel")}</strong>
                      <span>{t("languageHint")}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-pill-select">
                        <button
                          type="button"
                          className={`settings-pill-option ${selectedLocale === "zh" ? "active" : ""}`}
                          onClick={() => onSelectLocale("zh")}
                        >
                          中文
                        </button>
                        <button
                          type="button"
                          className={`settings-pill-option ${selectedLocale === "en" ? "active" : ""}`}
                          onClick={() => onSelectLocale("en")}
                        >
                          English
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="settings-footer-bar">
            <div className="settings-page-status">
              {t("settingsAutoSave")}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
};

export default Settings;
