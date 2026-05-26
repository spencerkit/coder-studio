import type {
  MonitoringEntitySummary,
  MonitoringHistoryBundle,
  MonitoringMode,
  MonitoringPressure,
  MonitoringResponse,
  MonitoringSeriesBundle,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { Button, Notice, SegmentedControl, Tag } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import {
  formatBytes,
  formatLoadAverage,
  formatPercent,
  formatRefreshInterval,
  formatTimestamp,
  formatUptime,
} from "./formatters";
import { Sparkline } from "./sparkline";

type SortMode = "cpu" | "memory";
type TimeWindow = "5m" | "15m" | "30m";
type MonitoringViewStatus = "loading" | "disabled" | "ready" | "degraded" | "waiting" | "empty";
export type MonitoringDashboardProps = UseMonitoringDataResult & {
  onOpenSettings?: () => void;
};

export type UseMonitoringDataResult = {
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  response: MonitoringResponse | null;
};

const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
};

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="monitoring-metric">
      <span className="monitoring-metric__label">{label}</span>
      <strong className="monitoring-metric__value">{value}</strong>
    </div>
  );
}

function filterHistoryWindow(
  bundle: MonitoringSeriesBundle | null | undefined,
  sampledAt: number,
  timeWindow: TimeWindow
): MonitoringSeriesBundle | null {
  if (!bundle) {
    return null;
  }

  const minSampledAt = sampledAt - TIME_WINDOW_MS[timeWindow];
  return {
    points: bundle.points.filter((point) => point.sampledAt >= minSampledAt),
  };
}

function HistorySparkline({
  bundle,
  metric,
  sampledAt,
  timeWindow,
}: {
  bundle: MonitoringSeriesBundle | null | undefined;
  metric: "cpuPercent" | "memoryBytes";
  sampledAt: number;
  timeWindow: TimeWindow;
}) {
  const filteredBundle = filterHistoryWindow(bundle, sampledAt, timeWindow);

  if (!filteredBundle) {
    return null;
  }

  return (
    <div className="monitoring-history-strip">
      <Sparkline metric={metric} points={filteredBundle.points} />
    </div>
  );
}

function sortEntities(entities: MonitoringEntitySummary[], mode: SortMode) {
  return [...entities].sort((left, right) => {
    const leftValue = mode === "cpu" ? (left.cpuPercent ?? -1) : (left.memoryBytes ?? -1);
    const rightValue = mode === "cpu" ? (right.cpuPercent ?? -1) : (right.memoryBytes ?? -1);
    return rightValue - leftValue;
  });
}

function entityHistory(
  history: MonitoringHistoryBundle,
  entity: MonitoringEntitySummary
): MonitoringSeriesBundle | null {
  if (entity.kind === "workspace") {
    return history.workspaces[entity.id] ?? null;
  }
  if (entity.kind === "session") {
    return history.sessions[entity.id] ?? null;
  }
  if (entity.kind === "subprocess_group") {
    return history.subprocessGroups[entity.id] ?? null;
  }
  return null;
}

function entityDetailRows(entity: MonitoringEntitySummary, t: ReturnType<typeof useTranslation>) {
  return [
    { label: t("monitoring.cpu"), value: formatPercent(entity.cpuPercent) },
    { label: t("monitoring.memory"), value: formatBytes(entity.memoryBytes) },
    { label: t("monitoring.process_count"), value: String(entity.processCount) },
    { label: t("monitoring.uptime"), value: formatUptime(entity.uptimeSec) },
  ];
}

function formatMonitoringMode(mode: MonitoringMode, t: ReturnType<typeof useTranslation>) {
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

function formatPressureLabel(pressure: MonitoringPressure, t: ReturnType<typeof useTranslation>) {
  switch (pressure) {
    case "normal":
      return t("monitoring.pressure_normal");
    case "elevated":
      return t("monitoring.pressure_elevated");
    case "hot":
      return t("monitoring.pressure_hot");
    case "unknown":
    default:
      return t("monitoring.pressure_unknown");
  }
}

function EntityList({
  entities,
  selectedEntityId,
  onSelect,
  history,
  sampledAt,
  timeWindow,
}: {
  entities: MonitoringEntitySummary[];
  selectedEntityId: string | null;
  onSelect: (entity: MonitoringEntitySummary) => void;
  history: MonitoringHistoryBundle;
  sampledAt: number;
  timeWindow: TimeWindow;
}) {
  return (
    <div className="monitoring-process-list">
      {entities.map((entity) => (
        <button
          key={entity.id}
          type="button"
          aria-label={`${entity.label} ${formatPercent(entity.cpuPercent)} / ${formatBytes(
            entity.memoryBytes
          )}`}
          className={`monitoring-entity-row ${entity.kind === "session" || entity.kind === "subprocess_group" ? "monitoring-entity-row--child" : ""} ${
            selectedEntityId === entity.id ? "monitoring-entity-row--selected" : ""
          }`}
          onClick={() => onSelect(entity)}
        >
          <div className="monitoring-entity-row__copy">
            <strong>{entity.label}</strong>
            <span>
              {formatPercent(entity.cpuPercent)} / {formatBytes(entity.memoryBytes)}
            </span>
          </div>
          <HistorySparkline
            bundle={entityHistory(history, entity)}
            metric="cpuPercent"
            sampledAt={sampledAt}
            timeWindow={timeWindow}
          />
        </button>
      ))}
    </div>
  );
}

export function useMonitoringData(): UseMonitoringDataResult {
  const t = useTranslation();
  const wsClient = useAtomValue(wsClientAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const [response, setResponse] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionCounterRef = useRef(0);
  const latestIssuedRequestRef = useRef(0);
  const latestAppliedWriteRef = useRef(0);

  const issueRequestVersion = () => {
    const nextVersion = versionCounterRef.current + 1;
    versionCounterRef.current = nextVersion;
    latestIssuedRequestRef.current = nextVersion;
    return nextVersion;
  };

  const commitRequestWrite = (version: number, apply: () => void) => {
    if (version !== latestIssuedRequestRef.current || version <= latestAppliedWriteRef.current) {
      return false;
    }

    latestAppliedWriteRef.current = version;
    apply();
    return true;
  };

  useEffect(() => {
    if (!wsClient || connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const load = async () => {
      const requestVersion = issueRequestVersion();
      setLoading(true);
      setError(null);

      try {
        const next = await wsClient.sendCommand<MonitoringResponse>(
          "monitoring.get",
          {},
          undefined
        );
        if (!cancelled) {
          commitRequestWrite(requestVersion, () => {
            setResponse(next);
            setError(null);
            setLoading(false);
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          commitRequestWrite(requestVersion, () => {
            setError(loadError instanceof Error ? loadError.message : t("monitoring.load_failed"));
            setLoading(false);
          });
        }
      }
    };

    void load();
    const unsubscribe = wsClient.subscribe(
      [Topics.monitoringSnapshotUpdated],
      (_topic, payload) => {
        const nextVersion = versionCounterRef.current + 1;
        versionCounterRef.current = nextVersion;
        latestAppliedWriteRef.current = nextVersion;
        setResponse(payload as MonitoringResponse);
        setLoading(false);
        setError(null);
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connectionStatus, t, wsClient]);

  const refresh = async () => {
    if (!wsClient) {
      return;
    }

    const requestVersion = issueRequestVersion();

    try {
      setError(null);
      const next = await wsClient.sendCommand<MonitoringResponse>(
        "monitoring.recheck",
        {},
        undefined
      );
      commitRequestWrite(requestVersion, () => {
        setResponse(next);
        setError(null);
        setLoading(false);
      });
    } catch (refreshError) {
      commitRequestWrite(requestVersion, () => {
        setError(
          refreshError instanceof Error ? refreshError.message : t("monitoring.refresh_failed")
        );
        setLoading(false);
      });
    }
  };

  return { error, loading, refresh, response };
}

export function MonitoringDashboard({
  error,
  loading,
  onOpenSettings,
  refresh: onRefresh,
  response,
}: MonitoringDashboardProps) {
  const t = useTranslation();
  const isMobile = useViewport() === "mobile";
  const [sortMode, setSortMode] = useState<SortMode>("cpu");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("15m");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const attributionEntities = useMemo(() => {
    if (!response) {
      return [];
    }

    return sortEntities([...response.snapshot.workspaces, ...response.snapshot.sessions], sortMode);
  }, [response, sortMode]);

  const processEntities = useMemo(() => {
    if (!response) {
      return [];
    }

    return sortEntities(response.snapshot.subprocessGroups, sortMode);
  }, [response, sortMode]);

  const selectedEntity = useMemo(() => {
    if (!response) {
      return null;
    }

    return (
      [
        ...response.snapshot.workspaces,
        ...response.snapshot.sessions,
        ...response.snapshot.subprocessGroups,
      ].find((entity) => entity.id === selectedEntityId) ?? null
    );
  }, [response, selectedEntityId]);

  const runtimeStatus = useMemo<MonitoringViewStatus>(() => {
    if (!response) {
      return "loading";
    }
    if (!response.settings.runtimeSummaryEnabled) {
      return "disabled";
    }
    if (response.snapshot.runtime) {
      return "ready";
    }
    if (response.telemetry?.degraded) {
      return "degraded";
    }
    return "waiting";
  }, [response]);

  const attributionStatus = useMemo<MonitoringViewStatus>(() => {
    if (!response) {
      return "loading";
    }
    if (!response.settings.workspaceAttributionEnabled) {
      return "disabled";
    }
    if (attributionEntities.length > 0) {
      return "ready";
    }
    if (runtimeStatus === "degraded") {
      return "degraded";
    }
    if (runtimeStatus === "waiting") {
      return "waiting";
    }
    return "empty";
  }, [attributionEntities.length, response, runtimeStatus]);

  const processStatus = useMemo<MonitoringViewStatus>(() => {
    if (!response) {
      return "loading";
    }
    if (!response.settings.subprocessDrilldownEnabled) {
      return "disabled";
    }
    if (processEntities.length > 0) {
      return "ready";
    }
    if (runtimeStatus === "degraded") {
      return "degraded";
    }
    if (runtimeStatus === "waiting") {
      return "waiting";
    }
    return "empty";
  }, [processEntities.length, response, runtimeStatus]);

  const refreshButton = (
    <Button
      aria-label={`${t("action.refresh")} ${t("monitoring.command_label").toLowerCase()}`}
      size={isMobile ? "sm" : undefined}
      variant={isMobile ? "ghost" : "secondary"}
      onClick={() => void onRefresh()}
    >
      {t("action.refresh")}
    </Button>
  );

  const toolbarSummary = response ? (
    <div className="monitoring-card">
      <div className="monitoring-card__header">
        <strong>{formatRefreshInterval(response.settings.sampleIntervalMs)}</strong>
        <Tag color="neutral" caps={false}>
          {formatMonitoringMode(response.snapshot.mode, t)}
        </Tag>
      </div>
      <MetricRow
        label={t("monitoring.last_updated")}
        value={formatTimestamp(response.snapshot.sampledAt)}
      />
      <SegmentedControl
        aria-label={t("monitoring.time_window")}
        size="sm"
        value={timeWindow}
        onChange={(value) => setTimeWindow(value as TimeWindow)}
        options={[
          { value: "5m", label: "5m" },
          { value: "15m", label: "15m" },
          { value: "30m", label: "30m" },
        ]}
      />
    </div>
  ) : null;

  const primaryState =
    loading || (error && !response) ? (
      <Notice
        title={loading ? t("monitoring.title") : t("monitoring.load_failed")}
        message={loading ? t("monitoring.loading") : (error ?? t("monitoring.load_failed"))}
        tone={loading ? "info" : "error"}
      />
    ) : null;

  const disabledState =
    response && !response.settings.enabled ? (
      <div className="monitoring-card monitoring-card--empty">
        <h2>{t("monitoring.disabled_title")}</h2>
        <p>{t("monitoring.disabled_description")}</p>
        {onOpenSettings ? (
          <div className="settings-actions-row">
            <Button variant="secondary" onClick={onOpenSettings}>
              {t("monitoring.open_settings")}
            </Button>
          </div>
        ) : null}
      </div>
    ) : null;

  const overviewSection =
    response && response.settings.enabled ? (
      <section className="monitoring-overview-grid">
        <div className="monitoring-card">
          <div className="monitoring-card__header">
            <h2>{t("monitoring.host_overview")}</h2>
            <Tag color="neutral" caps={false}>
              {formatPressureLabel(response.snapshot.host?.pressure ?? "unknown", t)}
            </Tag>
          </div>
          <MetricRow
            label={t("monitoring.cpu")}
            value={formatPercent(response.snapshot.host?.cpuPercent ?? null)}
          />
          <MetricRow
            label={t("monitoring.memory")}
            value={formatBytes(response.snapshot.host?.memoryUsedBytes ?? null)}
          />
          <MetricRow
            label={t("monitoring.available_memory")}
            value={formatBytes(response.snapshot.host?.memoryAvailableBytes ?? null)}
          />
          <MetricRow
            label={t("monitoring.load_average")}
            value={formatLoadAverage(response.snapshot.host?.loadAverage ?? null)}
          />
          <MetricRow
            label={t("monitoring.uptime")}
            value={formatUptime(response.snapshot.host?.uptimeSec ?? null)}
          />
          {response.snapshot.host ? (
            <HistorySparkline
              bundle={response.history.host}
              metric="cpuPercent"
              sampledAt={response.snapshot.sampledAt}
              timeWindow={timeWindow}
            />
          ) : null}
        </div>

        <div className="monitoring-card">
          <div className="monitoring-card__header">
            <h2>{t("monitoring.runtime_summary_title")}</h2>
            <Tag color="neutral" caps={false}>
              {formatMonitoringMode(response.snapshot.mode, t)}
            </Tag>
          </div>
          {runtimeStatus === "ready" && response.snapshot.runtime ? (
            <>
              <MetricRow
                label={t("monitoring.server_cpu")}
                value={formatPercent(response.snapshot.runtime.serverCpuPercent)}
              />
              <MetricRow
                label={t("monitoring.server_memory")}
                value={formatBytes(response.snapshot.runtime.serverMemoryBytes)}
              />
              <MetricRow
                label={t("monitoring.managed_cpu")}
                value={formatPercent(response.snapshot.runtime.totalManagedCpuPercent)}
              />
              <MetricRow
                label={t("monitoring.managed_memory")}
                value={formatBytes(response.snapshot.runtime.totalManagedMemoryBytes)}
              />
              <MetricRow
                label={t("monitoring.process_count")}
                value={String(response.snapshot.runtime.managedProcessCount)}
              />
              <HistorySparkline
                bundle={response.history.runtime}
                metric="cpuPercent"
                sampledAt={response.snapshot.sampledAt}
                timeWindow={timeWindow}
              />
            </>
          ) : runtimeStatus === "degraded" ? (
            <Notice
              title={t("monitoring.process_collection_degraded")}
              message={t("monitoring.process_collection_unavailable")}
              tone="warning"
            />
          ) : runtimeStatus === "waiting" ? (
            <Notice
              title={t("monitoring.runtime_summary_pending")}
              message={t("monitoring.runtime_summary_pending_description")}
              tone="info"
            />
          ) : (
            <Notice
              title={t("monitoring.runtime_summary_disabled")}
              message={t("monitoring.enable_runtime_summary")}
              tone="info"
            />
          )}
        </div>
      </section>
    ) : null;

  const attributionSection =
    response && response.settings.enabled ? (
      <section className="monitoring-attribution">
        <div className="monitoring-tree">
          <div className="monitoring-card__header">
            <h2>{t("monitoring.attribution_tree")}</h2>
            <SegmentedControl
              aria-label={t("monitoring.sort_by")}
              size="sm"
              value={sortMode}
              onChange={(value) => setSortMode(value as SortMode)}
              options={[
                { value: "cpu", label: t("monitoring.cpu") },
                { value: "memory", label: t("monitoring.memory") },
              ]}
            />
          </div>
          {attributionStatus === "disabled" ? (
            <Notice
              title={t("monitoring.attribution_disabled")}
              message={t("monitoring.enable_attribution")}
              tone="info"
            />
          ) : attributionStatus === "ready" ? (
            <EntityList
              entities={attributionEntities}
              selectedEntityId={selectedEntityId}
              onSelect={(entity) => setSelectedEntityId(entity.id)}
              history={response.history}
              sampledAt={response.snapshot.sampledAt}
              timeWindow={timeWindow}
            />
          ) : attributionStatus === "degraded" ? (
            <Notice
              title={t("monitoring.process_collection_degraded")}
              message={t("monitoring.process_collection_unavailable")}
              tone="warning"
            />
          ) : attributionStatus === "waiting" ? (
            <Notice
              title={t("monitoring.runtime_summary_pending")}
              message={t("monitoring.runtime_summary_pending_description")}
              tone="info"
            />
          ) : (
            <Notice
              title={t("monitoring.attribution_empty")}
              message={t("monitoring.attribution_empty_description")}
              tone="info"
            />
          )}
        </div>

        {!isMobile ? (
          <div className="monitoring-detail">
            <div className="monitoring-card__header">
              <h2>{t("monitoring.detail_panel")}</h2>
              {selectedEntity ? (
                <Tag color="neutral" caps={false}>
                  {selectedEntity.kind}
                </Tag>
              ) : null}
            </div>
            <p>{t("monitoring.select_entity")}</p>
            {selectedEntity ? (
              <>
                <h3>{selectedEntity.label}</h3>
                {entityDetailRows(selectedEntity, t).map((row) => (
                  <MetricRow key={row.label} label={row.label} value={row.value} />
                ))}
                <HistorySparkline
                  bundle={entityHistory(response.history, selectedEntity)}
                  metric="cpuPercent"
                  sampledAt={response.snapshot.sampledAt}
                  timeWindow={timeWindow}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    ) : null;

  const processSection =
    response && response.settings.enabled ? (
      <section className="monitoring-tree">
        <div className="monitoring-card__header">
          <h2>{t("monitoring.subprocess_drilldown")}</h2>
        </div>
        {processStatus === "disabled" ? (
          <Notice
            title={t("monitoring.subprocess_disabled")}
            message={t("monitoring.enable_subprocess")}
            tone="info"
          />
        ) : processStatus === "ready" ? (
          <EntityList
            entities={processEntities}
            selectedEntityId={selectedEntityId}
            onSelect={(entity) => setSelectedEntityId(entity.id)}
            history={response.history}
            sampledAt={response.snapshot.sampledAt}
            timeWindow={timeWindow}
          />
        ) : processStatus === "degraded" ? (
          <Notice
            title={t("monitoring.process_collection_degraded")}
            message={t("monitoring.process_collection_unavailable")}
            tone="warning"
          />
        ) : processStatus === "waiting" ? (
          <Notice
            title={t("monitoring.runtime_summary_pending")}
            message={t("monitoring.runtime_summary_pending_description")}
            tone="info"
          />
        ) : (
          <Notice
            title={t("monitoring.subprocess_empty")}
            message={t("monitoring.subprocess_empty_description")}
            tone="info"
          />
        )}
      </section>
    ) : null;

  return (
    <div className={`monitoring-dashboard ${isMobile ? "monitoring-dashboard--mobile" : ""}`}>
      <div className="monitoring-toolbar">
        {toolbarSummary}
        <div className="monitoring-toolbar__actions">{refreshButton}</div>
      </div>
      {error && response ? (
        <Notice title={t("monitoring.refresh_failed")} message={error} tone="error" />
      ) : null}
      {primaryState}
      {disabledState}
      {overviewSection}
      {attributionSection}
      {processSection}
    </div>
  );
}

export function MonitoringContent() {
  const monitoringData = useMonitoringData();
  const isMobile = useViewport() === "mobile";

  return (
    <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
      <main className="monitoring-content">
        <MonitoringDashboard {...monitoringData} />
      </main>
    </div>
  );
}
