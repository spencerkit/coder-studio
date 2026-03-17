// ==========================================================================
// Coder Studio - Settings Component
// ==========================================================================

import React from "react";
import type { SettingsProps } from "../types";
import { HeaderBackIcon, SettingsGeneralIcon, SettingsAppearanceIcon, SettingsGitIcon, SettingsWorktreeIcon, SettingsMcpIcon, SettingsArchiveIcon } from "../icons";

export const Settings: React.FC<SettingsProps> = ({
  theme,
  locale,
  settings,
  settingsNavItems,
  activeSettingsPanel,
  settingsDraft,
  onSettingsChange,
  onSettingsIdlePolicyChange,
  onSettingsPanelChange,
  onThemeChange,
  onLocaleChange,
  onCloseSettings,
  t
}) => {
  return (
    <main className="settings-route" data-testid="settings-page">
      <section className="settings-layout">
        <aside className="settings-sidebar-v2">
          <button className="settings-back-link" type="button" onClick={onCloseSettings}>
            <HeaderBackIcon />
            <span>{t("backToApp")}</span>
          </button>

          <nav className="settings-nav-list" aria-label={t("settings")}>
            {settingsNavItems.map((item) => {
              const isActive = item.id === activeSettingsPanel;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${isActive ? "active" : ""} ${item.enabled ? "" : "disabled"}`}
                  onClick={() => {
                    if (!item.enabled) return;
                    onSettingsPanelChange(item.id as any);
                  }}
                  disabled={!item.enabled}
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
              <>
                <div className="settings-section-heading">
                  <h2>{t("settingsGeneral")}</h2>
                </div>

                <div className="settings-group-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("launchCommand")}</strong>
                      <span>{t("launchCommandHint")}</span>
                    </div>
                    <div className="settings-row-control">
                      <input
                        className="settings-inline-input"
                        value={settingsDraft.agentCommand}
                        onChange={(e) => onSettingsChange({ agentCommand: e.target.value })}
                        data-testid="settings-agent-command"
                      />
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("autoSuspendIdle")}</strong>
                      <span>{t("autoSuspendIdleHint")}</span>
                    </div>
                    <div className="settings-row-control">
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={settingsDraft.idlePolicy.enabled}
                          onChange={() => onSettingsIdlePolicyChange({ enabled: !settingsDraft.idlePolicy.enabled })}
                          data-testid="settings-idle-enabled"
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
                    <div className="settings-row-control">
                      <input
                        type="number"
                        className="settings-inline-input"
                        min={1}
                        value={settingsDraft.idlePolicy.idleMinutes}
                        onChange={(e) => onSettingsIdlePolicyChange({ idleMinutes: Number(e.target.value) })}
                        data-testid="settings-idle-minutes"
                      />
                      <span style={{ marginLeft: 8, color: "var(--text-secondary)" }}>{t("minutes")}</span>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("maxActiveSessions")}</strong>
                      <span>{t("maxActiveSessionsHint")}</span>
                    </div>
                    <div className="settings-row-control">
                      <input
                        type="number"
                        className="settings-inline-input"
                        min={1}
                        value={settingsDraft.idlePolicy.maxActive}
                        onChange={(e) => onSettingsIdlePolicyChange({ maxActive: Number(e.target.value) })}
                        data-testid="settings-max-active"
                      />
                      <span style={{ marginLeft: 8, color: "var(--text-secondary)" }}>{t("sessionsWord")}</span>
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
              </>
            ) : (
              <>
                <div className="settings-section-heading">
                  <h2>{t("settingsAppearance")}</h2>
                </div>

                <div className="settings-group-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>{t("theme")}</strong>
                      <span>{t("themeHint")}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-pill-select">
                        <button
                          type="button"
                          className={`settings-pill-option ${theme === "light" ? "active" : ""}`}
                          onClick={() => onThemeChange("light")}
                        >
                          {t("themeLight")}
                        </button>
                        <button
                          type="button"
                          className={`settings-pill-option ${theme === "dark" ? "active" : ""}`}
                          onClick={() => onThemeChange("dark")}
                        >
                          {t("themeDark")}
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
                          onClick={() => onLocaleChange("zh")}
                        >
                          中文
                        </button>
                        <button
                          type="button"
                          className={`settings-pill-option ${locale === "en" ? "active" : ""}`}
                          onClick={() => onLocaleChange("en")}
                        >
                          English
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
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
};

export default Settings;
