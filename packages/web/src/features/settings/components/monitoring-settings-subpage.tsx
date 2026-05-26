import type { MonitoringMode, MonitoringSettings } from "@coder-studio/core";
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
  return (
    <div className="settings-section">
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
      />
      <MonitoringDashboard
        error={monitoringData.error}
        loading={monitoringData.loading}
        refresh={monitoringData.refresh}
        response={monitoringData.response}
      />
    </div>
  );
}
