import type {
  MonitoringHistoryBundle,
  MonitoringSeriesBundle,
  MonitoringSeriesPoint,
  MonitoringSnapshot,
} from "@coder-studio/core";

const DEFAULT_RETENTION_MS = 30 * 60 * 1000;
const MAX_SUBPROCESS_HISTORY_GROUPS = 24;

function trimPoints(
  points: MonitoringSeriesPoint[],
  minSampledAt: number
): { points: MonitoringSeriesPoint[]; trimmed: boolean } {
  const nextPoints = points.filter((point) => point.sampledAt >= minSampledAt);
  return {
    points: nextPoints,
    trimmed: nextPoints.length !== points.length,
  };
}

function appendPoint(
  bundle: MonitoringSeriesBundle,
  point: MonitoringSeriesPoint,
  minSampledAt: number
): boolean {
  const result = trimPoints([...bundle.points, point], minSampledAt);
  bundle.points = result.points;
  return result.trimmed;
}

function pruneEntityHistory(
  history: Record<string, MonitoringSeriesBundle>,
  activeIds: Set<string>,
  minSampledAt: number
): boolean {
  let trimmed = false;

  for (const [id, bundle] of Object.entries(history)) {
    if (!activeIds.has(id)) {
      delete history[id];
      trimmed = true;
      continue;
    }

    const result = trimPoints(bundle.points, minSampledAt);
    bundle.points = result.points;
    trimmed = result.trimmed || trimmed;
  }

  return trimmed;
}

export class MonitoringHistoryStore {
  private readonly history: MonitoringHistoryBundle = {
    host: { points: [] },
    runtime: null,
    workspaces: {},
    sessions: {},
    subprocessGroups: {},
  };

  constructor(private readonly deps: { retentionMs?: number } = {}) {}

  clear(): void {
    this.history.host = { points: [] };
    this.history.runtime = null;
    this.history.workspaces = {};
    this.history.sessions = {};
    this.history.subprocessGroups = {};
  }

  record(snapshot: MonitoringSnapshot): { trimmed: boolean; subprocessHistoryLimited: boolean } {
    const minSampledAt = snapshot.sampledAt - (this.deps.retentionMs ?? DEFAULT_RETENTION_MS);
    let trimmed = false;
    let subprocessHistoryLimited = false;

    if (snapshot.host) {
      trimmed =
        appendPoint(
          this.history.host,
          {
            sampledAt: snapshot.sampledAt,
            cpuPercent: snapshot.host.cpuPercent,
            memoryBytes: snapshot.host.memoryUsedBytes,
          },
          minSampledAt
        ) || trimmed;
    } else if (this.history.host.points.length > 0) {
      this.history.host = { points: [] };
      trimmed = true;
    }

    if (snapshot.runtime) {
      this.history.runtime ??= { points: [] };
      trimmed =
        appendPoint(
          this.history.runtime,
          {
            sampledAt: snapshot.sampledAt,
            cpuPercent: snapshot.runtime.totalManagedCpuPercent,
            memoryBytes: snapshot.runtime.totalManagedMemoryBytes,
            processCount: snapshot.runtime.managedProcessCount,
          },
          minSampledAt
        ) || trimmed;
    }

    for (const entity of snapshot.workspaces) {
      const bundle = (this.history.workspaces[entity.id] ??= { points: [] });
      trimmed =
        appendPoint(
          bundle,
          {
            sampledAt: snapshot.sampledAt,
            cpuPercent: entity.cpuPercent,
            memoryBytes: entity.memoryBytes,
            processCount: entity.processCount,
          },
          minSampledAt
        ) || trimmed;
    }

    for (const entity of snapshot.sessions) {
      const bundle = (this.history.sessions[entity.id] ??= { points: [] });
      trimmed =
        appendPoint(
          bundle,
          {
            sampledAt: snapshot.sampledAt,
            cpuPercent: entity.cpuPercent,
            memoryBytes: entity.memoryBytes,
            processCount: entity.processCount,
          },
          minSampledAt
        ) || trimmed;
    }

    trimmed =
      pruneEntityHistory(
        this.history.workspaces,
        new Set(snapshot.workspaces.map((entity) => entity.id)),
        minSampledAt
      ) || trimmed;
    trimmed =
      pruneEntityHistory(
        this.history.sessions,
        new Set(snapshot.sessions.map((entity) => entity.id)),
        minSampledAt
      ) || trimmed;

    const hottestSubprocessIds = [...snapshot.subprocessGroups]
      .sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0))
      .slice(0, MAX_SUBPROCESS_HISTORY_GROUPS)
      .map((entity) => entity.id);
    const allowedSubprocessIds = new Set(hottestSubprocessIds);

    for (const entity of snapshot.subprocessGroups) {
      if (!allowedSubprocessIds.has(entity.id)) {
        trimmed = true;
        subprocessHistoryLimited = true;
        continue;
      }

      const bundle = (this.history.subprocessGroups[entity.id] ??= { points: [] });
      trimmed =
        appendPoint(
          bundle,
          {
            sampledAt: snapshot.sampledAt,
            cpuPercent: entity.cpuPercent,
            memoryBytes: entity.memoryBytes,
            processCount: entity.processCount,
          },
          minSampledAt
        ) || trimmed;
    }

    for (const id of Object.keys(this.history.subprocessGroups)) {
      if (!allowedSubprocessIds.has(id)) {
        delete this.history.subprocessGroups[id];
        trimmed = true;
        subprocessHistoryLimited = true;
      }
    }

    return { trimmed, subprocessHistoryLimited };
  }

  snapshot(): MonitoringHistoryBundle {
    return {
      host: { points: [...this.history.host.points] },
      runtime: this.history.runtime ? { points: [...this.history.runtime.points] } : null,
      workspaces: Object.fromEntries(
        Object.entries(this.history.workspaces).map(([id, bundle]) => [
          id,
          { points: [...bundle.points] },
        ])
      ),
      sessions: Object.fromEntries(
        Object.entries(this.history.sessions).map(([id, bundle]) => [
          id,
          { points: [...bundle.points] },
        ])
      ),
      subprocessGroups: Object.fromEntries(
        Object.entries(this.history.subprocessGroups).map(([id, bundle]) => [
          id,
          { points: [...bundle.points] },
        ])
      ),
    };
  }
}
