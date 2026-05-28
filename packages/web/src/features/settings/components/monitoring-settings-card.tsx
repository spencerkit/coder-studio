import {
  MONITORING_SAMPLE_INTERVAL_OPTIONS,
  type MonitoringMode,
  type MonitoringSampleIntervalMs,
  type MonitoringSettings,
} from "@coder-studio/core";
import { type ReactNode, useId, useState } from "react";
import { Button, Notice, Pill, SegmentedControl, Switch } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { formatTimestamp } from "../../monitoring/formatters";

type MonitoringPreset = "light" | "standard" | "deep" | "custom";

interface MonitoringSettingsCardProps {
  readonly settings: MonitoringSettings;
  readonly mode: MonitoringMode;
  readonly monitoringSettingsReady: boolean;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly lastSampledAt?: number | null;
  readonly onRefresh?: () => Promise<void> | void;
  readonly refreshDisabled?: boolean;
  readonly headerActions?: ReactNode;
  readonly showHeaderChrome?: boolean;
}

function formatModeLabel(mode: MonitoringMode, t: ReturnType<typeof useTranslation>) {
  switch (mode) {
    case "disabled":
      return t("monitoring.mode_disabled");
    case "light":
      return t("monitoring.mode_light");
    case "standard":
      return t("monitoring.mode_standard");
    case "deep":
      return t("monitoring.mode_deep");
  }
}

function toPreset(settings: MonitoringSettings): MonitoringPreset {
  if (!settings.enabled) {
    return "custom";
  }

  if (
    settings.runtimeSummaryEnabled &&
    settings.workspaceAttributionEnabled &&
    settings.subprocessDrilldownEnabled
  ) {
    return "deep";
  }

  if (
    settings.runtimeSummaryEnabled &&
    settings.workspaceAttributionEnabled &&
    !settings.subprocessDrilldownEnabled
  ) {
    return "standard";
  }

  if (
    settings.runtimeSummaryEnabled &&
    !settings.workspaceAttributionEnabled &&
    !settings.subprocessDrilldownEnabled
  ) {
    return "light";
  }

  return "custom";
}

function normalizeSettings(settings: MonitoringSettings): MonitoringSettings {
  const next = { ...settings };

  if (!next.runtimeSummaryEnabled) {
    next.workspaceAttributionEnabled = false;
    next.subprocessDrilldownEnabled = false;
  }

  if (!next.workspaceAttributionEnabled) {
    next.subprocessDrilldownEnabled = false;
  }

  return next;
}

function capabilityDescription(
  key: "host" | "runtime" | "attribution" | "subprocess",
  t: ReturnType<typeof useTranslation>
) {
  switch (key) {
    case "host":
      return t("monitoring.host_metrics_hint");
    case "runtime":
      return t("monitoring.runtime_summary_hint");
    case "attribution":
      return t("monitoring.workspace_attribution_hint");
    case "subprocess":
      return t("monitoring.subprocess_drilldown_hint");
  }
}

export function MonitoringSettingsCard({
  settings,
  mode,
  monitoringSettingsReady,
  onChange,
  lastSampledAt = null,
  onRefresh,
  refreshDisabled = false,
  headerActions,
  showHeaderChrome = true,
}: MonitoringSettingsCardProps) {
  const t = useTranslation();
  const advancedPanelId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const resolvedSettings = normalizeSettings(settings);
  const controlsDisabled = !monitoringSettingsReady;
  const dependentControlsDisabled = controlsDisabled || !resolvedSettings.enabled;
  const signalSummary = resolvedSettings.enabled
    ? t("monitoring.signal_summary_enabled")
    : t("monitoring.signal_summary_disabled");
  const refreshLabel = `${t("action.refresh")} ${t("monitoring.command_label").toLowerCase()}`;

  const applyPreset = async (preset: MonitoringPreset) => {
    if (preset === "custom") {
      return;
    }

    const base: MonitoringSettings = {
      ...resolvedSettings,
      enabled: true,
      hostMetricsEnabled: true,
    };

    if (preset === "light") {
      await onChange(
        normalizeSettings({
          ...base,
          runtimeSummaryEnabled: true,
          workspaceAttributionEnabled: false,
          subprocessDrilldownEnabled: false,
        })
      );
      return;
    }

    if (preset === "standard") {
      await onChange(
        normalizeSettings({
          ...base,
          runtimeSummaryEnabled: true,
          workspaceAttributionEnabled: true,
          subprocessDrilldownEnabled: false,
        })
      );
      return;
    }

    await onChange(
      normalizeSettings({
        ...base,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
      })
    );
  };

  return (
    <section className="settings-card settings-card--monitoring" aria-label={t("monitoring.group")}>
      {showHeaderChrome ? (
        <div className="settings-card__header">
          <div>
            <h3 className="settings-group-title">{t("monitoring.group")}</h3>
            <p className="settings-group-desc">{t("monitoring.description")}</p>
          </div>
          <div className="settings-card__header-actions">
            <Pill disabled>{formatModeLabel(mode, t)}</Pill>
            {headerActions}
          </div>
        </div>
      ) : null}

      <div className="settings-monitoring-signal-bar">
        <div className="settings-monitoring-signal-bar__primary">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label">{t("monitoring.enable_monitoring")}</span>
            <span className="settings-toggle-desc">{t("monitoring.enable_monitoring_hint")}</span>
          </div>
          <Switch
            aria-label={t("monitoring.enable_monitoring")}
            checked={resolvedSettings.enabled}
            className="settings-toggle"
            disabled={controlsDisabled}
            onCheckedChange={(checked) => void onChange({ ...resolvedSettings, enabled: checked })}
          />
        </div>

        <div className="settings-monitoring-signal-bar__summary">
          <Pill disabled>{formatModeLabel(mode, t)}</Pill>
          <span>{signalSummary}</span>
          <span>
            {t("monitoring.last_updated")}: {formatTimestamp(lastSampledAt)}
          </span>
        </div>

        <div className="settings-monitoring-signal-bar__controls">
          <div className="settings-info-row monitoring-settings-row monitoring-settings-row--compact monitoring-settings-row--stacked">
            <span className="settings-info-label">{t("monitoring.preset")}</span>
            <SegmentedControl
              aria-disabled={controlsDisabled ? "true" : "false"}
              aria-label={t("monitoring.preset")}
              className="monitoring-settings-segmented-control"
              onChange={(value) => void applyPreset(value as MonitoringPreset)}
              options={[
                { value: "light", label: t("monitoring.mode_light"), disabled: controlsDisabled },
                {
                  value: "standard",
                  label: t("monitoring.mode_standard"),
                  disabled: controlsDisabled,
                },
                { value: "deep", label: t("monitoring.mode_deep"), disabled: controlsDisabled },
                { value: "custom", label: t("monitoring.mode_custom"), disabled: controlsDisabled },
              ]}
              size="sm"
              value={toPreset(resolvedSettings)}
            />
          </div>

          <div className="settings-info-row monitoring-settings-row monitoring-settings-row--compact monitoring-settings-row--stacked">
            <span className="settings-info-label">{t("monitoring.refresh_rate")}</span>
            <SegmentedControl
              aria-disabled={controlsDisabled ? "true" : "false"}
              aria-label={t("monitoring.refresh_rate")}
              className="monitoring-settings-segmented-control"
              onChange={(value) =>
                void onChange({
                  ...resolvedSettings,
                  sampleIntervalMs: Number(value) as MonitoringSampleIntervalMs,
                })
              }
              options={MONITORING_SAMPLE_INTERVAL_OPTIONS.map((interval) => ({
                value: String(interval),
                label: `${interval / 1000}s`,
                disabled: controlsDisabled,
              }))}
              size="sm"
              value={String(resolvedSettings.sampleIntervalMs)}
            />
          </div>

          <Button
            aria-label={refreshLabel}
            disabled={refreshDisabled}
            onClick={() => void onRefresh?.()}
            size="sm"
            variant="secondary"
          >
            {t("action.refresh")}
          </Button>
        </div>
      </div>

      {!resolvedSettings.enabled ? (
        <Notice
          message={t("monitoring.disabled_settings_hint")}
          title={t("monitoring.disabled_title")}
          tone="info"
        />
      ) : null}

      <div className="settings-monitoring-advanced-toggle-row">
        <Button
          aria-controls={advancedPanelId}
          aria-expanded={advancedOpen ? "true" : "false"}
          onClick={() => setAdvancedOpen((open) => !open)}
          size="sm"
          variant="ghost"
        >
          {advancedOpen
            ? t("monitoring.hide_advanced_capabilities")
            : t("monitoring.show_advanced_capabilities")}
        </Button>
      </div>

      <div className="settings-monitoring-advanced" hidden={!advancedOpen} id={advancedPanelId}>
        <div className="monitoring-settings-grid monitoring-settings-grid--capabilities">
          <div className="settings-monitoring-capability-card">
            <div className="settings-monitoring-capability-card__copy">
              <span className="settings-toggle-label">{t("monitoring.host_metrics")}</span>
              <span className="settings-toggle-desc">{capabilityDescription("host", t)}</span>
            </div>
            <Switch
              aria-label={t("monitoring.host_metrics")}
              checked={resolvedSettings.hostMetricsEnabled}
              className="settings-toggle"
              disabled={dependentControlsDisabled}
              onCheckedChange={(checked) =>
                void onChange(
                  normalizeSettings({ ...resolvedSettings, hostMetricsEnabled: checked })
                )
              }
            />
          </div>

          <div className="settings-monitoring-capability-card">
            <div className="settings-monitoring-capability-card__copy">
              <span className="settings-toggle-label">
                {t("monitoring.runtime_summary_setting")}
              </span>
              <span className="settings-toggle-desc">{capabilityDescription("runtime", t)}</span>
              <span className="settings-monitoring-capability-card__dependency">
                {t("monitoring.runtime_summary_dependency")}
              </span>
            </div>
            <Switch
              aria-label={t("monitoring.runtime_summary_setting")}
              checked={resolvedSettings.runtimeSummaryEnabled}
              className="settings-toggle"
              disabled={dependentControlsDisabled}
              onCheckedChange={(checked) =>
                void onChange(
                  normalizeSettings({
                    ...resolvedSettings,
                    runtimeSummaryEnabled: checked,
                    workspaceAttributionEnabled: checked
                      ? resolvedSettings.workspaceAttributionEnabled
                      : false,
                    subprocessDrilldownEnabled: checked
                      ? resolvedSettings.subprocessDrilldownEnabled
                      : false,
                  })
                )
              }
            />
          </div>

          <div className="settings-monitoring-capability-card">
            <div className="settings-monitoring-capability-card__copy">
              <span className="settings-toggle-label">{t("monitoring.workspace_attribution")}</span>
              <span className="settings-toggle-desc">
                {capabilityDescription("attribution", t)}
              </span>
            </div>
            <Switch
              aria-label={t("monitoring.workspace_attribution")}
              checked={resolvedSettings.workspaceAttributionEnabled}
              className="settings-toggle"
              disabled={dependentControlsDisabled}
              onCheckedChange={(checked) =>
                void onChange(
                  normalizeSettings({
                    ...resolvedSettings,
                    runtimeSummaryEnabled: checked ? true : resolvedSettings.runtimeSummaryEnabled,
                    workspaceAttributionEnabled: checked,
                    subprocessDrilldownEnabled: checked
                      ? resolvedSettings.subprocessDrilldownEnabled
                      : false,
                  })
                )
              }
            />
          </div>

          <div className="settings-monitoring-capability-card">
            <div className="settings-monitoring-capability-card__copy">
              <span className="settings-toggle-label">{t("monitoring.subprocess_drilldown")}</span>
              <span className="settings-toggle-desc">{capabilityDescription("subprocess", t)}</span>
            </div>
            <Switch
              aria-label={t("monitoring.subprocess_drilldown")}
              checked={resolvedSettings.subprocessDrilldownEnabled}
              className="settings-toggle"
              disabled={dependentControlsDisabled}
              onCheckedChange={(checked) =>
                void onChange(
                  normalizeSettings({
                    ...resolvedSettings,
                    runtimeSummaryEnabled: checked ? true : resolvedSettings.runtimeSummaryEnabled,
                    workspaceAttributionEnabled: checked
                      ? true
                      : resolvedSettings.workspaceAttributionEnabled,
                    subprocessDrilldownEnabled: checked,
                  })
                )
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
