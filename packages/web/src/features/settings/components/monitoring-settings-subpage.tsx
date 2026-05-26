import type { MonitoringMode, MonitoringSettings } from "@coder-studio/core";
import { MonitoringDashboard, useMonitoringData } from "../../monitoring";
import { MonitoringSettingsCard } from "./monitoring-settings-card";

interface MonitoringSettingsSubpageProps {
  readonly mode: MonitoringMode;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly settings: MonitoringSettings;
}

export function MonitoringSettingsSubpage({
  mode,
  onChange,
  settings,
}: MonitoringSettingsSubpageProps) {
  const monitoringData = useMonitoringData();

  return (
    <div className="settings-section">
      <MonitoringSettingsCard
        mode={mode}
        onChange={async (next) => {
          try {
            await onChange(next);
          } catch {
            return;
          }

          await monitoringData.refresh();
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
