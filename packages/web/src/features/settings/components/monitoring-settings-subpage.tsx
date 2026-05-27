import {
  createEmptyMonitoringResponse,
  type MonitoringMode,
  type MonitoringSettings,
} from "@coder-studio/core";
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

  const stageResponse = monitoringData.response
    ? settings.enabled && !monitoringData.response.settings.enabled
      ? {
          // If the optimistic settings update succeeded but recheck failed, render an
          // enabled-yet-waiting stage instead of mixing new settings with a stale disabled sample.
          ...createEmptyMonitoringResponse(settings),
          capabilities: monitoringData.response.capabilities,
          telemetry: monitoringData.response.telemetry,
        }
      : {
          ...monitoringData.response,
          settings,
          snapshot: {
            ...monitoringData.response.snapshot,
            mode,
          },
        }
    : null;

  return (
    <section
      className={`settings-section settings-monitoring-shell ${
        isMobile ? "settings-monitoring-shell--mobile" : "settings-monitoring-shell--desktop"
      }`}
      aria-label={t("monitoring.mobile_section")}
    >
      <div className="settings-monitoring-control-bar">
        <div className="settings-monitoring-control-bar__copy">
          <p className="settings-monitoring-control-bar__eyebrow">
            {t("monitoring.stage_eyebrow")}
          </p>
          <p className="settings-monitoring-control-bar__summary">
            {t("monitoring.stage_summary")}
          </p>
        </div>
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
      </div>

      <div className="settings-monitoring-dashboard-stage">
        <MonitoringDashboard
          error={monitoringData.error}
          loading={monitoringData.loading}
          refresh={monitoringData.refresh}
          response={stageResponse}
        />
      </div>
    </section>
  );
}
