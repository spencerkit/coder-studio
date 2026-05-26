import type { MonitoringMode, MonitoringSettings } from "@coder-studio/core";
import { MonitoringContent } from "../../monitoring";
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
  return (
    <div className="settings-section">
      <MonitoringSettingsCard mode={mode} onChange={onChange} settings={settings} />
      <MonitoringContent />
    </div>
  );
}
