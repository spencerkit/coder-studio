import {
  createEmptyMonitoringResponse,
  type MonitoringMode,
  type MonitoringSettings,
} from "@coder-studio/core";
import { useState } from "react";
import { Switch } from "../../../components/ui";
import { useViewport } from "../../../hooks/use-viewport";
import { useTranslation } from "../../../lib/i18n";
import type { UseMonitoringDataResult } from "../../monitoring";
import { MonitoringDashboard, type TimeWindow } from "../../monitoring";
import {
  formatBytes,
  formatLoadAverage,
  formatPercent,
  formatTimestamp,
  formatUptime,
} from "../../monitoring/formatters";
import { formatModeLabel, MonitoringSettingsCard } from "./monitoring-settings-card";

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
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("15m");

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
  const hostSnapshot = stageResponse?.snapshot.host ?? null;
  const runtimeSnapshot = stageResponse?.snapshot.runtime ?? null;
  const entityCount =
    (stageResponse?.snapshot.workspaces.length ?? 0) +
    (stageResponse?.snapshot.sessions.length ?? 0) +
    (stageResponse?.snapshot.subprocessGroups.length ?? 0);
  const statusLabel =
    settings.enabled && !monitoringData.error && !stageResponse?.telemetry?.degraded
      ? t("monitoring.status_stable")
      : settings.enabled
        ? t("monitoring.status_attention")
        : t("monitoring.mode_disabled");
  const statusSummary = settings.enabled
    ? t("monitoring.signal_summary_enabled")
    : t("monitoring.signal_summary_disabled");
  const hostPressureSummary = hostSnapshot
    ? `${t("monitoring.host_pressure")} ${hostSnapshot.pressure ? t(`monitoring.pressure_${hostSnapshot.pressure}`) : t("monitoring.pressure_unknown")}`
    : t("monitoring.kpi_disabled_meta");
  const managedProcessCount = runtimeSnapshot?.managedProcessCount ?? 0;
  const kpis = [
    {
      key: "available-memory",
      label: t("monitoring.available_memory"),
      value: formatBytes(hostSnapshot?.memoryAvailableBytes ?? null),
      meta: formatLoadAverage(hostSnapshot?.loadAverage ?? null),
    },
    {
      key: "managed-share",
      label: t("monitoring.kpi_managed_cpu_share"),
      value: formatPercent(runtimeSnapshot?.cpuShareOfHostPercent ?? null),
      meta:
        managedProcessCount > 0
          ? `${managedProcessCount} ${t("monitoring.kpi_managed_process_suffix")}`
          : t("monitoring.kpi_managed_share_idle"),
    },
    {
      key: "conclusion",
      label: t("monitoring.kpi_conclusion"),
      value: statusLabel,
      meta: settings.enabled
        ? t("monitoring.kpi_conclusion_meta")
        : t("monitoring.kpi_disabled_meta"),
    },
  ];
  const heroActions = [
    {
      key: "host-cpu",
      label: t("monitoring.cpu"),
      value: formatPercent(hostSnapshot?.cpuPercent ?? null),
    },
    {
      key: "managed-memory",
      label: t("monitoring.managed_memory"),
      value: formatBytes(runtimeSnapshot?.totalManagedMemoryBytes ?? null),
    },
    {
      key: "sample-rate",
      label: t("monitoring.refresh_rate"),
      value: `${settings.sampleIntervalMs / 1000}s`,
    },
  ];

  return (
    <section
      className={`settings-section settings-monitoring-shell ${
        isMobile ? "settings-monitoring-shell--mobile" : "settings-monitoring-shell--desktop"
      }`}
      aria-label={t("monitoring.mobile_section")}
    >
      <div className="settings-monitoring-hero settings-monitoring-control-bar">
        <div className="settings-monitoring-control-bar__copy settings-monitoring-hero__headline">
          <p className="settings-monitoring-control-bar__eyebrow settings-monitoring-hero__eyebrow">
            {t("monitoring.stage_eyebrow")}
          </p>
          <h2 className="settings-monitoring-hero__title">{t("monitoring.title")}</h2>
          <p className="settings-monitoring-control-bar__summary settings-monitoring-hero__summary">
            {t("monitoring.hero_summary")}
          </p>
          <div className="settings-monitoring-hero__meta">
            <span className="settings-monitoring-soft-chip">
              <span className="settings-monitoring-soft-chip__dot" />
              {formatModeLabel(mode, t)}
            </span>
            <span className="settings-monitoring-pill">
              {t("monitoring.last_updated")}{" "}
              {formatTimestamp(stageResponse?.snapshot.sampledAt ?? null)}
            </span>
            <span className="settings-monitoring-pill">{hostPressureSummary}</span>
            <span className="settings-monitoring-pill">
              {managedProcessCount} {t("monitoring.kpi_managed_process_suffix")}
            </span>
          </div>
        </div>

        <div className="settings-monitoring-hero__side">
          <aside
            className="settings-monitoring-status-card"
            aria-label={t("monitoring.status_card")}
          >
            <p className="settings-monitoring-status-card__label">{t("monitoring.status_card")}</p>
            <h3 className="settings-monitoring-status-card__title">{statusLabel}</h3>
            <p className="settings-monitoring-status-card__summary">{statusSummary}</p>
            <div className="settings-monitoring-status-card__health">
              <span className="settings-monitoring-pill">{t("monitoring.health_chip")}</span>
            </div>
            <div className="settings-monitoring-status-card__toggle">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label">{t("monitoring.enable_monitoring")}</span>
                <span className="settings-toggle-desc">
                  {t("monitoring.enable_monitoring_hint")}
                </span>
              </div>
              <Switch
                aria-label={t("monitoring.enable_monitoring")}
                checked={settings.enabled}
                className="settings-toggle"
                disabled={!monitoringSettingsReady}
                onCheckedChange={(checked) =>
                  void (async () => {
                    try {
                      await onChange({ ...settings, enabled: checked });
                    } catch {
                      return;
                    }
                  })()
                }
              />
            </div>
          </aside>

          <div className="settings-monitoring-hero-actions" aria-label={t("monitoring.kpi_group")}>
            {heroActions.map((action) => (
              <article className="settings-monitoring-hero-action" key={action.key}>
                <p className="settings-monitoring-hero-action__label">{action.label}</p>
                <strong className="settings-monitoring-hero-action__value">{action.value}</strong>
              </article>
            ))}
          </div>
        </div>
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
        onRefresh={monitoringData.refresh}
        refreshDisabled={monitoringData.loading}
        settings={settings}
        showHeaderChrome={false}
        timeWindow={timeWindow}
        onTimeWindowChange={setTimeWindow}
      />

      <div className="settings-monitoring-kpi-grid" aria-label={t("monitoring.kpi_group")}>
        {kpis.map((kpi) => (
          <article className="settings-monitoring-kpi-card" key={kpi.key}>
            <p className="settings-monitoring-kpi-card__label">{kpi.label}</p>
            <strong className="settings-monitoring-kpi-card__value">{kpi.value}</strong>
            <p className="settings-monitoring-kpi-card__meta">{kpi.meta}</p>
          </article>
        ))}
      </div>

      <div className="settings-monitoring-dashboard-stage">
        <MonitoringDashboard
          error={monitoringData.error}
          loading={monitoringData.loading}
          refresh={monitoringData.refresh}
          response={stageResponse}
          showRefreshControls={false}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
        />
      </div>
    </section>
  );
}
