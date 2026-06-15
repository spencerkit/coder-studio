import { randomUUID } from "node:crypto";
import { formatTokenMetric } from "@coder-studio/utils";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../storage/repositories/skill-mount-repo.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import { analyzeWorkBasic } from "./basic-analyzer.js";
import type { WorkDeepAnalysisRunner } from "./deep-runner.js";
import { sampleWorkLogEvidence } from "./evidence-sampler.js";
import { compactWorkLogEventForHourlyIndex } from "./hourly-index-events.js";
import type {
  WorkLogCollection,
  WorkLogCollector,
  WorkLogEvent,
  WorkLogSession,
  WorkLogUsageCoverage,
} from "./log-sources/types.js";
import {
  buildWorkAnalysisQueryDigest,
  normalizeWorkAnalysisQuery,
  resolveWorkAnalysisTimeRange,
} from "./query.js";
import {
  extractSkillNameFromEvent,
  UNKNOWN_SKILL_KEY,
  UNKNOWN_SKILL_LABEL,
} from "./skill-attribution.js";
import type {
  ResolvedWorkAnalysisTimeRange,
  WorkAnalysisContributionRank,
  WorkAnalysisDashboardProjection,
  WorkAnalysisDashboardProviderStatus,
  WorkAnalysisDashboardRecord,
  WorkAnalysisDashboardScanState,
  WorkAnalysisHourlyIndex,
  WorkAnalysisHourlyIndexSession,
  WorkAnalysisProviderWarning,
  WorkAnalysisQuery,
  WorkAnalysisRecord,
  WorkAnalysisScanMode,
  WorkAnalysisUsageTotals,
} from "./types.js";

const DASHBOARD_PROJECTION_DATA_VERSION = 2;
const HOUR_MS = 60 * 60 * 1000;

export interface WorkAnalysisServiceDeps {
  repo: {
    findByQueryDigest(queryDigest: string): WorkAnalysisRecord | undefined;
    upsert(record: WorkAnalysisRecord): WorkAnalysisRecord;
    findHourlyIndex?(): WorkAnalysisHourlyIndex | undefined;
    upsertHourlyIndex?(index: WorkAnalysisHourlyIndex): WorkAnalysisHourlyIndex;
    clearAnalysisCache?(): void;
  };
  workspaceMgr: Pick<WorkspaceManager, "get">;
  workLogCollector: Pick<WorkLogCollector, "collect">;
  skillLibraryRepo: Pick<SkillLibraryRepo, "list">;
  skillMountRepo: Pick<SkillMountRepo, "list">;
  basicAnalyzer?: typeof analyzeWorkBasic;
  deepRunner: Pick<WorkDeepAnalysisRunner, "run">;
  now?: () => number;
}

export class WorkAnalysisService {
  private readonly now: () => number;
  private readonly basicAnalyzer: typeof analyzeWorkBasic;
  private autoScanTimer: ReturnType<typeof setInterval> | undefined;
  private dashboardRefreshQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: WorkAnalysisServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.basicAnalyzer = deps.basicAnalyzer ?? analyzeWorkBasic;
  }

  get(query: WorkAnalysisQuery): WorkAnalysisRecord | undefined {
    const normalized = normalizeWorkAnalysisQuery(query);
    return this.deps.repo.findByQueryDigest(buildWorkAnalysisQueryDigest(normalized));
  }

  async runBasic(query: WorkAnalysisQuery): Promise<WorkAnalysisRecord> {
    const { record } = await this.runBasicWithCollection(query);
    return record;
  }

  async runDeep(query: WorkAnalysisQuery): Promise<WorkAnalysisRecord> {
    const {
      record: basicRecord,
      collection,
      skillInventory,
    } = await this.runBasicWithCollection(query);
    if (basicRecord.basicStatus !== "succeeded" || !basicRecord.basicResult) {
      return basicRecord;
    }

    const deepRunningRecord = this.deps.repo.upsert({
      ...basicRecord,
      deepStatus: "running",
      deepErrorMessage: undefined,
    });

    try {
      const workspacePath = collection.sessions[0]?.workspacePath ?? process.cwd();
      const deepResult = await this.deps.deepRunner.run({
        sessionId: `work-analysis-${basicRecord.id}`,
        workspacePath,
        basicResult: basicRecord.basicResult,
        evidence: sampleWorkLogEvidence({
          sessions: collection.sessions,
          skillInventory,
        }),
      });

      return this.deps.repo.upsert({
        ...deepRunningRecord,
        deepStatus: "succeeded",
        deepCompletedAt: this.now(),
        deepResult,
        deepErrorMessage: undefined,
      });
    } catch (error) {
      const candidate = error as { message?: string };
      return this.deps.repo.upsert({
        ...deepRunningRecord,
        deepStatus: "failed",
        deepCompletedAt: this.now(),
        deepErrorMessage: candidate.message ?? "Deep work analysis failed",
      });
    }
  }

  async getDashboard(query: WorkAnalysisQuery): Promise<WorkAnalysisDashboardRecord> {
    const normalized = normalizeWorkAnalysisQuery(query);
    const queryDigest = buildWorkAnalysisQueryDigest(normalized);
    const hourlyIndex = normalizeUsableHourlyIndex(this.deps.repo.findHourlyIndex?.());

    if (hourlyIndex && isHourlyIndexFresh(hourlyIndex, this.now())) {
      return this.buildDashboardRecordFromIndex({
        indexedAt: hourlyIndex.indexedAt,
        mode: "auto",
        normalized,
        queryDigest,
        requestedAt: this.now(),
        hourlyIndex,
      });
    }

    return await this.refreshDashboard(normalized, "auto");
  }

  async refreshDashboard(
    query: WorkAnalysisQuery,
    mode: WorkAnalysisScanMode = "manual"
  ): Promise<WorkAnalysisDashboardRecord> {
    const refresh = this.dashboardRefreshQueue
      .catch(() => undefined)
      .then(() => this.refreshDashboardInternal(query, mode));
    this.dashboardRefreshQueue = refresh.catch(() => undefined);
    return await refresh;
  }

  async rebuildDashboardIndex(query: WorkAnalysisQuery): Promise<WorkAnalysisDashboardRecord> {
    const rebuild = this.dashboardRefreshQueue
      .catch(() => undefined)
      .then(() => {
        this.deps.repo.clearAnalysisCache?.();
        return this.refreshDashboardInternal(query, "manual", { forceRebuildIndex: true });
      });
    this.dashboardRefreshQueue = rebuild.catch(() => undefined);
    return await rebuild;
  }

  startAutoScan(input: { intervalMs?: number; query?: WorkAnalysisQuery } = {}) {
    if (this.autoScanTimer) {
      return;
    }

    const intervalMs = input.intervalMs ?? 60 * 60 * 1000;
    const query = input.query ?? { timeRange: { preset: "90d" } };
    const run = () => {
      void this.refreshDashboard(query, "auto").catch(() => {
        // The scan state is persisted by refreshDashboardInternal; avoid unhandled rejections.
      });
    };

    run();
    this.autoScanTimer = setInterval(run, intervalMs);
    this.autoScanTimer.unref?.();
  }

  stopAutoScan() {
    if (!this.autoScanTimer) {
      return;
    }

    clearInterval(this.autoScanTimer);
    this.autoScanTimer = undefined;
  }

  private async refreshDashboardInternal(
    query: WorkAnalysisQuery,
    mode: WorkAnalysisScanMode,
    options: { forceRebuildIndex?: boolean } = {}
  ): Promise<WorkAnalysisDashboardRecord> {
    const normalized = normalizeWorkAnalysisQuery(query);
    const queryDigest = buildWorkAnalysisQueryDigest(normalized);
    const requestedAt = this.now();
    const running: WorkAnalysisDashboardRecord = {
      version: 1,
      queryDigest,
      query: normalized,
      mode,
      requestedAt,
      scanState: {
        mode,
        status: "running",
        lastStartedAt: requestedAt,
        ...(mode === "auto" ? { nextScheduledAt: requestedAt + 60 * 60 * 1000 } : {}),
        providerStatuses: [],
      },
    };

    const completedAt = this.now();
    try {
      const hourlyIndex = await this.refreshHourlyIndex({
        forceRebuild: options.forceRebuildIndex === true,
        requestedAt,
      });
      return this.buildDashboardRecordFromIndex({
        indexedAt: completedAt,
        mode,
        normalized,
        queryDigest,
        requestedAt: running.requestedAt,
        lastStartedAt: requestedAt,
        nextScheduledAt:
          mode === "auto" ? completedAt + 60 * 60 * 1000 : running.scanState.nextScheduledAt,
        hourlyIndex,
      });
    } catch (error) {
      const candidate = error as { message?: string };
      return {
        ...running,
        mode,
        scanState: {
          ...running.scanState,
          mode,
          status: "failed",
          lastCompletedAt: completedAt,
          errorMessage: candidate.message ?? "Dashboard refresh failed",
        },
      };
    }
  }

  private async refreshHourlyIndex(input: {
    forceRebuild: boolean;
    requestedAt: number;
  }): Promise<WorkAnalysisHourlyIndex> {
    const previous = input.forceRebuild
      ? undefined
      : normalizeUsableHourlyIndex(this.deps.repo.findHourlyIndex?.());
    const requestedHourStart = floorToHour(input.requestedAt);
    const indexedThroughHourStart = Math.max(0, requestedHourStart - HOUR_MS);
    const startAt = previous
      ? Math.min(
          previous.indexedThroughHourStart + HOUR_MS,
          floorToHour(previous.indexedAt),
          requestedHourStart
        )
      : 0;
    const timeRange = {
      startAt,
      endAt: input.requestedAt,
      label: previous ? "incremental" : "all history",
    };
    const collection = await this.deps.workLogCollector.collect({
      workspacePaths: [],
      timeRange,
    });
    const providerStatuses = mergeIndexProviderStatuses({
      buckets: [
        ...(previous?.buckets.filter((bucket) => bucket.hourStart < floorToHour(startAt)) ?? []),
        ...buildHourlyIndexBuckets(collection.sessions),
      ],
      providerStatuses: buildProviderStatuses(collection.providers),
    });
    const index = normalizeHourlyIndex({
      version: 1,
      bucketMode: "hourly_session_slices",
      indexedAt: this.now(),
      indexedThroughHourStart,
      sourceDigest: collection.sourceDigest,
      providerStatuses,
      buckets: mergeHourlyIndexBuckets({
        previous,
        replaceFromHourStart: floorToHour(startAt),
        sessions: collection.sessions,
      }),
    });

    return this.deps.repo.upsertHourlyIndex?.(index) ?? index;
  }

  private buildDashboardRecordFromIndex(input: {
    indexedAt: number;
    mode: WorkAnalysisScanMode;
    normalized: WorkAnalysisQuery;
    queryDigest: string;
    requestedAt: number;
    lastStartedAt?: number;
    nextScheduledAt?: number;
    hourlyIndex: WorkAnalysisHourlyIndex;
  }): WorkAnalysisDashboardRecord {
    const timeRange = resolveWorkAnalysisTimeRange(input.normalized.timeRange, input.indexedAt);
    const hourlySessionSlices = selectIndexedSessionsForQuery(
      input.hourlyIndex,
      input.normalized,
      timeRange
    );
    const sessions = mergeIndexedSessionSlices(hourlySessionSlices);
    const availableWorkspacePaths = getAvailableWorkspacePaths(input.hourlyIndex);
    const providerStatuses = mergeIndexProviderStatuses({
      buckets: input.hourlyIndex.buckets,
      providerStatuses: input.hourlyIndex.providerStatuses,
    });
    const collection = buildCollectionFromIndexedSessions({
      sessions,
      providerStatuses,
      sourceDigest: input.hourlyIndex.sourceDigest,
    });
    const scanState: WorkAnalysisDashboardScanState = {
      mode: input.mode,
      status: "succeeded",
      ...(input.lastStartedAt === undefined ? {} : { lastStartedAt: input.lastStartedAt }),
      lastCompletedAt: input.indexedAt,
      ...(input.nextScheduledAt === undefined ? {} : { nextScheduledAt: input.nextScheduledAt }),
      sourceDigest: input.hourlyIndex.sourceDigest,
      providerStatuses,
    };
    const basicResult = this.basicAnalyzer({
      query: input.normalized,
      timeRange,
      availableWorkspacePaths,
      sessions: sessions.map(indexedSessionToAnalyzerSession),
      dataSources: {
        providers: providerStatuses,
      },
      skillInventory: {
        installedSkills: this.deps.skillLibraryRepo.list(),
        mounts: this.deps.skillMountRepo.list(),
      },
    });

    return {
      version: 1,
      queryDigest: input.queryDigest,
      query: input.normalized,
      mode: input.mode,
      requestedAt: input.requestedAt,
      scanState,
      dashboard: buildDashboardProjection({
        generatedAt: input.indexedAt,
        normalized: input.normalized,
        timeRange,
        collection,
        hourlySessions: hourlySessionSlices.map(indexedSessionToWorkLogSession),
        basicResult,
        scanState,
      }),
    };
  }

  private async runBasicWithCollection(query: WorkAnalysisQuery): Promise<{
    record: WorkAnalysisRecord;
    collection: Awaited<ReturnType<WorkLogCollector["collect"]>>;
    skillInventory: {
      installedSkills: Array<{ slug: string }>;
      mounts: Array<{ skillSlug: string; enabled?: boolean }>;
    };
  }> {
    const normalized = normalizeWorkAnalysisQuery(query);
    const queryDigest = buildWorkAnalysisQueryDigest(normalized);
    const existing = this.deps.repo.findByQueryDigest(queryDigest);
    const startedAt = this.now();
    const runningRecord = this.deps.repo.upsert({
      id: existing?.id ?? randomUUID(),
      queryDigest,
      ...(normalized.workspacePaths && normalized.workspacePaths.length > 0
        ? { workspacePaths: normalized.workspacePaths }
        : {}),
      timeRange: normalized.timeRange,
      requestedAt: existing?.requestedAt ?? startedAt,
      basicStatus: "running",
      deepStatus: existing?.deepStatus ?? "idle",
      sourceSnapshot: existing?.sourceSnapshot,
      basicResult: existing?.basicResult,
      deepResult: existing?.deepResult,
      basicErrorMessage: undefined,
      deepErrorMessage: existing?.deepErrorMessage,
      basicCompletedAt: existing?.basicCompletedAt,
      deepCompletedAt: existing?.deepCompletedAt,
    });

    try {
      const timeRange = resolveWorkAnalysisTimeRange(normalized.timeRange, startedAt);
      const { collection, filteredSessions, skillInventory, availableWorkspacePaths } =
        await this.collectForQuery({
          normalized,
          timeRange,
        });
      const providerStatuses = buildProviderStatuses(collection.providers);
      const basicResult = this.basicAnalyzer({
        query: normalized,
        timeRange,
        availableWorkspacePaths,
        sessions: filteredSessions.map((session) => ({
          sessionId: session.sessionId,
          workspacePath: session.workspacePath,
          providerId: session.providerId,
          startedAt: session.startedAt,
          lastActiveAt: session.lastActiveAt,
          modelId: session.modelId,
          usage: session.usage,
          usageCoverage: session.usageCoverage as WorkLogUsageCoverage | undefined,
          userTurnCount: session.userTurnCount,
          assistantTurnCount: session.assistantTurnCount,
          toolUseCount: session.toolUseCount,
          parseErrorCount: session.parseErrorCount,
          timestampQuality: session.timestampQuality,
          events: session.events,
        })),
        dataSources: {
          providers: providerStatuses,
        },
        skillInventory,
      });

      const record = this.deps.repo.upsert({
        ...runningRecord,
        basicStatus: "succeeded",
        basicCompletedAt: this.now(),
        sourceSnapshot: {
          sourceDigest: collection.sourceDigest,
          collectedAt: this.now(),
          providerStatuses: collection.providers.map((provider) => ({
            providerId: provider.providerId,
            status: provider.status,
            sessionCount: provider.sessions.length,
            parseErrorCount: provider.parseErrorCount,
          })),
        },
        basicResult,
        basicErrorMessage: undefined,
      });

      return {
        record,
        collection: {
          ...collection,
          sessions: filteredSessions,
        },
        skillInventory,
      };
    } catch (error) {
      const candidate = error as { message?: string };
      const record = this.deps.repo.upsert({
        ...runningRecord,
        basicStatus: "failed",
        basicCompletedAt: this.now(),
        basicErrorMessage: candidate.message ?? "Basic work analysis failed",
      });

      return {
        record,
        collection: {
          sessions: [],
          providers: [],
          sourceDigest: "",
        },
        skillInventory: {
          installedSkills: [],
          mounts: [],
        },
      };
    }
  }

  private async collectForQuery(input: {
    normalized: WorkAnalysisQuery;
    timeRange: ResolvedWorkAnalysisTimeRange;
  }) {
    const workspacePaths =
      input.normalized.workspacePaths && input.normalized.workspacePaths.length > 0
        ? input.normalized.workspacePaths
        : [];
    const collection = await this.deps.workLogCollector.collect({
      workspacePaths,
      timeRange: input.timeRange,
    });
    const availableWorkspacePaths = [
      ...new Set(collection.sessions.map((session) => session.workspacePath)),
    ].sort((left, right) => left.localeCompare(right));
    const filteredSessions =
      input.normalized.workspacePaths && input.normalized.workspacePaths.length > 0
        ? collection.sessions.filter((session) =>
            input.normalized.workspacePaths!.includes(session.workspacePath)
          )
        : collection.sessions;
    const skillInventory = {
      installedSkills: this.deps.skillLibraryRepo.list(),
      mounts: this.deps.skillMountRepo.list(),
    };

    return { collection, filteredSessions, skillInventory, availableWorkspacePaths };
  }
}

type DashboardProjectionInput = {
  generatedAt: number;
  normalized: WorkAnalysisQuery;
  timeRange: ResolvedWorkAnalysisTimeRange;
  collection: WorkLogCollection;
  hourlySessions?: WorkLogSession[];
  basicResult: WorkAnalysisRecord["basicResult"] | undefined;
  scanState: WorkAnalysisDashboardScanState;
};

type UsageAggregate = {
  sessionCount: number;
  activeDurationMs: number;
  totals: WorkAnalysisUsageTotals;
};

type SkillAggregate = {
  sessionIds: Set<string>;
  providerIds: Set<string>;
  callCount: number;
  label: string;
};

function buildDashboardProjection(
  input: DashboardProjectionInput
): WorkAnalysisDashboardProjection {
  const totals = createEmptyUsageTotals();
  const hourly = new Map<number, UsageAggregate>();
  const daily = new Map<string, UsageAggregate>();
  const projects = new Map<string, UsageAggregate>();
  const models = new Map<string, UsageAggregate>();
  const agents = new Map<string, UsageAggregate>();
  const skills = new Map<string, SkillAggregate>();
  let usageSessionCount = 0;
  let totalDurationMs = 0;

  for (const session of input.collection.sessions) {
    const sessionUsage = normalizeDashboardUsage(session.usage);
    const durationMs = Math.max(0, session.lastActiveAt - session.startedAt);
    totalDurationMs += durationMs;
    mergeUsageTotals(totals, sessionUsage);
    if (sessionUsage.totalTokens > 0 || session.usageCoverage?.hasUsage) {
      usageSessionCount += 1;
    }

    mergeAggregate(
      getAggregate(projects, session.workspacePath || "unknown"),
      sessionUsage,
      durationMs
    );
    mergeAggregate(
      getAggregate(models, `${session.providerId} / ${session.modelId ?? "unknown"}`),
      sessionUsage,
      durationMs
    );
    mergeAggregate(getAggregate(agents, session.providerId), sessionUsage, durationMs);

    for (const event of session.events ?? []) {
      if (!isSkillToolEvent(event)) {
        continue;
      }

      const skillIdentity = resolveSkillIdentity(event);
      const aggregate = getSkillAggregate(skills, skillIdentity.key, skillIdentity.label);
      aggregate.sessionIds.add(session.sessionId);
      aggregate.providerIds.add(session.providerId);
      aggregate.callCount += 1;
    }
  }

  for (const session of input.hourlySessions ?? input.collection.sessions) {
    const sessionUsage = normalizeDashboardUsage(session.usage);
    const durationMs = Math.max(0, session.lastActiveAt - session.startedAt);
    const hourStart = floorToHour(session.startedAt);
    const day = formatUtcDay(session.startedAt);
    mergeAggregate(getAggregate(hourly, hourStart), sessionUsage, durationMs);
    mergeAggregate(getAggregate(daily, day), sessionUsage, durationMs);
  }

  const projectRankings = buildRankings(projects, totals.totalTokens);
  const modelRankings = buildRankings(models, totals.totalTokens);
  const agentRankings = buildRankings(agents, totals.totalTokens);
  const topProjectShare = projectRankings[0]?.shareOfTokens ?? 0;

  const providerWarnings = input.scanState.providerStatuses.flatMap((provider) => {
    if (provider.status !== "partial") {
      return [];
    }

    if (!provider.warnings || provider.warnings.length === 0) {
      return [`${provider.providerId}: provider scan partially failed`];
    }

    return provider.warnings.map((warning) => `${provider.providerId}: ${warning.message}`);
  });

  return {
    projectionVersion: DASHBOARD_PROJECTION_DATA_VERSION,
    generatedAt: input.generatedAt,
    timeRange: input.timeRange,
    filters: input.normalized,
    kpis: [
      {
        key: "totalTokens",
        label: "Total tokens",
        value: totals.totalTokens,
      },
      {
        key: "inputOutput",
        label: "Input / Output",
        value: totals.inputTokens + totals.outputTokens,
        helper: `${formatTokenMetric(totals.inputTokens)} input / ${formatTokenMetric(
          totals.outputTokens
        )} output`,
      },
      {
        key: "sessions",
        label: "Sessions",
        value: input.collection.sessions.length,
        helper: `${usageSessionCount} with usage data`,
      },
      {
        key: "activeTime",
        label: "Active time",
        value: totalDurationMs,
      },
      {
        key: "topProjectShare",
        label: "Top project share",
        value: topProjectShare,
        helper: projectRankings[0]?.label,
      },
    ],
    trends: {
      tokenHourly: [...hourly.entries()]
        .sort(([left], [right]) => left - right)
        .map(([hourStart, aggregate]) => ({
          hourStart,
          ...cloneTotals(aggregate.totals),
          sessionCount: aggregate.sessionCount,
          activeDurationMs: aggregate.activeDurationMs,
        })),
      tokenDaily: [...daily.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, aggregate]) => ({
          day,
          ...cloneTotals(aggregate.totals),
          sessionCount: aggregate.sessionCount,
          activeDurationMs: aggregate.activeDurationMs,
        })),
      hourHeatmap: buildHourHeatmap(hourly),
    },
    rankings: {
      projects: projectRankings,
      models: modelRankings,
      agents: agentRankings,
    },
    breakdowns: {
      tasks: (input.basicResult?.tasks.byType ?? []).map((task) => ({
        key: task.taskType,
        label: task.taskType,
        totalTokens: task.totals.totalTokens,
        shareOfTokens: totals.totalTokens > 0 ? task.totals.totalTokens / totals.totalTokens : 0,
        sessionCount: task.sessionCount,
        activeDurationMs: 0,
      })),
      tools: (input.basicResult?.usage.byTool ?? [])
        .filter((tool) => tool.toolName !== "Skill")
        .map((tool) => ({
          key: tool.toolName,
          label: tool.toolName,
          totalTokens: tool.totals.totalTokens,
          shareOfTokens: totals.totalTokens > 0 ? tool.totals.totalTokens / totals.totalTokens : 0,
          sessionCount: tool.sessionCount,
          activeDurationMs: 0,
          subtitle: `${tool.useCount} uses`,
        })),
      skills: buildSkillBreakdowns(skills),
    },
    quality: {
      providers: input.scanState.providerStatuses,
      warnings: providerWarnings,
    },
  };
}

function normalizeHourlyIndex(index: WorkAnalysisHourlyIndex): WorkAnalysisHourlyIndex {
  return {
    version: 1,
    bucketMode: "hourly_session_slices",
    indexedAt: index.indexedAt,
    indexedThroughHourStart: index.indexedThroughHourStart,
    sourceDigest: index.sourceDigest,
    providerStatuses: index.providerStatuses.map((provider) => ({
      providerId: provider.providerId,
      status: provider.status,
      sessionCount: provider.sessionCount,
      parseErrorCount: provider.parseErrorCount,
      warningCount: provider.warningCount,
      ...(provider.warnings === undefined
        ? {}
        : {
            warnings: provider.warnings.map((warning) => ({
              code: warning.code,
              message: warning.message,
              ...(warning.sourceRef === undefined ? {} : { sourceRef: warning.sourceRef }),
            })),
          }),
    })),
    buckets: index.buckets
      .map((bucket) => ({
        hourStart: bucket.hourStart,
        sessions: bucket.sessions
          .map(normalizeHourlyIndexSession)
          .sort((left, right) => left.startedAt - right.startedAt),
      }))
      .sort((left, right) => left.hourStart - right.hourStart),
  };
}

function normalizeUsableHourlyIndex(
  index: WorkAnalysisHourlyIndex | undefined
): WorkAnalysisHourlyIndex | undefined {
  if (!index || index.bucketMode !== "hourly_session_slices") {
    return undefined;
  }

  return index;
}

function isHourlyIndexFresh(index: WorkAnalysisHourlyIndex, now: number): boolean {
  const latestCompleteHourStart = Math.max(0, floorToHour(now) - HOUR_MS);
  return index.indexedThroughHourStart >= latestCompleteHourStart;
}

function normalizeHourlyIndexSession(
  session: WorkAnalysisHourlyIndexSession
): WorkAnalysisHourlyIndexSession {
  return {
    providerId: session.providerId,
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    sourceRef: session.sourceRef,
    ...(session.title === undefined ? {} : { title: session.title }),
    ...(session.modelId === undefined ? {} : { modelId: session.modelId }),
    ...(session.gitBranch === undefined ? {} : { gitBranch: session.gitBranch }),
    ...(session.gitCommit === undefined ? {} : { gitCommit: session.gitCommit }),
    userTurnCount: session.userTurnCount,
    assistantTurnCount: session.assistantTurnCount,
    toolUseCount: session.toolUseCount,
    ...(session.usage === undefined ? {} : { usage: { ...session.usage } }),
    ...(session.usageCoverage === undefined ? {} : { usageCoverage: { ...session.usageCoverage } }),
    parseErrorCount: session.parseErrorCount,
    timestampQuality: session.timestampQuality,
    ...(session.events === undefined
      ? {}
      : {
          events: session.events.map(compactWorkLogEventForHourlyIndex),
        }),
  };
}

function mergeHourlyIndexBuckets(input: {
  previous: WorkAnalysisHourlyIndex | undefined;
  replaceFromHourStart: number;
  sessions: WorkLogSession[];
}) {
  const buckets = new Map<number, Map<string, WorkAnalysisHourlyIndexSession>>();

  for (const bucket of input.previous?.buckets ?? []) {
    if (bucket.hourStart >= input.replaceFromHourStart) {
      continue;
    }
    buckets.set(
      bucket.hourStart,
      new Map(bucket.sessions.map((session) => [buildIndexedSessionKey(session), session]))
    );
  }

  for (const bucket of buildHourlyIndexBuckets(input.sessions)) {
    const sessionsByKey = buckets.get(bucket.hourStart) ?? new Map();
    for (const session of bucket.sessions) {
      sessionsByKey.set(buildIndexedSessionKey(session), session);
    }
    buckets.set(bucket.hourStart, sessionsByKey);
  }

  return [...buckets.entries()]
    .map(([hourStart, sessionsByKey]) => ({
      hourStart,
      sessions: [...sessionsByKey.values()].sort((left, right) => left.startedAt - right.startedAt),
    }))
    .sort((left, right) => left.hourStart - right.hourStart);
}

function buildHourlyIndexBuckets(sessions: WorkLogSession[]) {
  const buckets = new Map<number, Map<string, WorkAnalysisHourlyIndexSession>>();

  for (const session of sessions) {
    for (const indexedSession of indexHourlySessionSlicesFromWorkLogSession(session)) {
      const hourStart = floorToHour(indexedSession.startedAt);
      const sessionsByKey =
        buckets.get(hourStart) ?? new Map<string, WorkAnalysisHourlyIndexSession>();
      sessionsByKey.set(buildIndexedSessionKey(indexedSession), indexedSession);
      buckets.set(hourStart, sessionsByKey);
    }
  }

  return [...buckets.entries()]
    .map(([hourStart, sessionsByKey]) => ({
      hourStart,
      sessions: [...sessionsByKey.values()].sort((left, right) => left.startedAt - right.startedAt),
    }))
    .sort((left, right) => left.hourStart - right.hourStart);
}

type HourlySessionDraft = {
  events: WorkLogEvent[];
  usage: WorkAnalysisUsageTotals;
  usageCallCount: number;
  callsWithTotalTokens: number;
  estimatedUsageCallCount: number;
};

function indexHourlySessionSlicesFromWorkLogSession(
  session: WorkLogSession
): WorkAnalysisHourlyIndexSession[] {
  const drafts = new Map<number, HourlySessionDraft>();
  const getDraft = (hourStart: number) => {
    let draft = drafts.get(hourStart);
    if (!draft) {
      draft = {
        events: [],
        usage: createEmptyUsageTotals(),
        usageCallCount: 0,
        callsWithTotalTokens: 0,
        estimatedUsageCallCount: 0,
      };
      drafts.set(hourStart, draft);
    }
    return draft;
  };

  for (const event of session.events ?? []) {
    getDraft(floorToHour(resolveEventTimestamp(event, session))).events.push(event);
  }

  for (const allocation of buildHourlyUsageAllocations(session)) {
    const draft = getDraft(allocation.hourStart);
    mergeUsageTotals(draft.usage, allocation.usage);
    draft.usageCallCount += 1;
    if (allocation.usage.totalTokens > 0) {
      draft.callsWithTotalTokens += 1;
    }
    if (allocation.estimated) {
      draft.estimatedUsageCallCount += 1;
    }
  }

  if (drafts.size === 0) {
    const draft = getDraft(floorToHour(session.startedAt));
    if (session.usage) {
      const usage = normalizeDashboardUsage(session.usage);
      mergeUsageTotals(draft.usage, usage);
      if (hasUsageTotals(usage)) {
        draft.usageCallCount = Math.max(1, session.usageCoverage?.callCount ?? 1);
        draft.callsWithTotalTokens =
          session.usageCoverage?.callsWithTotalTokens ?? (usage.totalTokens > 0 ? 1 : 0);
        draft.estimatedUsageCallCount = session.usageCoverage?.estimatedCallCount ?? 0;
      }
    }
  }

  return [...drafts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([hourStart, draft], index) =>
      indexSessionFromWorkLogSession(session, hourStart, draft, index === 0)
    );
}

function indexSessionFromWorkLogSession(
  session: WorkLogSession,
  hourStart: number,
  draft: HourlySessionDraft,
  includeSessionErrors: boolean
): WorkAnalysisHourlyIndexSession {
  const sliceStartedAt = Math.max(hourStart, session.startedAt);
  const sliceLastActiveAt = Math.max(
    sliceStartedAt,
    Math.min(hourStart + HOUR_MS, session.lastActiveAt)
  );
  const hasOriginalEvents = (session.events?.length ?? 0) > 0;
  const usage = hasUsageTotals(draft.usage) ? draft.usage : undefined;

  return normalizeHourlyIndexSession({
    providerId: session.providerId,
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    startedAt: sliceStartedAt,
    lastActiveAt: sliceLastActiveAt,
    sourceRef: session.sourceRef,
    ...(session.title === undefined ? {} : { title: session.title }),
    ...(session.modelId === undefined ? {} : { modelId: session.modelId }),
    ...(session.gitBranch === undefined ? {} : { gitBranch: session.gitBranch }),
    ...(session.gitCommit === undefined ? {} : { gitCommit: session.gitCommit }),
    userTurnCount: hasOriginalEvents
      ? draft.events.filter((event) => event.role === "user").length
      : session.userTurnCount,
    assistantTurnCount: hasOriginalEvents
      ? draft.events.filter((event) => event.role === "assistant").length
      : session.assistantTurnCount,
    toolUseCount: hasOriginalEvents
      ? draft.events.filter(
          (event) => event.canonicalEventType === "tool_call" || event.eventType === "tool"
        ).length
      : session.toolUseCount,
    ...(usage === undefined ? {} : { usage }),
    ...(usage === undefined
      ? {}
      : {
          usageCoverage: {
            hasUsage: true,
            callCount: Math.max(1, draft.usageCallCount),
            callsWithTotalTokens: draft.callsWithTotalTokens,
            estimatedCallCount: draft.estimatedUsageCallCount,
          },
        }),
    parseErrorCount: includeSessionErrors ? session.parseErrorCount : 0,
    timestampQuality: session.timestampQuality,
    ...(draft.events.length === 0 ? {} : { events: draft.events }),
  });
}

function buildHourlyUsageAllocations(session: WorkLogSession): Array<{
  hourStart: number;
  usage: WorkAnalysisUsageTotals;
  estimated: boolean;
}> {
  const events = session.events ?? [];
  const sessionUsage = normalizeDashboardUsage(session.usage);
  const explicitTotal = createEmptyUsageTotals();
  const allocations: Array<{
    hourStart: number;
    usage: WorkAnalysisUsageTotals;
    estimated: boolean;
  }> = [];
  const implicitCandidates: WorkLogEvent[] = [];

  for (const event of events) {
    if (hasTokenUsageValues(event.tokenUsage)) {
      const usage = normalizeDashboardUsage(event.tokenUsage);
      mergeUsageTotals(explicitTotal, usage);
      allocations.push({
        hourStart: floorToHour(resolveEventTimestamp(event, session)),
        usage,
        estimated: false,
      });
      continue;
    }

    if (isHourlyUsageAttributionCandidate(event)) {
      implicitCandidates.push(event);
    }
  }

  const remainingUsage = subtractUsageTotals(sessionUsage, explicitTotal);
  if (!hasUsageTotals(remainingUsage)) {
    return allocations;
  }

  if (implicitCandidates.length === 0) {
    allocations.push({
      hourStart: floorToHour(session.startedAt),
      usage: remainingUsage,
      estimated: (session.usageCoverage?.estimatedCallCount ?? 0) > 0,
    });
    return allocations;
  }

  const splitUsages = splitUsageTotals(remainingUsage, implicitCandidates.length);
  implicitCandidates.forEach((event, index) => {
    const usage = splitUsages[index] ?? createEmptyUsageTotals();
    if (!hasUsageTotals(usage)) {
      return;
    }
    allocations.push({
      hourStart: floorToHour(resolveEventTimestamp(event, session)),
      usage,
      estimated: true,
    });
  });

  return allocations;
}

function resolveEventTimestamp(event: WorkLogEvent, session: WorkLogSession): number {
  return event.occurredAt ?? session.startedAt;
}

function isHourlyUsageAttributionCandidate(event: WorkLogEvent): boolean {
  return Boolean(
    event.toolName ||
      event.commandText ||
      event.canonicalEventType === "usage" ||
      event.canonicalEventType === "message_turn"
  );
}

function hasTokenUsageValues(usage: WorkLogEvent["tokenUsage"] | undefined): boolean {
  if (!usage) {
    return false;
  }

  return Object.values(usage).some((value) => typeof value === "number");
}

function hasUsageTotals(usage: WorkAnalysisUsageTotals): boolean {
  return Object.values(usage).some((value) => value > 0);
}

function subtractUsageTotals(
  left: WorkAnalysisUsageTotals,
  right: WorkAnalysisUsageTotals
): WorkAnalysisUsageTotals {
  return {
    inputTokens: Math.max(0, left.inputTokens - right.inputTokens),
    outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
    cachedInputTokens: Math.max(0, left.cachedInputTokens - right.cachedInputTokens),
    cacheCreationInputTokens: Math.max(
      0,
      left.cacheCreationInputTokens - right.cacheCreationInputTokens
    ),
    cacheReadInputTokens: Math.max(0, left.cacheReadInputTokens - right.cacheReadInputTokens),
    reasoningOutputTokens: Math.max(0, left.reasoningOutputTokens - right.reasoningOutputTokens),
    totalTokens: Math.max(0, left.totalTokens - right.totalTokens),
  };
}

function splitUsageTotals(
  totals: WorkAnalysisUsageTotals,
  partCount: number
): WorkAnalysisUsageTotals[] {
  if (partCount <= 0) {
    return [];
  }

  const parts = Array.from({ length: partCount }, createEmptyUsageTotals);
  for (const key of Object.keys(totals) as Array<keyof WorkAnalysisUsageTotals>) {
    const total = Math.max(0, Math.round(totals[key]));
    const base = Math.trunc(total / partCount);
    const remainder = total - base * partCount;
    for (let index = 0; index < partCount; index += 1) {
      parts[index]![key] = base + (index < remainder ? 1 : 0);
    }
  }

  return parts;
}

function buildIndexedSessionKey(
  session: Pick<WorkAnalysisHourlyIndexSession, "providerId" | "sessionId">
) {
  return `${session.providerId}\u0000${session.sessionId}`;
}

function mergeIndexProviderStatuses(input: {
  buckets: WorkAnalysisHourlyIndex["buckets"];
  providerStatuses: WorkAnalysisDashboardProviderStatus[];
}): WorkAnalysisDashboardProviderStatus[] {
  const sessionIdsByProvider = new Map<string, Set<string>>();
  for (const bucket of input.buckets) {
    for (const session of bucket.sessions) {
      const sessionIds = sessionIdsByProvider.get(session.providerId) ?? new Set<string>();
      sessionIds.add(session.sessionId);
      sessionIdsByProvider.set(session.providerId, sessionIds);
    }
  }

  const statuses = new Map<string, WorkAnalysisDashboardProviderStatus>();
  for (const provider of input.providerStatuses) {
    statuses.set(provider.providerId, {
      ...provider,
      sessionCount: sessionIdsByProvider.get(provider.providerId)?.size ?? provider.sessionCount,
      ...(provider.warnings === undefined
        ? {}
        : { warnings: provider.warnings.map((warning) => ({ ...warning })) }),
    });
  }

  for (const [providerId, sessionIds] of sessionIdsByProvider) {
    if (statuses.has(providerId)) {
      continue;
    }
    statuses.set(providerId, {
      providerId,
      status: "supported",
      sessionCount: sessionIds.size,
      parseErrorCount: 0,
      warningCount: 0,
    });
  }

  return [...statuses.values()];
}

function selectIndexedSessionsForQuery(
  hourlyIndex: WorkAnalysisHourlyIndex,
  query: WorkAnalysisQuery,
  timeRange: ResolvedWorkAnalysisTimeRange
) {
  const workspacePaths =
    query.workspacePaths && query.workspacePaths.length > 0 ? new Set(query.workspacePaths) : null;
  const startHour = floorToHour(timeRange.startAt);
  const endHour = floorToHour(timeRange.endAt);

  return hourlyIndex.buckets
    .filter((bucket) => bucket.hourStart >= startHour && bucket.hourStart <= endHour)
    .flatMap((bucket) => bucket.sessions)
    .filter((session) => !workspacePaths || workspacePaths.has(session.workspacePath))
    .map(normalizeHourlyIndexSession)
    .sort((left, right) => left.startedAt - right.startedAt);
}

function getAvailableWorkspacePaths(hourlyIndex: WorkAnalysisHourlyIndex) {
  return [
    ...new Set(
      hourlyIndex.buckets.flatMap((bucket) =>
        bucket.sessions.map((session) => session.workspacePath)
      )
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function buildCollectionFromIndexedSessions(input: {
  sessions: WorkAnalysisHourlyIndexSession[];
  providerStatuses: WorkAnalysisDashboardProviderStatus[];
  sourceDigest: string;
}): WorkLogCollection {
  const sessions = input.sessions.map(indexedSessionToWorkLogSession);

  return {
    sessions,
    providers: input.providerStatuses.map((provider) => ({
      providerId: provider.providerId as WorkLogSession["providerId"],
      status: provider.status,
      sessions: sessions.filter((session) => session.providerId === provider.providerId),
      sourceRefs: [],
      parseErrorCount: provider.parseErrorCount,
      warnings: provider.warnings ?? [],
    })),
    sourceDigest: input.sourceDigest,
  };
}

function mergeIndexedSessionSlices(
  sessions: WorkAnalysisHourlyIndexSession[]
): WorkAnalysisHourlyIndexSession[] {
  const mergedByKey = new Map<string, WorkAnalysisHourlyIndexSession>();

  for (const session of sessions) {
    const key = buildIndexedSessionKey(session);
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, normalizeHourlyIndexSession(session));
      continue;
    }

    existing.startedAt = Math.min(existing.startedAt, session.startedAt);
    existing.lastActiveAt = Math.max(existing.lastActiveAt, session.lastActiveAt);
    existing.userTurnCount += session.userTurnCount;
    existing.assistantTurnCount += session.assistantTurnCount;
    existing.toolUseCount += session.toolUseCount;
    existing.parseErrorCount += session.parseErrorCount;
    if (session.usage) {
      const usage = normalizeDashboardUsage(existing.usage);
      mergeUsageTotals(usage, normalizeDashboardUsage(session.usage));
      existing.usage = usage;
    }
    if (session.usageCoverage) {
      existing.usageCoverage = {
        hasUsage: Boolean(existing.usageCoverage?.hasUsage || session.usageCoverage.hasUsage),
        callCount: (existing.usageCoverage?.callCount ?? 0) + session.usageCoverage.callCount,
        callsWithTotalTokens:
          (existing.usageCoverage?.callsWithTotalTokens ?? 0) +
          session.usageCoverage.callsWithTotalTokens,
        estimatedCallCount:
          (existing.usageCoverage?.estimatedCallCount ?? 0) +
          session.usageCoverage.estimatedCallCount,
      };
    }
    if (session.events && session.events.length > 0) {
      existing.events = [
        ...(existing.events ?? []),
        ...session.events.map(compactWorkLogEventForHourlyIndex),
      ];
    }
  }

  return [...mergedByKey.values()].sort((left, right) => left.startedAt - right.startedAt);
}

function indexedSessionToWorkLogSession(session: WorkAnalysisHourlyIndexSession): WorkLogSession {
  return {
    providerId: session.providerId,
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    sourceRef: session.sourceRef,
    ...(session.title === undefined ? {} : { title: session.title }),
    ...(session.modelId === undefined ? {} : { modelId: session.modelId }),
    ...(session.gitBranch === undefined ? {} : { gitBranch: session.gitBranch }),
    ...(session.gitCommit === undefined ? {} : { gitCommit: session.gitCommit }),
    userTurnCount: session.userTurnCount,
    assistantTurnCount: session.assistantTurnCount,
    toolUseCount: session.toolUseCount,
    ...(session.usage === undefined ? {} : { usage: { ...session.usage } }),
    ...(session.usageCoverage === undefined ? {} : { usageCoverage: { ...session.usageCoverage } }),
    parseErrorCount: session.parseErrorCount,
    timestampQuality: session.timestampQuality,
    ...(session.events === undefined
      ? {}
      : {
          events: session.events.map(compactWorkLogEventForHourlyIndex),
        }),
  };
}

function indexedSessionToAnalyzerSession(session: WorkAnalysisHourlyIndexSession) {
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    providerId: session.providerId,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    modelId: session.modelId,
    usage: session.usage,
    usageCoverage: session.usageCoverage as WorkLogUsageCoverage | undefined,
    userTurnCount: session.userTurnCount,
    assistantTurnCount: session.assistantTurnCount,
    toolUseCount: session.toolUseCount,
    parseErrorCount: session.parseErrorCount,
    timestampQuality: session.timestampQuality,
    events: session.events,
  };
}

function isSkillToolEvent(event: WorkLogEvent) {
  return (
    event.canonicalEventType === "tool_call" &&
    (event.toolCategory === "skill" || event.toolName === "Skill")
  );
}

function buildProviderStatuses(
  providers: WorkLogCollection["providers"]
): WorkAnalysisDashboardProviderStatus[] {
  return providers.map((provider) => {
    const warnings = normalizeProviderWarnings(provider.warnings);
    return {
      providerId: provider.providerId,
      status: provider.status,
      sessionCount: provider.sessions.length,
      parseErrorCount: provider.parseErrorCount,
      warningCount: provider.warnings.length,
      ...(warnings.length === 0 ? {} : { warnings }),
    };
  });
}

function normalizeProviderWarnings(
  warnings: WorkLogCollection["providers"][number]["warnings"]
): WorkAnalysisProviderWarning[] {
  return warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    ...(warning.sourceRef === undefined ? {} : { sourceRef: warning.sourceRef }),
  }));
}

function createEmptyUsageTotals(): WorkAnalysisUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function cloneTotals(totals: WorkAnalysisUsageTotals): WorkAnalysisUsageTotals {
  return { ...totals };
}

function normalizeUsageValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeDashboardUsage(usage: WorkLogSession["usage"]): WorkAnalysisUsageTotals {
  const totals = {
    inputTokens: normalizeUsageValue(usage?.inputTokens),
    outputTokens: normalizeUsageValue(usage?.outputTokens),
    cachedInputTokens: normalizeUsageValue(usage?.cachedInputTokens),
    cacheCreationInputTokens: normalizeUsageValue(usage?.cacheCreationInputTokens),
    cacheReadInputTokens: normalizeUsageValue(usage?.cacheReadInputTokens),
    reasoningOutputTokens: normalizeUsageValue(usage?.reasoningOutputTokens),
    totalTokens: normalizeUsageValue(usage?.totalTokens),
  };

  if (totals.totalTokens === 0) {
    totals.totalTokens =
      totals.inputTokens +
      totals.outputTokens +
      totals.cacheCreationInputTokens +
      totals.cacheReadInputTokens;
  }

  return totals;
}

function mergeUsageTotals(target: WorkAnalysisUsageTotals, source: WorkAnalysisUsageTotals) {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
}

function getAggregate<K>(map: Map<K, UsageAggregate>, key: K): UsageAggregate {
  let aggregate = map.get(key);
  if (!aggregate) {
    aggregate = {
      sessionCount: 0,
      activeDurationMs: 0,
      totals: createEmptyUsageTotals(),
    };
    map.set(key, aggregate);
  }

  return aggregate;
}

function getSkillAggregate(
  map: Map<string, SkillAggregate>,
  key: string,
  label: string
): SkillAggregate {
  let aggregate = map.get(key);
  if (!aggregate) {
    aggregate = {
      sessionIds: new Set<string>(),
      providerIds: new Set<string>(),
      callCount: 0,
      label,
    };
    map.set(key, aggregate);
  }

  return aggregate;
}

function resolveSkillIdentity(event: WorkLogEvent) {
  const skillName = extractSkillNameFromEvent(event);
  if (!skillName) {
    return {
      key: UNKNOWN_SKILL_KEY,
      label: UNKNOWN_SKILL_LABEL,
    };
  }

  return {
    key: skillName,
    label: skillName,
  };
}

function buildSkillBreakdowns(skills: Map<string, SkillAggregate>) {
  const totalCalls = [...skills.values()].reduce((sum, aggregate) => sum + aggregate.callCount, 0);

  return [...skills.entries()]
    .map(([key, aggregate]) => ({
      key,
      label: aggregate.label,
      callCount: aggregate.callCount,
      sessionCount: aggregate.sessionIds.size,
      shareOfCalls: totalCalls > 0 ? aggregate.callCount / totalCalls : 0,
      providerIds: [...aggregate.providerIds].sort((left, right) => left.localeCompare(right)),
    }))
    .sort(
      (left, right) =>
        right.callCount - left.callCount ||
        right.sessionCount - left.sessionCount ||
        left.label.localeCompare(right.label)
    );
}

function mergeAggregate(
  aggregate: UsageAggregate,
  usage: WorkAnalysisUsageTotals,
  activeDurationMs: number
) {
  aggregate.sessionCount += 1;
  aggregate.activeDurationMs += activeDurationMs;
  mergeUsageTotals(aggregate.totals, usage);
}

function buildRankings(
  map: Map<string, UsageAggregate>,
  totalTokens: number
): WorkAnalysisContributionRank[] {
  return [...map.entries()]
    .map(([key, aggregate]) => ({
      key,
      label: key,
      totalTokens: aggregate.totals.totalTokens,
      shareOfTokens: totalTokens > 0 ? aggregate.totals.totalTokens / totalTokens : 0,
      sessionCount: aggregate.sessionCount,
      activeDurationMs: aggregate.activeDurationMs,
      subtitle: `${aggregate.sessionCount} sessions`,
    }))
    .sort(
      (left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label)
    );
}

function buildHourHeatmap(hourly: Map<number, UsageAggregate>) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalTokens: 0,
    sessionCount: 0,
  }));

  for (const [hourStart, aggregate] of hourly) {
    const hour = new Date(hourStart).getUTCHours();
    buckets[hour]!.totalTokens += aggregate.totals.totalTokens;
    buckets[hour]!.sessionCount += aggregate.sessionCount;
  }

  const maxTokens = Math.max(...buckets.map((bucket) => bucket.totalTokens), 1);
  return buckets.map((bucket) => ({
    ...bucket,
    intensity: bucket.totalTokens / maxTokens,
  }));
}

function floorToHour(timestamp: number): number {
  return Math.floor(timestamp / (60 * 60 * 1000)) * 60 * 60 * 1000;
}

function formatUtcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
