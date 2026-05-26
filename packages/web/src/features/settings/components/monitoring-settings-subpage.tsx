import type { MonitoringMode, MonitoringSettings } from "@coder-studio/core";
import { useMemo } from "react";
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
  const response = useMemo(() => {
    if (!monitoringData.response) {
      return null;
    }

    return {
      ...monitoringData.response,
      settings,
      snapshot: {
        ...monitoringData.response.snapshot,
        mode,
      },
    };
  }, [mode, monitoringData.response, settings]);

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
        response={response}
      />
    </div>
  );
}
