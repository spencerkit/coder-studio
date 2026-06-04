import { basename } from "node:path";
import {
  createEmptyMonitoringResponse,
  deriveMonitoringMode,
  type MonitoringResponse,
  resolveMonitoringSettings,
  type Session,
  type Terminal,
  type TerminalKind,
  Topics,
  type Workspace,
} from "@coder-studio/core";
import { buildMonitoringSnapshot } from "./aggregation.js";
import { MonitoringHistoryStore } from "./history-store.js";
import type { HostCollector } from "./host-collector.js";
import { ManagedProcessRegistry } from "./managed-process-registry.js";
import type { ProcessTableCollector } from "./process-table/index.js";

interface ActiveTerminalLike {
  toDTO(): Terminal;
  spec?: {
    workspaceId: string;
    kind: TerminalKind;
    title?: string;
  };
}

export class MonitoringService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private latest = createEmptyMonitoringResponse();
  private latestSampledSnapshot = this.latest.snapshot;
  private readonly history = new MonitoringHistoryStore();

  constructor(
    private readonly deps: {
      broadcaster: { broadcast(topic: string, payload: unknown): void };
      settingsRepo: { get<T = unknown>(key: string): T | undefined };
      registry: ManagedProcessRegistry;
      sessionMgr: {
        getAll(): Session[];
        findSessionIdByTerminal(terminalId: string): string | undefined;
      };
      workspaceMgr?: {
        get(workspaceId: string): Pick<Workspace, "id" | "name" | "path"> | undefined;
      };
      terminalMgr: {
        getAll(): ActiveTerminalLike[];
      };
      hostCollector: Pick<HostCollector, "collect">;
      processCollector: Pick<ProcessTableCollector, "collect">;
      setInterval?: typeof global.setInterval;
      clearInterval?: typeof global.clearInterval;
      now?: () => number;
    }
  ) {}

  start(): void {
    this.deps.registry.registerServerProcess(process.pid);
    this.reloadFromSettings();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    (this.deps.clearInterval ?? clearInterval)(this.timer);
    this.timer = null;
  }

  getResponse(): MonitoringResponse {
    return this.latest;
  }

  async recheck(): Promise<MonitoringResponse> {
    const settings = resolveMonitoringSettings(this.deps.settingsRepo);
    if (!settings.enabled) {
      this.latest = {
        ...createEmptyMonitoringResponse(settings),
        settings,
        snapshot: {
          ...createEmptyMonitoringResponse(settings).snapshot,
          sampledAt: this.now(),
          mode: deriveMonitoringMode(settings),
        },
      };
      return this.latest;
    }

    await this.sampleOnce(settings);
    return this.latest;
  }

  reloadFromSettings(): void {
    this.stop();
    const settings = resolveMonitoringSettings(this.deps.settingsRepo);
    const empty = createEmptyMonitoringResponse(settings);
    if (!settings.enabled) {
      this.history.clear();
      this.latestSampledSnapshot = empty.snapshot;
      this.latest = {
        ...empty,
        settings,
        snapshot: {
          ...empty.snapshot,
          sampledAt: this.now(),
          mode: deriveMonitoringMode(settings),
        },
      };
      return;
    }

    this.latest = {
      ...empty,
      settings,
      snapshot: {
        ...empty.snapshot,
        sampledAt: this.now(),
        mode: deriveMonitoringMode(settings),
      },
    };

    const intervalHandle = (this.deps.setInterval ?? setInterval)(() => {
      void this.sampleOnce();
    }, settings.sampleIntervalMs);
    intervalHandle.unref?.();
    this.timer = intervalHandle;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private syncManagedTerminalRoots(): void {
    const sessions = this.deps.sessionMgr.getAll();
    const sessionsByTerminal = new Map(sessions.map((session) => [session.terminalId, session]));
    const activeTerminals = this.deps.terminalMgr.getAll();
    const activeOwnerIds = new Set<string>();

    for (const activeTerminal of activeTerminals) {
      const terminal = activeTerminal.toDTO();
      activeOwnerIds.add(`terminal:${terminal.id}`);
      this.deps.registry.upsertTerminalRoot({
        terminalId: terminal.id,
        workspaceId: terminal.workspaceId,
        pid: terminal.pid,
        kind: terminal.kind,
        title: terminal.title,
      });

      const session =
        sessionsByTerminal.get(terminal.id) ??
        (() => {
          const sessionId = this.deps.sessionMgr.findSessionIdByTerminal(terminal.id);
          return sessionId ? sessions.find((candidate) => candidate.id === sessionId) : undefined;
        })();

      if (!session) {
        continue;
      }

      this.deps.registry.bindSessionToTerminal(terminal.id, {
        sessionId: session.id,
        providerId: session.providerId,
        label: session.title ?? terminal.title,
      });
    }

    for (const root of this.deps.registry.listRoots()) {
      if (root.kind !== "terminal") {
        continue;
      }
      if (activeOwnerIds.has(root.ownerId)) {
        continue;
      }
      this.deps.registry.unregisterByOwner(root.ownerId);
    }
  }

  private getWorkspaceLabels(roots: ReturnType<ManagedProcessRegistry["listRoots"]>) {
    const labels: Record<string, string> = {};
    for (const root of roots) {
      if (!root.workspaceId || labels[root.workspaceId]) {
        continue;
      }

      const workspace = this.deps.workspaceMgr?.get(root.workspaceId);
      const label = workspace?.name?.trim() || (workspace?.path ? basename(workspace.path) : "");
      if (label) {
        labels[root.workspaceId] = label;
      }
    }
    return labels;
  }

  private async sampleOnce(
    settings = resolveMonitoringSettings(this.deps.settingsRepo)
  ): Promise<void> {
    const startedAt = this.now();
    this.syncManagedTerminalRoots();

    const host = settings.hostMetricsEnabled ? this.deps.hostCollector.collect() : null;

    let processRows: Awaited<ReturnType<ProcessTableCollector["collect"]>> | null = null;
    let failureReason: string | undefined;
    if (settings.runtimeSummaryEnabled) {
      try {
        processRows = await this.deps.processCollector.collect();
      } catch (error) {
        failureReason = error instanceof Error ? error.message : String(error);
      }
    }

    const roots = this.deps.registry.listRoots();
    const response = buildMonitoringSnapshot({
      settings,
      sampledAt: startedAt,
      host,
      roots,
      workspaceLabels: this.getWorkspaceLabels(roots),
      processRows,
      previousSnapshot:
        this.latestSampledSnapshot.sampledAt > 0 ? this.latestSampledSnapshot : null,
      failureReason,
    });

    const historyState = this.history.record(response.snapshot);
    this.latestSampledSnapshot = response.snapshot;
    this.latest = {
      ...response,
      history: this.history.snapshot(),
      capabilities: {
        ...response.capabilities,
        subprocessHistoryLimited: historyState.subprocessHistoryLimited,
      },
      telemetry: response.telemetry
        ? {
            ...response.telemetry,
            durationMs: this.now() - startedAt,
            historyTrimmed: historyState.trimmed,
          }
        : null,
    };

    this.deps.broadcaster.broadcast(Topics.monitoringSnapshotUpdated, this.latest);
  }
}
