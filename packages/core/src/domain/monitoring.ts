export const MONITORING_SAMPLE_INTERVAL_OPTIONS = [1000, 2000, 5000, 10000] as const;

export const DEFAULT_MONITORING_SAMPLE_INTERVAL_MS = 2000;

export type MonitoringSampleIntervalMs = (typeof MONITORING_SAMPLE_INTERVAL_OPTIONS)[number];
export type MonitoringMode = "disabled" | "light" | "standard" | "deep";
export type MonitoringPressure = "normal" | "elevated" | "hot" | "unknown";

export interface MonitoringSettings {
  enabled: boolean;
  hostMetricsEnabled: boolean;
  runtimeSummaryEnabled: boolean;
  workspaceAttributionEnabled: boolean;
  subprocessDrilldownEnabled: boolean;
  sampleIntervalMs: MonitoringSampleIntervalMs;
}

export interface MonitoringSeriesPoint {
  sampledAt: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  processCount?: number;
}

export interface MonitoringHostSummary {
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  loadAverage: [number, number, number] | null;
  uptimeSec: number | null;
  pressure: MonitoringPressure;
}

export interface MonitoringRuntimeSummary {
  serverCpuPercent: number | null;
  serverMemoryBytes: number | null;
  totalManagedCpuPercent: number | null;
  totalManagedMemoryBytes: number | null;
  managedProcessCount: number;
  cpuShareOfHostPercent: number | null;
  memoryShareOfHostPercent: number | null;
}

export interface MonitoringEntitySummary {
  id: string;
  kind: "workspace" | "session" | "subprocess_group" | "background_group";
  parentId?: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  label: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  processCount: number;
  uptimeSec: number | null;
  trend: "rising" | "steady" | "falling" | "unknown";
  childCount?: number;
}

export interface MonitoringSnapshot {
  sampledAt: number;
  mode: MonitoringMode;
  host: MonitoringHostSummary | null;
  runtime: MonitoringRuntimeSummary | null;
  workspaces: MonitoringEntitySummary[];
  sessions: MonitoringEntitySummary[];
  subprocessGroups: MonitoringEntitySummary[];
  backgroundGroups: MonitoringEntitySummary[];
}

export interface MonitoringSeriesBundle {
  points: MonitoringSeriesPoint[];
}

export interface MonitoringHistoryBundle {
  host: MonitoringSeriesBundle;
  runtime: MonitoringSeriesBundle | null;
  workspaces: Record<string, MonitoringSeriesBundle>;
  sessions: Record<string, MonitoringSeriesBundle>;
  subprocessGroups: Record<string, MonitoringSeriesBundle>;
}

export interface MonitoringCapabilities {
  loadAverageAvailable: boolean;
  processMetricsAvailable: boolean;
  subprocessHistoryLimited: boolean;
}

export interface MonitoringSamplingTelemetry {
  durationMs: number;
  processRowCount: number;
  subprocessGroupCount: number;
  historyTrimmed: boolean;
  degraded: boolean;
  failureReason?: string;
}

export interface MonitoringResponse {
  settings: MonitoringSettings;
  snapshot: MonitoringSnapshot;
  history: MonitoringHistoryBundle;
  capabilities: MonitoringCapabilities;
  telemetry: MonitoringSamplingTelemetry | null;
}

export function isMonitoringSampleIntervalMs(value: unknown): value is MonitoringSampleIntervalMs {
  return (
    typeof value === "number" &&
    MONITORING_SAMPLE_INTERVAL_OPTIONS.includes(value as MonitoringSampleIntervalMs)
  );
}

export function createDefaultMonitoringSettings(): MonitoringSettings {
  return {
    enabled: false,
    hostMetricsEnabled: true,
    runtimeSummaryEnabled: true,
    workspaceAttributionEnabled: true,
    subprocessDrilldownEnabled: false,
    sampleIntervalMs: DEFAULT_MONITORING_SAMPLE_INTERVAL_MS,
  };
}

function normalizeMonitoringDependencies(settings: MonitoringSettings): MonitoringSettings {
  if (!settings.workspaceAttributionEnabled) {
    settings.subprocessDrilldownEnabled = false;
  }
  if (!settings.runtimeSummaryEnabled) {
    settings.workspaceAttributionEnabled = false;
    settings.subprocessDrilldownEnabled = false;
  }
  return settings;
}

export function resolveMonitoringSettings(
  values:
    | Record<string, unknown>
    | {
        get: <T = unknown>(key: string) => T | undefined;
      }
    | undefined
): MonitoringSettings {
  const defaults = createDefaultMonitoringSettings();
  const objectValues =
    values && "get" in values && typeof values.get === "function"
      ? null
      : (values as Record<string, unknown> | undefined);
  const read = (key: string) => {
    if (!values) {
      return undefined;
    }

    if ("get" in values && typeof values.get === "function") {
      return values.get(key);
    }

    return objectValues?.[key];
  };

  return normalizeMonitoringDependencies({
    enabled:
      typeof read("monitoring.enabled") === "boolean"
        ? Boolean(read("monitoring.enabled"))
        : defaults.enabled,
    hostMetricsEnabled:
      typeof read("monitoring.hostMetricsEnabled") === "boolean"
        ? Boolean(read("monitoring.hostMetricsEnabled"))
        : defaults.hostMetricsEnabled,
    runtimeSummaryEnabled:
      typeof read("monitoring.runtimeSummaryEnabled") === "boolean"
        ? Boolean(read("monitoring.runtimeSummaryEnabled"))
        : defaults.runtimeSummaryEnabled,
    workspaceAttributionEnabled:
      typeof read("monitoring.workspaceAttributionEnabled") === "boolean"
        ? Boolean(read("monitoring.workspaceAttributionEnabled"))
        : defaults.workspaceAttributionEnabled,
    subprocessDrilldownEnabled:
      typeof read("monitoring.subprocessDrilldownEnabled") === "boolean"
        ? Boolean(read("monitoring.subprocessDrilldownEnabled"))
        : defaults.subprocessDrilldownEnabled,
    sampleIntervalMs: isMonitoringSampleIntervalMs(read("monitoring.sampleIntervalMs"))
      ? (read("monitoring.sampleIntervalMs") as MonitoringSampleIntervalMs)
      : defaults.sampleIntervalMs,
  });
}

export function deriveMonitoringMode(settings: MonitoringSettings): MonitoringMode {
  if (!settings.enabled) {
    return "disabled";
  }
  if (settings.subprocessDrilldownEnabled) {
    return "deep";
  }
  if (settings.workspaceAttributionEnabled) {
    return "standard";
  }
  return "light";
}

export function createEmptyMonitoringResponse(
  settings = createDefaultMonitoringSettings()
): MonitoringResponse {
  return {
    settings,
    snapshot: {
      sampledAt: 0,
      mode: deriveMonitoringMode(settings),
      host: null,
      runtime: null,
      workspaces: [],
      sessions: [],
      subprocessGroups: [],
      backgroundGroups: [],
    },
    history: {
      host: { points: [] },
      runtime: null,
      workspaces: {},
      sessions: {},
      subprocessGroups: {},
    },
    capabilities: {
      loadAverageAvailable: process.platform !== "win32",
      processMetricsAvailable: false,
      subprocessHistoryLimited: false,
    },
    telemetry: null,
  };
}
