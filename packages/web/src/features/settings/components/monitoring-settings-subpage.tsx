import type { MonitoringMode, MonitoringSettings } from "@coder-studio/core";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui";
import { useViewport } from "../../../hooks/use-viewport";
import { useTranslation } from "../../../lib/i18n";
import type { UseMonitoringDataResult } from "../../monitoring";
import { MonitoringDashboard } from "../../monitoring";
import { MonitoringSettingsCard } from "./monitoring-settings-card";

interface MonitoringSettingsSubpageProps {
  readonly mode: MonitoringMode;
  readonly monitoringSettingsReady: boolean;
  readonly monitoringData: UseMonitoringDataResult;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly settings: MonitoringSettings;
}

export function MonitoringSettingsSubpage({
  mode,
  monitoringSettingsReady,
  monitoringData,
  onChange,
  settings,
}: MonitoringSettingsSubpageProps) {
  const t = useTranslation();
  const isMobile = useViewport() === "mobile";
  const shouldPrioritizeDock = isMobile && !settings.enabled;
  const [dockExpanded, setDockExpanded] = useState(!isMobile || !settings.enabled);
  const showMobileEntry = isMobile && settings.enabled && !dockExpanded;

  useEffect(() => {
    setDockExpanded(!isMobile || !settings.enabled);
  }, [isMobile, settings.enabled]);

  const stage = (
    <section className="settings-monitoring-stage" aria-label={t("monitoring.stage_label")}>
      <div className="settings-monitoring-stage__header">
        <div>
          <p className="settings-monitoring-stage__eyebrow">{t("monitoring.stage_eyebrow")}</p>
          <h3 className="settings-monitoring-stage__title">{t("monitoring.stage_title")}</h3>
          <p className="settings-monitoring-stage__summary">{t("monitoring.stage_summary")}</p>
        </div>
      </div>
      <MonitoringDashboard
        error={monitoringData.error}
        loading={monitoringData.loading}
        refresh={monitoringData.refresh}
        response={
          monitoringData.response
            ? {
                ...monitoringData.response,
                settings,
                snapshot: {
                  ...monitoringData.response.snapshot,
                  mode,
                },
              }
            : null
        }
      />
    </section>
  );

  const dockContent = (
    <MonitoringSettingsCard
      mode={mode}
      monitoringSettingsReady={monitoringSettingsReady}
      onChange={async (next) => {
        try {
          await onChange(next);
        } catch {
          return;
        }
      }}
      settings={settings}
      showHeaderChrome={false}
    />
  );

  const dockSurface = showMobileEntry ? (
    <button
      type="button"
      aria-label={t("monitoring.open_configuration")}
      className="settings-monitoring-mobile-entry"
      onClick={() => setDockExpanded(true)}
    >
      <div className="settings-monitoring-mobile-entry__header">
        <div className="settings-monitoring-mobile-entry__copy">
          <p className="settings-monitoring-mobile-entry__eyebrow">
            {t("monitoring.dock_eyebrow")}
          </p>
          <h3 className="settings-monitoring-mobile-entry__title">{t("monitoring.dock_title")}</h3>
        </div>
        <span className="settings-monitoring-mobile-entry__badge">{t("action.expand")}</span>
      </div>
      <p className="settings-monitoring-mobile-entry__summary">
        {t("monitoring.mobile_entry_summary")}
      </p>
      <span className="settings-monitoring-mobile-entry__action">
        {t("monitoring.open_configuration")}
      </span>
    </button>
  ) : (
    <aside className="settings-monitoring-dock" aria-label={t("monitoring.dock_label")}>
      <div className="settings-monitoring-dock__panel">
        <div className="settings-monitoring-dock__header">
          <div className="settings-monitoring-dock__copy">
            <p className="settings-monitoring-dock__eyebrow">{t("monitoring.dock_eyebrow")}</p>
            <h3 className="settings-monitoring-dock__title">{t("monitoring.dock_title")}</h3>
            <p className="settings-monitoring-dock__summary">
              {settings.enabled
                ? t("monitoring.dock_summary_enabled")
                : t("monitoring.dock_summary_disabled")}
            </p>
          </div>
          {isMobile && settings.enabled ? (
            <Button
              aria-expanded={dockExpanded ? "true" : "false"}
              aria-label={t("monitoring.toggle_settings")}
              className="settings-monitoring-dock-toggle"
              size="sm"
              variant="secondary"
              onClick={() => setDockExpanded((expanded) => !expanded)}
            >
              {dockExpanded ? t("action.collapse") : t("action.expand")}
            </Button>
          ) : null}
        </div>
        <div className="settings-monitoring-dock__body">{dockContent}</div>
      </div>
    </aside>
  );

  return (
    <div
      className={`settings-section settings-monitoring-shell ${
        isMobile ? "settings-monitoring-shell--mobile" : "settings-monitoring-shell--desktop"
      } ${shouldPrioritizeDock ? "settings-monitoring-shell--dock-priority" : ""}`}
    >
      {shouldPrioritizeDock ? dockSurface : stage}
      {shouldPrioritizeDock ? stage : dockSurface}
    </div>
  );
}
