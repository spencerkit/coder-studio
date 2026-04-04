import type { ReactNode } from "react";
import type { Locale, Translator } from "../../i18n";
import type { AppSettings, AppSettingsUpdater, SettingsPanel } from "../../types/app";
import {
  BUILTIN_PROVIDER_MANIFESTS,
  getProviderPanelId,
} from "../../features/providers/registry";
import { readAppBuildMetadata } from "../../shared/app/build-metadata";
import { getSettingsLocale } from "../../shared/app/app-settings";
import { SettingsAppearanceIcon, SettingsConfigIcon, SettingsGeneralIcon } from "../icons";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel";

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

type SettingsSectionProps = {
  kicker: string;
  title: string;
  description?: string;
  testId?: string;
  children: ReactNode;
};

const SettingsSection = ({ kicker, title, description, testId, children }: SettingsSectionProps) => (
  <section className="settings-section-slab" data-testid={testId}>
    <header className="settings-section-header">
      <span className="settings-section-kicker">{kicker}</span>
      <div className="settings-section-copy settings-row-copy">
        <h2 className="settings-section-title">{title}</h2>
        {description ? <p className="settings-section-description">{description}</p> : null}
      </div>
    </header>
    <div className="settings-section-body">
      {children}
    </div>
  </section>
);

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

const resolvePanelMeta = (
  activeSettingsPanel: SettingsPanel,
  activeProviderId: string | null,
  t: Translator,
) => {
  if (activeSettingsPanel === "general") {
    return {
      kicker: t("settingsGeneralKicker"),
      title: t("settingsGeneral"),
      description: t("settingsDescription"),
    };
  }

  if (activeSettingsPanel === "appearance") {
    return {
      kicker: t("settingsAppearanceKicker"),
      title: t("settingsAppearance"),
      description: t("settingsAppearanceHint"),
    };
  }

  const providerId = activeProviderId ?? "";
  const manifest = BUILTIN_PROVIDER_MANIFESTS.find((entry) => entry.id === providerId);

  return {
    kicker: t("settingsProviderKicker"),
    title: manifest ? t(manifest.settingsTitleKey) : providerId,
    description: manifest ? t(manifest.settingsHintKey) : t("providerUnknownHint", { provider: providerId }),
    summary: manifest ? manifest.badgeLabel : providerId,
    summaryCopy: t("settingsProviderSummaryHint"),
  };
};

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
  const selectedLocale = getSettingsLocale(settingsDraft);
  const activeProviderId = getActiveProviderId(activeSettingsPanel);
  const buildMetadata = readAppBuildMetadata();
  const panelMeta = resolvePanelMeta(activeSettingsPanel, activeProviderId, t);

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
              <div className="settings-panel-header settings-group-card settings-group-card--document" data-testid="settings-panel-header">
                <span className="settings-panel-kicker" data-testid="settings-panel-kicker">
                  {panelMeta.kicker}
                </span>
                <div className="settings-panel-heading settings-row-copy">
                  <h1 className="settings-panel-title" data-testid="settings-panel-title">
                    {panelMeta.title}
                  </h1>
                  <p className="settings-panel-intro" data-testid="settings-panel-intro">
                    {panelMeta.description}
                  </p>
                </div>
                {panelMeta.summary ? (
                  <div className="settings-panel-summary settings-page-status" data-testid="settings-panel-summary">
                    <span className="settings-panel-summary-badge">{panelMeta.summary}</span>
                    <span className="settings-panel-summary-copy">{panelMeta.summaryCopy}</span>
                  </div>
                ) : null}
              </div>
              {activeSettingsPanel === "general" ? (
                <>
                  <SettingsSection
                    kicker={t("settingsGeneralKicker")}
                    title={t("agentDefaults")}
                    description={t("agentDefaultsHint")}
                    testId="settings-section-agent-defaults"
                  >
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
                    </div>
                  </SettingsSection>

                  <SettingsSection
                    kicker={t("settingsGeneralKicker")}
                    title={t("suspendStrategy")}
                    description={t("suspendStrategyHint")}
                    testId="settings-section-suspend-strategy"
                  >
                    <div className="settings-group-card settings-group-card--document">
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
                  </SettingsSection>

                  <SettingsSection
                    kicker={t("settingsGeneralKicker")}
                    title={t("completionNotifications")}
                    description={t("completionNotificationsHint")}
                    testId="settings-section-notifications"
                  >
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
                  </SettingsSection>
                </>
              ) : activeSettingsPanel.startsWith("provider:") ? (
                <ProviderSettingsPanel
                  providerId={activeProviderId ?? ""}
                  settings={settingsDraft}
                  onChange={onProviderSettingsChange}
                  t={t}
                />
              ) : (
                <SettingsSection
                  kicker={t("settingsAppearanceKicker")}
                  title={t("settingsAppearance")}
                  description={t("settingsAppearanceHint")}
                  testId="settings-section-appearance"
                >
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
                </SettingsSection>
              )}
            </div>
          </div>

          <div className="settings-footer-bar">
            <div className="settings-page-status">
              {t("settingsAutoSave")}
            </div>
            <div className="settings-page-meta">
              <div className="settings-build-meta">
                <span className="settings-build-meta-label">{t("buildVersionLabel")}</span>
                <span className="settings-build-meta-value" data-testid="settings-build-version">
                  {buildMetadata.version}
                </span>
              </div>
              <div className="settings-build-meta">
                <span className="settings-build-meta-label">{t("buildPublishedLabel")}</span>
                <span className="settings-build-meta-value" data-testid="settings-build-published-at">
                  {buildMetadata.publishedAtDisplay}
                </span>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
};

export default Settings;
