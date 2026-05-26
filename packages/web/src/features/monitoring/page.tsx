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
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { Button, Notice, SegmentedControl, Tag } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import { MobilePageHeader } from "../shared/components/mobile-page-header";
import { PageHeader } from "../shared/components/page-header";
import {
  formatBytes,
  formatLoadAverage,
  formatPercent,
  formatRefreshInterval,
  formatTimestamp,
  formatUptime,
} from "./formatters";
import { Sparkline } from "./sparkline";

type MobileSection = "overview" | "attribution" | "process";
type SortMode = "cpu" | "memory";
type TimeWindow = "5m" | "15m" | "30m";
type MonitoringViewStatus = "loading" | "disabled" | "ready" | "degraded" | "waiting" | "empty";
type MonitoringContentProps = {
  onOpenSettings?: () => void;
  showPageChrome?: boolean;
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

  useEffect(() => {
    if (!wsClient || connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const next = await wsClient.sendCommand<MonitoringResponse>(
          "monitoring.get",
          {},
          undefined
        );
        if (!cancelled) {
          setResponse(next);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t("monitoring.load_failed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const unsubscribe = wsClient.subscribe(
      [Topics.monitoringSnapshotUpdated],
      (_topic, payload) => {
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

    try {
      setError(null);
      const next = await wsClient.sendCommand<MonitoringResponse>(
        "monitoring.recheck",
        {},
        undefined
      );
      setResponse(next);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : t("monitoring.refresh_failed")
      );
    }
  };

  return { error, loading, refresh, response };
}

export function MonitoringContent({
  onOpenSettings,
  showPageChrome = false,
}: MonitoringContentProps = {}) {
  const t = useTranslation();
  const isMobile = useViewport() === "mobile";
  const { error, loading, refresh, response } = useMonitoringData();
  const [sortMode, setSortMode] = useState<SortMode>("cpu");
  const [mobileSection, setMobileSection] = useState<MobileSection>("overview");
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

  const pageHeader = isMobile ? (
    <MobilePageHeader title={t("monitoring.title")} titleAs="div" />
  ) : (
    <PageHeader title={t("monitoring.title")} titleAs="h1" level="secondary" />
  );

  const refreshButton = (
    <Button
      aria-label={`${t("action.refresh")} ${t("monitoring.command_label").toLowerCase()}`}
      size={isMobile ? "sm" : undefined}
      variant={isMobile ? "ghost" : "secondary"}
      onClick={() => void refresh()}
    >
      {t("action.refresh")}
    </Button>
  );

  if (loading) {
    return (
      <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
        {showPageChrome ? pageHeader : null}
        <main className="monitoring-content">
          <div className="monitoring-toolbar">{refreshButton}</div>
          <Notice title={t("monitoring.title")} message={t("monitoring.loading")} tone="info" />
        </main>
      </div>
    );
  }

  if (error && !response) {
    return (
      <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
        {showPageChrome ? pageHeader : null}
        <main className="monitoring-content">
          <div className="monitoring-toolbar">{refreshButton}</div>
          <Notice title={t("monitoring.load_failed")} message={error} tone="error" />
        </main>
      </div>
    );
  }

  if (!response) {
    return null;
  }

  if (!response.settings.enabled) {
    return (
      <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
        {showPageChrome ? pageHeader : null}
        <main className="monitoring-content">
          <div className="monitoring-toolbar">{refreshButton}</div>
          <div className="monitoring-card">
            <h2>{t("monitoring.disabled_title")}</h2>
            <p>{t("monitoring.disabled_description")}</p>
            {onOpenSettings ? (
              <Button variant="secondary" onClick={onOpenSettings}>
                {t("monitoring.open_settings")}
              </Button>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  const overviewSection = (
    <>
      <div className="monitoring-toolbar">
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
      </div>

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
    </>
  );

  const attributionSection = (
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
  );

  const processSection = (
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
  );

  return (
    <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
      {showPageChrome ? pageHeader : null}
      <main className="monitoring-content">
        <div className="monitoring-toolbar">{refreshButton}</div>
        {error ? (
          <Notice title={t("monitoring.refresh_failed")} message={error} tone="error" />
        ) : null}
        {isMobile ? (
          <>
            <SegmentedControl
              aria-label={t("monitoring.mobile_section")}
              size="sm"
              value={mobileSection}
              onChange={(value) => setMobileSection(value as MobileSection)}
              options={[
                { value: "overview", label: t("monitoring.mobile_overview") },
                { value: "attribution", label: t("monitoring.mobile_attribution") },
                { value: "process", label: t("monitoring.mobile_process") },
              ]}
            />
            {mobileSection === "overview" ? overviewSection : null}
            {mobileSection === "attribution" ? attributionSection : null}
            {mobileSection === "process" ? processSection : null}
          </>
        ) : (
          <>
            {overviewSection}
            {attributionSection}
            {processSection}
          </>
        )}
      </main>
    </div>
  );
}

export function MonitoringPage() {
  const navigate = useNavigate();

  return (
    <MonitoringContent
      showPageChrome
      onOpenSettings={() => navigate("/settings?section=monitoring")}
    />
  );
}
