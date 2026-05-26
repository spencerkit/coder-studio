import {
  createEmptyMonitoringResponse,
  deriveMonitoringMode,
  type MonitoringEntitySummary,
  type MonitoringHostSummary,
  type MonitoringResponse,
  type MonitoringSettings,
  type MonitoringSnapshot,
} from "@coder-studio/core";
import type { ManagedProcessRoot, ProcessStatRow } from "./types.js";

function createTrend(
  current: number | null,
  previous: number | null
): MonitoringEntitySummary["trend"] {
  if (current == null || previous == null) {
    return "unknown";
  }
  if (current > previous + 1) {
    return "rising";
  }
  if (current < previous - 1) {
    return "falling";
  }
  return "steady";
}

function buildIndexes(rows: ProcessStatRow[]) {
  const byPid = new Map<number, ProcessStatRow>();
  const childrenByPpid = new Map<number, ProcessStatRow[]>();

  for (const row of rows) {
    byPid.set(row.pid, row);
    const children = childrenByPpid.get(row.ppid) ?? [];
    children.push(row);
    childrenByPpid.set(row.ppid, children);
  }

  return { byPid, childrenByPpid };
}

function collectTree(rootPid: number, indexes: ReturnType<typeof buildIndexes>): ProcessStatRow[] {
  const root = indexes.byPid.get(rootPid);
  if (!root) {
    return [];
  }

  const result: ProcessStatRow[] = [];
  const stack = [root];
  const seen = new Set<number>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current.pid)) {
      continue;
    }
    seen.add(current.pid);
    result.push(current);

    for (const child of indexes.childrenByPpid.get(current.pid) ?? []) {
      stack.push(child);
    }
  }

  return result;
}

function summarizeRows(rows: ProcessStatRow[]) {
  return rows.reduce(
    (acc, row) => ({
      cpuPercent: acc.cpuPercent + (row.cpuPercent ?? 0),
      memoryBytes: acc.memoryBytes + (row.rssBytes ?? 0),
      processCount: acc.processCount + 1,
      uptimeSec: Math.max(acc.uptimeSec, row.elapsedSec ?? 0),
    }),
    { cpuPercent: 0, memoryBytes: 0, processCount: 0, uptimeSec: 0 }
  );
}

function sortByCpu<T extends { cpuPercent: number | null }>(items: T[]): T[] {
  return items.sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0));
}

export function buildMonitoringSnapshot(input: {
  settings: MonitoringSettings;
  sampledAt: number;
  host: MonitoringHostSummary | null;
  roots: ManagedProcessRoot[];
  processRows: ProcessStatRow[] | null;
  previousSnapshot: MonitoringSnapshot | null;
  failureReason?: string;
}): MonitoringResponse {
  const empty = createEmptyMonitoringResponse(input.settings);
  const mode = deriveMonitoringMode(input.settings);

  if (!input.settings.enabled) {
    return {
      ...empty,
      settings: input.settings,
      snapshot: {
        ...empty.snapshot,
        sampledAt: input.sampledAt,
        mode,
      },
    };
  }

  if (!input.processRows) {
    return {
      ...empty,
      settings: input.settings,
      capabilities: {
        ...empty.capabilities,
        loadAverageAvailable: input.host?.loadAverage !== null,
      },
      snapshot: {
        ...empty.snapshot,
        sampledAt: input.sampledAt,
        mode,
        host: input.host,
      },
      telemetry: {
        durationMs: 0,
        processRowCount: 0,
        subprocessGroupCount: 0,
        historyTrimmed: false,
        degraded: true,
        failureReason: input.failureReason,
      },
    };
  }

  const indexes = buildIndexes(input.processRows);
  const previousEntities = new Map(
    [
      ...(input.previousSnapshot?.workspaces ?? []),
      ...(input.previousSnapshot?.sessions ?? []),
      ...(input.previousSnapshot?.subprocessGroups ?? []),
      ...(input.previousSnapshot?.backgroundGroups ?? []),
    ].map((entity) => [entity.id, entity.cpuPercent ?? null])
  );

  const workspaceMap = new Map<string, MonitoringEntitySummary>();
  const sessionMap = new Map<string, MonitoringEntitySummary>();
  const subprocessGroups: MonitoringEntitySummary[] = [];
  const backgroundGroups: MonitoringEntitySummary[] = [];
  const rootSubtreePidSets = new Map<string, Set<number>>();
  let totalManagedCpuPercent = 0;
  let totalManagedMemoryBytes = 0;
  let managedProcessCount = 0;

  for (const root of input.roots) {
    rootSubtreePidSets.set(
      root.ownerId,
      new Set(collectTree(root.rootPid, indexes).map((row) => row.pid))
    );
  }

  const rootRowsByOwner = new Map<string, ProcessStatRow[]>();

  for (const root of input.roots) {
    const currentRootPidSet = rootSubtreePidSets.get(root.ownerId) ?? new Set<number>();
    const overlappingSubtreePids = new Set<number>();
    for (const candidate of input.roots) {
      if (candidate.ownerId === root.ownerId) {
        continue;
      }

      const candidatePidSet = rootSubtreePidSets.get(candidate.ownerId);
      if (!candidatePidSet || !currentRootPidSet.has(candidate.rootPid)) {
        continue;
      }

      for (const pid of candidatePidSet) {
        overlappingSubtreePids.add(pid);
      }
    }

    const treeRows = collectTree(root.rootPid, indexes).filter((row) => {
      return row.pid === root.rootPid || !overlappingSubtreePids.has(row.pid);
    });
    if (treeRows.length === 0) {
      continue;
    }

    rootRowsByOwner.set(root.ownerId, treeRows);
    const summary = summarizeRows(treeRows);
    totalManagedCpuPercent += summary.cpuPercent;
    totalManagedMemoryBytes += summary.memoryBytes;
    managedProcessCount += summary.processCount;

    if (!root.workspaceId) {
      backgroundGroups.push({
        id: `background:${root.ownerId}`,
        kind: "background_group",
        label: root.label,
        cpuPercent: summary.cpuPercent,
        memoryBytes: summary.memoryBytes,
        processCount: summary.processCount,
        uptimeSec: summary.uptimeSec,
        trend: createTrend(
          summary.cpuPercent,
          previousEntities.get(`background:${root.ownerId}`) ?? null
        ),
      });
      continue;
    }

    const workspaceId = `workspace:${root.workspaceId}`;
    const workspace =
      workspaceMap.get(workspaceId) ??
      ({
        id: workspaceId,
        kind: "workspace",
        workspaceId: root.workspaceId,
        label: root.workspaceId,
        cpuPercent: 0,
        memoryBytes: 0,
        processCount: 0,
        uptimeSec: 0,
        trend: "unknown",
        childCount: 0,
      } satisfies MonitoringEntitySummary);

    workspace.cpuPercent = (workspace.cpuPercent ?? 0) + summary.cpuPercent;
    workspace.memoryBytes = (workspace.memoryBytes ?? 0) + summary.memoryBytes;
    workspace.processCount += summary.processCount;
    workspace.uptimeSec = Math.max(workspace.uptimeSec ?? 0, summary.uptimeSec);
    workspace.childCount = (workspace.childCount ?? 0) + 1;
    workspace.trend = createTrend(workspace.cpuPercent, previousEntities.get(workspaceId) ?? null);
    workspaceMap.set(workspaceId, workspace);

    if (root.sessionId) {
      const sessionId = `session:${root.sessionId}`;
      sessionMap.set(sessionId, {
        id: sessionId,
        kind: "session",
        parentId: workspaceId,
        workspaceId: root.workspaceId,
        sessionId: root.sessionId,
        terminalId: root.terminalId,
        label: root.label,
        cpuPercent: summary.cpuPercent,
        memoryBytes: summary.memoryBytes,
        processCount: summary.processCount,
        uptimeSec: summary.uptimeSec,
        trend: createTrend(summary.cpuPercent, previousEntities.get(sessionId) ?? null),
        childCount: Math.max(0, treeRows.length - 1),
      });

      if (input.settings.subprocessDrilldownEnabled) {
        for (const child of treeRows.filter((row) => row.pid !== root.rootPid)) {
          const id = `subprocess:${root.sessionId}:${child.pid}`;
          subprocessGroups.push({
            id,
            kind: "subprocess_group",
            parentId: sessionId,
            workspaceId: root.workspaceId,
            sessionId: root.sessionId,
            terminalId: root.terminalId,
            label: child.command ?? child.executable ?? `pid ${child.pid}`,
            cpuPercent: child.cpuPercent,
            memoryBytes: child.rssBytes,
            processCount: 1,
            uptimeSec: child.elapsedSec ?? null,
            trend: createTrend(child.cpuPercent, previousEntities.get(id) ?? null),
          });
        }
      }
    }
  }

  const serverRoot = input.roots.find((root) => root.kind === "server");
  const serverSummary = summarizeRows(
    serverRoot ? (rootRowsByOwner.get(serverRoot.ownerId) ?? []) : []
  );
  const hostCpu = input.host?.cpuPercent ?? null;
  const hostMemory = input.host?.memoryTotalBytes ?? null;

  return {
    ...empty,
    settings: input.settings,
    capabilities: {
      loadAverageAvailable: input.host?.loadAverage !== null,
      processMetricsAvailable: true,
      subprocessHistoryLimited: false,
    },
    snapshot: {
      sampledAt: input.sampledAt,
      mode,
      host: input.host,
      runtime: input.settings.runtimeSummaryEnabled
        ? {
            serverCpuPercent: serverSummary.cpuPercent || null,
            serverMemoryBytes: serverSummary.memoryBytes || null,
            totalManagedCpuPercent,
            totalManagedMemoryBytes,
            managedProcessCount,
            cpuShareOfHostPercent:
              hostCpu != null && hostCpu > 0
                ? Number(((totalManagedCpuPercent / hostCpu) * 100).toFixed(2))
                : null,
            memoryShareOfHostPercent:
              hostMemory != null && hostMemory > 0
                ? Number(((totalManagedMemoryBytes / hostMemory) * 100).toFixed(2))
                : null,
          }
        : null,
      workspaces: input.settings.workspaceAttributionEnabled
        ? sortByCpu([...workspaceMap.values()])
        : [],
      sessions: input.settings.workspaceAttributionEnabled
        ? sortByCpu([...sessionMap.values()])
        : [],
      subprocessGroups: input.settings.subprocessDrilldownEnabled
        ? sortByCpu(subprocessGroups)
        : [],
      backgroundGroups: sortByCpu(backgroundGroups),
    },
    telemetry: {
      durationMs: 0,
      processRowCount: input.processRows.length,
      subprocessGroupCount: subprocessGroups.length,
      historyTrimmed: false,
      degraded: false,
      failureReason: input.failureReason,
    },
  };
}
