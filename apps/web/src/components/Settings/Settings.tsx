import type { Locale, Translator } from "../../i18n";
import type { AppSettings, SettingsPanel } from "../../types/app";
import { SettingsAppearanceIcon, SettingsGeneralIcon } from "../icons";

type SettingsProps = {
  locale: Locale;
  activeSettingsPanel: SettingsPanel;
  settingsDraft: AppSettings;
  launchCommandStatus: {
    stateClass: string;
    text: string;
    detailText: string;
  };
  notificationPermissionText: string;
  onSettingsPanelChange: (panel: SettingsPanel) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onSettingsIdlePolicyChange: (patch: Partial<AppSettings["idlePolicy"]>) => void;
  onSelectLocale: (locale: Locale) => void;
  t: Translator;
};

const settingsNavItems = (t: Translator) => [
  { id: "general" as const, label: t("settingsGeneral"), icon: <SettingsGeneralIcon /> },
  { id: "appearance" as const, label: t("settingsAppearance"), icon: <SettingsAppearanceIcon /> }
];

export const Settings = ({
  locale,
  activeSettingsPanel,
  settingsDraft,
  launchCommandStatus,
  notificationPermissionText,
  onSettingsPanelChange,
  onSettingsChange,
  onSettingsIdlePolicyChange,
  onSelectLocale,
  t
}: SettingsProps) => (
  <main className="settings-route" data-testid="settings-page">
    <section className="settings-layout">
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
          {activeSettingsPanel === "general" ? (
            <div className="settings-group-card">
              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{t("launchCommand")}</strong>
                  <span>{t("launchCommandHint")}</span>
                </div>
                <div className="settings-row-control">
                  <div className="settings-command-field">
                    <input
                      className="settings-inline-input"
                      value={settingsDraft.agentCommand}
                      onChange={(event) => onSettingsChange({ agentCommand: event.target.value })}
                      placeholder={t("launchCommandPlaceholder")}
                      data-testid="settings-agent-command"
                    />
                    <div
                      className={`settings-inline-status ${launchCommandStatus.stateClass}`}
                      data-testid="settings-agent-command-status"
                    >
                      <span className="settings-inline-status-dot" aria-hidden="true" />
                      <div className="settings-inline-status-copy">
                        <span>{launchCommandStatus.text}</span>
                        {launchCommandStatus.detailText && <small>{launchCommandStatus.detailText}</small>}
                      </div>
                    </div>
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
                      checked={settingsDraft.idlePolicy.enabled}
                      onChange={() => onSettingsIdlePolicyChange({ enabled: !settingsDraft.idlePolicy.enabled })}
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
                    value={settingsDraft.idlePolicy.idleMinutes}
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
                    value={settingsDraft.idlePolicy.maxActive}
                    onChange={(event) => onSettingsIdlePolicyChange({ maxActive: Number(event.target.value) })}
                    data-testid="settings-max-active"
                  />
                  <span>{t("sessionsWord")}</span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{t("completionNotifications")}</strong>
                  <span>{t("completionNotificationsHint")}</span>
                </div>
                <div className="settings-row-control">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settingsDraft.completionNotifications.enabled}
                      onChange={() => onSettingsChange({
                        completionNotifications: {
                          enabled: !settingsDraft.completionNotifications.enabled
                        }
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
                      checked={settingsDraft.completionNotifications.onlyWhenBackground}
                      onChange={() => onSettingsChange({
                        completionNotifications: {
                          onlyWhenBackground: !settingsDraft.completionNotifications.onlyWhenBackground
                        }
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

              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{t("memoryPressure")}</strong>
                  <span>{t("memoryPressureHint")}</span>
                </div>
                <div className="settings-row-control">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settingsDraft.idlePolicy.pressure}
                      onChange={() => onSettingsIdlePolicyChange({ pressure: !settingsDraft.idlePolicy.pressure })}
                    />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div className="settings-group-card">
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
                      className={`settings-pill-option ${settingsDraft.terminalCompatibilityMode === "standard" ? "active" : ""}`}
                      onClick={() => onSettingsChange({ terminalCompatibilityMode: "standard" })}
                      data-testid="settings-terminal-standard"
                    >
                      {t("terminalRenderingStandard")}
                    </button>
                    <button
                      type="button"
                      className={`settings-pill-option ${settingsDraft.terminalCompatibilityMode === "compatibility" ? "active" : ""}`}
                      onClick={() => onSettingsChange({ terminalCompatibilityMode: "compatibility" })}
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
                      className={`settings-pill-option ${locale === "zh" ? "active" : ""}`}
                      onClick={() => onSelectLocale("zh")}
                    >
                      中文
                    </button>
                    <button
                      type="button"
                      className={`settings-pill-option ${locale === "en" ? "active" : ""}`}
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

        <div className="settings-footer-bar">
          <div className="settings-page-status">
            {t("settingsAutoSave")}
          </div>
        </div>
      </section>
    </section>
  </main>
);

export default Settings;
