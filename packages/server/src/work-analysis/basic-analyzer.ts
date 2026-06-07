import { workBasicAnalysisResultSchema } from "./basic-schema.js";
import { classifySessionTask, classifyTaskTurn } from "./classification/task-classifier.js";
import { deriveTaskTurns } from "./classification/task-turn-builder.js";
import type { BuiltInProviderId, WorkLogEvent, WorkLogUsageCoverage } from "./log-sources/types.js";
import {
  pickTopCompareDimension,
  summarizeCompareDimension,
  toSharePercent,
} from "./metrics/compare.js";
import {
  type EfficiencyMetricsEvent,
  summarizeEfficiency,
  usageTotalsToEfficiencyInput,
} from "./metrics/token-efficiency.js";
import { buildDailyTrendBuckets } from "./metrics/trends.js";
import {
  getMissedYieldSignals,
  getShippedSignals,
  isShippedSession,
  summarizeTurnBehavior,
  summarizeYield,
} from "./metrics/yield.js";
import { detectOptimizeFindings } from "./optimize/detect-findings.js";
import type {
  WorkAnalysisBreakdownsDomain,
  WorkAnalysisCapabilityLevel,
  WorkAnalysisDataSourcesDomain,
  WorkAnalysisDeliveryDomain,
  WorkAnalysisDimensionBreakdown,
  WorkAnalysisEfficiencyDomain,
  WorkAnalysisOptimizeDomain,
  WorkAnalysisProviderCapability,
  WorkAnalysisSessionsDomain,
  WorkAnalysisTaskTurn,
  WorkAnalysisTaskType,
  WorkAnalysisTimeRange,
  WorkAnalysisUsageTotals,
  WorkBasicAnalysisResultV2,
} from "./types.js";

type BasicAnalyzerQuery = {
  workspacePaths?: string[];
  timeRange: WorkAnalysisTimeRange;
};

type BasicAnalyzerTimeRange = {
  startAt: number;
  endAt: number;
  label: string;
};

type BasicAnalyzerSession = {
  sessionId: string;
  workspacePath?: string;
  workspaceId?: string;
  providerId: BuiltInProviderId;
  startedAt: number;
  lastActiveAt: number;
  userTurnCount?: number;
  assistantTurnCount?: number;
  toolUseCount?: number;
  modelId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningOutputTokens?: number;
    totalTokens?: number;
  };
  usageCoverage?: WorkLogUsageCoverage;
  parseErrorCount?: number;
  timestampQuality?: "explicit" | "file_mtime" | "mixed";
  events?: WorkLogEvent[];
};

type BasicAnalyzerInstalledSkill = {
  slug: string;
};

type BasicAnalyzerMount = {
  skillSlug: string;
  enabled?: boolean;
};

type BasicAnalyzerInput = {
  query: BasicAnalyzerQuery;
  timeRange: BasicAnalyzerTimeRange;
  availableWorkspacePaths: string[];
  sessions: BasicAnalyzerSession[];
  dataSources?: {
    providers: Array<{
      providerId: string;
      status: "supported" | "no_logs" | "missing_root" | "partial" | "unsupported";
      sessionCount: number;
      parseErrorCount: number;
      warningCount: number;
    }>;
  };
  capabilityMatrix?: {
    providers: WorkAnalysisProviderCapability[];
  };
  skillInventory: {
    installedSkills: BasicAnalyzerInstalledSkill[];
    mounts: BasicAnalyzerMount[];
  };
};

export function analyzeWorkBasic(input: BasicAnalyzerInput) {
  const providerIds = new Set(input.sessions.map((session) => session.providerId));
  const providerSessionCounts = new Map<string, number>();
  let clampedDurationCount = 0;
  const durations = input.sessions.map((session) => {
    providerSessionCounts.set(
      session.providerId,
      (providerSessionCounts.get(session.providerId) ?? 0) + 1
    );
    const duration = session.lastActiveAt - session.startedAt;
    if (duration < 0) {
      clampedDurationCount += 1;
      return 0;
    }
    return duration;
  });
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const userTurnCount = input.sessions.reduce(
    (sum, session) => sum + (session.userTurnCount ?? 0),
    0
  );
  const assistantTurnCount = input.sessions.reduce(
    (sum, session) => sum + (session.assistantTurnCount ?? 0),
    0
  );
  const toolUseCount = input.sessions.reduce(
    (sum, session) => sum + (session.toolUseCount ?? 0),
    0
  );
  const fileMtimeTimestampCount = input.sessions.filter(
    (session) => session.timestampQuality === "file_mtime"
  ).length;
  const installedSkillSlugs = new Set(
    input.skillInventory.installedSkills.map((skill) => skill.slug)
  );
  const mountedInstalledSkillSlugs = new Set(
    input.skillInventory.mounts
      .filter((mount) => mount.enabled !== false && installedSkillSlugs.has(mount.skillSlug))
      .map((mount) => mount.skillSlug)
  );
  const hourCounts = new Map<number, number>();
  const usageTotals = createEmptyUsageTotals();
  let usageSessionCount = 0;
  let usageCallCount = 0;
  let usageCallsWithTotalTokens = 0;
  let estimatedUsageCallCount = 0;
  const providerStatusById = new Map(
    (input.dataSources?.providers ?? []).map(
      (provider) => [provider.providerId, provider.status] as const
    )
  );
  const usageByDay = new Map<string, { sessionCount: number; totals: WorkAnalysisUsageTotals }>();
  const usageByHour = new Map<number, { sessionCount: number; totals: WorkAnalysisUsageTotals }>();
  const usageByProvider = new Map<
    string,
    { sessionCount: number; totals: WorkAnalysisUsageTotals }
  >();
  const usageByWorkspace = new Map<
    string,
    { sessionCount: number; totals: WorkAnalysisUsageTotals }
  >();
  const usageByModel = new Map<
    string,
    { modelId: string; providerId: string; sessionCount: number; totals: WorkAnalysisUsageTotals }
  >();
  const usageByTool = new Map<
    string,
    { sessionIds: Set<string>; useCount: number; totals: WorkAnalysisUsageTotals }
  >();
  const usageByCommand = new Map<
    string,
    { sessionIds: Set<string>; useCount: number; totals: WorkAnalysisUsageTotals }
  >();
  const taskByType = new Map<
    WorkAnalysisTaskType,
    {
      turnCount: number;
      sessionIds: Set<string>;
      totals: WorkAnalysisUsageTotals;
      providerIds: Set<string>;
      modelIds: Set<string>;
      workspacePaths: Set<string>;
    }
  >();
  const taskByTypeAndModel = new Map<
    string,
    {
      taskType: WorkAnalysisTaskType;
      providerId: string;
      modelId: string;
      turnCount: number;
      sessionIds: Set<string>;
      totals: WorkAnalysisUsageTotals;
    }
  >();
  const taskByTypeAndWorkspace = new Map<
    string,
    {
      taskType: WorkAnalysisTaskType;
      workspacePath: string;
      turnCount: number;
      sessionIds: Set<string>;
      totals: WorkAnalysisUsageTotals;
    }
  >();
  const taskTurns: WorkAnalysisTaskTurn[] = [];
  const sessionTaskSummaries: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    modelId?: string;
    primaryTask: WorkAnalysisTaskType;
    signals: string[];
    totalTokens: number;
  }> = [];
  const efficiencyInputs: Array<ReturnType<typeof usageTotalsToEfficiencyInput>> = [];
  const efficiencyInputsByTask = new Map<
    WorkAnalysisTaskType,
    Array<ReturnType<typeof usageTotalsToEfficiencyInput>>
  >();
  const yieldInputs: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    taskType: WorkAnalysisTaskType;
    totals: WorkAnalysisUsageTotals;
    hasEditSignal: boolean;
    hasCommandSignal: boolean;
    hasGitSignal: boolean;
    retries?: number;
  }> = [];
  const yieldInputsByTask = new Map<
    WorkAnalysisTaskType,
    Array<{
      sessionId: string;
      providerId: string;
      workspacePath: string;
      taskType: WorkAnalysisTaskType;
      totals: WorkAnalysisUsageTotals;
      hasEditSignal: boolean;
      hasCommandSignal: boolean;
      hasGitSignal: boolean;
      retries?: number;
    }>
  >();
  const sessionOptimizeInputs: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    taskType: WorkAnalysisTaskType;
    supportsLowYieldInference: boolean;
    toolUseCount: number;
    parseErrorCount: number;
    totals: WorkAnalysisUsageTotals;
    hasCommandSignal: boolean;
    hasEditSignal: boolean;
    hasGitSignal: boolean;
  }> = [];
  const sessionInsights: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    modelId?: string;
    taskType: WorkAnalysisTaskType;
    totalTokens: number;
    outputTokens: number;
    durationMs: number;
    shippedSignals: string[];
    missedSignals: string[];
  }> = [];
  const topSessionsByTotalTokens: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    modelId?: string;
    totalTokens: number;
  }> = [];

  for (const session of input.sessions) {
    const hour = new Date(session.startedAt).getUTCHours();
    const day = formatUtcDay(session.startedAt);
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    const sessionUsage = normalizeUsageTotals(session.usage);
    const sessionHasUsage = hasUsageCoverage(session);
    if (sessionHasUsage) {
      usageSessionCount += 1;
      usageCallCount += session.usageCoverage?.callCount ?? 1;
      usageCallsWithTotalTokens +=
        session.usageCoverage?.callsWithTotalTokens ?? (sessionUsage.totalTokens > 0 ? 1 : 0);
      estimatedUsageCallCount += session.usageCoverage?.estimatedCallCount ?? 0;
    }
    mergeUsageTotals(usageTotals, sessionUsage);

    const dayUsage = getOrCreateAggregate(usageByDay, day, () => ({
      sessionCount: 0,
      totals: createEmptyUsageTotals(),
    }));
    dayUsage.sessionCount += 1;
    mergeUsageTotals(dayUsage.totals, sessionUsage);

    const hourUsage = getOrCreateAggregate(usageByHour, hour, () => ({
      sessionCount: 0,
      totals: createEmptyUsageTotals(),
    }));
    hourUsage.sessionCount += 1;
    mergeUsageTotals(hourUsage.totals, sessionUsage);

    const providerUsage = getOrCreateAggregate(usageByProvider, session.providerId, () => ({
      sessionCount: 0,
      totals: createEmptyUsageTotals(),
    }));
    providerUsage.sessionCount += 1;
    mergeUsageTotals(providerUsage.totals, sessionUsage);

    const workspaceUsage = getOrCreateAggregate(
      usageByWorkspace,
      session.workspacePath ?? "unknown",
      () => ({
        sessionCount: 0,
        totals: createEmptyUsageTotals(),
      })
    );
    workspaceUsage.sessionCount += 1;
    mergeUsageTotals(workspaceUsage.totals, sessionUsage);

    if (session.modelId) {
      const modelKey = `${session.providerId}\u0000${session.modelId}`;
      const modelUsage = getOrCreateAggregate(usageByModel, modelKey, () => ({
        modelId: session.modelId!,
        providerId: session.providerId,
        sessionCount: 0,
        totals: createEmptyUsageTotals(),
      }));
      modelUsage.sessionCount += 1;
      mergeUsageTotals(modelUsage.totals, sessionUsage);
    }

    for (const { commandLabel, event, usage } of buildUsageAttributionEvents(
      session.events ?? [],
      sessionUsage
    )) {
      if (event.toolName) {
        const toolUsage = getOrCreateAggregate(usageByTool, event.toolName, () => ({
          sessionIds: new Set<string>(),
          useCount: 0,
          totals: createEmptyUsageTotals(),
        }));
        toolUsage.sessionIds.add(session.sessionId);
        toolUsage.useCount += 1;
        mergeUsageTotals(toolUsage.totals, usage);
      }

      if (commandLabel) {
        const commandUsage = getOrCreateAggregate(usageByCommand, commandLabel, () => ({
          sessionIds: new Set<string>(),
          useCount: 0,
          totals: createEmptyUsageTotals(),
        }));
        commandUsage.sessionIds.add(session.sessionId);
        commandUsage.useCount += 1;
        mergeUsageTotals(commandUsage.totals, usage);
      }
    }

    const hasCommandSignal = (session.events ?? []).some((event) => event.eventType === "command");
    const hasEditSignal = (session.events ?? []).some((event) => event.eventType === "edit");
    const hasGitSignal = (session.events ?? []).some((event) => event.eventType === "git");

    const derivedTurns = deriveTaskTurns({
      providerId: session.providerId,
      sessionId: session.sessionId,
      workspacePath: session.workspacePath ?? "",
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      sourceRef: "",
      modelId: session.modelId,
      userTurnCount: session.userTurnCount ?? 0,
      assistantTurnCount: session.assistantTurnCount ?? 0,
      toolUseCount: session.toolUseCount ?? 0,
      parseErrorCount: session.parseErrorCount ?? 0,
      timestampQuality: session.timestampQuality ?? "mixed",
      events: session.events ?? [],
    });
    const classifiedTurns = derivedTurns.map((turn) => ({
      turn,
      classification: classifyTaskTurn({
        turnId: turn.turnId,
        userMessage: turn.userMessage,
        toolNames: turn.toolNames,
        commandTexts: turn.commandTexts,
        toolSteps: turn.toolSteps,
        filePaths: turn.filePaths,
        hasPlanMode: turn.hasPlanMode,
        hasAgentSpawn: turn.hasAgentSpawn,
        hasEdits: turn.hasEdits,
        hasReads: turn.hasReads,
        hasSearch: turn.hasSearch,
        hasTaskTools: turn.hasTaskTools,
        hasSkillTool: turn.hasSkillTool,
        hasMcpTools: turn.hasMcpTools,
      }),
    }));
    const taskClassification = classifySessionTask({
      providerId: session.providerId,
      workspacePath: session.workspacePath,
      modelId: session.modelId,
      userTurnCount: session.userTurnCount,
      assistantTurnCount: session.assistantTurnCount,
      toolUseCount: session.toolUseCount,
      events: session.events,
    });
    const turnUsageTotals = splitUsageAcrossTurns(sessionUsage, classifiedTurns.length);
    for (const { turn, classification } of classifiedTurns) {
      const taskSummary = getOrCreateAggregate(taskByType, classification.primaryTask, () => ({
        turnCount: 0,
        sessionIds: new Set<string>(),
        totals: createEmptyUsageTotals(),
        providerIds: new Set<string>(),
        modelIds: new Set<string>(),
        workspacePaths: new Set<string>(),
      }));
      taskSummary.turnCount += 1;
      taskSummary.sessionIds.add(session.sessionId);
      taskSummary.providerIds.add(session.providerId);
      if (session.modelId) {
        taskSummary.modelIds.add(session.modelId);
      }
      if (session.workspacePath) {
        taskSummary.workspacePaths.add(session.workspacePath);
      }
      mergeUsageTotals(taskSummary.totals, turnUsageTotals);

      if (session.modelId) {
        const byModelKey = `${classification.primaryTask}\u0000${session.providerId}\u0000${session.modelId}`;
        const taskByModel = getOrCreateAggregate(taskByTypeAndModel, byModelKey, () => ({
          taskType: classification.primaryTask,
          providerId: session.providerId,
          modelId: session.modelId!,
          turnCount: 0,
          sessionIds: new Set<string>(),
          totals: createEmptyUsageTotals(),
        }));
        taskByModel.turnCount += 1;
        taskByModel.sessionIds.add(session.sessionId);
        mergeUsageTotals(taskByModel.totals, turnUsageTotals);
      }

      const byWorkspaceKey = `${classification.primaryTask}\u0000${session.workspacePath ?? ""}`;
      const taskByWorkspace = getOrCreateAggregate(taskByTypeAndWorkspace, byWorkspaceKey, () => ({
        taskType: classification.primaryTask,
        workspacePath: session.workspacePath ?? "",
        turnCount: 0,
        sessionIds: new Set<string>(),
        totals: createEmptyUsageTotals(),
      }));
      taskByWorkspace.turnCount += 1;
      taskByWorkspace.sessionIds.add(session.sessionId);
      mergeUsageTotals(taskByWorkspace.totals, turnUsageTotals);

      taskTurns.push({
        turnId: turn.turnId,
        sessionId: session.sessionId,
        providerId: session.providerId,
        workspacePath: session.workspacePath ?? "",
        ...(session.modelId ? { modelId: session.modelId } : {}),
        primaryTask: classification.primaryTask,
        secondaryTasks: classification.secondaryTasks,
        evidence: classification.evidence,
        userMessage: turn.userMessage,
        toolNames: turn.toolNames,
        commandTexts: turn.commandTexts,
        hasEdits: classification.hasEdits,
        retries: classification.retries,
        totalTokens: turnUsageTotals.totalTokens,
        ...(typeof turn.startedAt === "number" ? { startedAt: turn.startedAt } : {}),
      });

      const efficiencyByTaskEntry = usageTotalsToEfficiencyInput({
        sessionId: turn.turnId,
        providerId: session.providerId,
        taskType: classification.primaryTask,
        totals: turnUsageTotals,
        toolUseCount: turn.toolNames.length,
        hasCommandSignal: turn.commandTexts.length > 0,
        hasEditSignal: classification.hasEdits,
        events: toTurnEfficiencyMetricEvents(turn),
      });
      const efficiencyByTaskBucket = efficiencyInputsByTask.get(classification.primaryTask) ?? [];
      efficiencyByTaskBucket.push(efficiencyByTaskEntry);
      efficiencyInputsByTask.set(classification.primaryTask, efficiencyByTaskBucket);

      const yieldByTaskEntry = {
        sessionId: turn.turnId,
        providerId: session.providerId,
        workspacePath: session.workspacePath ?? "",
        taskType: classification.primaryTask,
        totals: turnUsageTotals,
        hasEditSignal: classification.hasEdits,
        hasCommandSignal: turn.commandTexts.length > 0,
        hasGitSignal: turn.hasGitSignal,
        retries: classification.retries,
      };
      const yieldByTaskBucket = yieldInputsByTask.get(classification.primaryTask) ?? [];
      yieldByTaskBucket.push(yieldByTaskEntry);
      yieldInputsByTask.set(classification.primaryTask, yieldByTaskBucket);
    }
    const dominantTurnTask =
      pickDominantTaskFromTurns(classifiedTurns, turnUsageTotals.totalTokens) ??
      taskClassification.primaryTask;
    sessionTaskSummaries.push({
      sessionId: session.sessionId,
      providerId: session.providerId,
      workspacePath: session.workspacePath ?? "",
      ...(session.modelId ? { modelId: session.modelId } : {}),
      primaryTask: dominantTurnTask,
      signals: taskClassification.signals,
      totalTokens: sessionUsage.totalTokens,
    });
    efficiencyInputs.push(
      usageTotalsToEfficiencyInput({
        sessionId: session.sessionId,
        providerId: session.providerId,
        taskType: dominantTurnTask,
        totals: sessionUsage,
        toolUseCount: session.toolUseCount ?? 0,
        hasCommandSignal,
        hasEditSignal,
        events: toEfficiencyMetricEvents(session.events),
      })
    );
    yieldInputs.push({
      sessionId: session.sessionId,
      providerId: session.providerId,
      workspacePath: session.workspacePath ?? "",
      taskType: dominantTurnTask,
      totals: sessionUsage,
      hasEditSignal,
      hasCommandSignal,
      hasGitSignal,
      retries: 0,
    });
    sessionOptimizeInputs.push({
      sessionId: session.sessionId,
      providerId: session.providerId,
      workspacePath: session.workspacePath ?? "",
      taskType: dominantTurnTask,
      supportsLowYieldInference: supportsLowYieldInference(
        session.providerId,
        providerStatusById.get(session.providerId)
      ),
      toolUseCount: session.toolUseCount ?? 0,
      parseErrorCount: session.parseErrorCount ?? 0,
      totals: sessionUsage,
      hasCommandSignal,
      hasEditSignal,
      hasGitSignal,
    });
    const yieldSignalsInput = {
      sessionId: session.sessionId,
      providerId: session.providerId,
      workspacePath: session.workspacePath ?? "",
      taskType: dominantTurnTask,
      totals: sessionUsage,
      hasEditSignal,
      hasCommandSignal,
      hasGitSignal,
    };
    sessionInsights.push({
      sessionId: session.sessionId,
      providerId: session.providerId,
      workspacePath: session.workspacePath ?? "",
      ...(session.modelId ? { modelId: session.modelId } : {}),
      taskType: dominantTurnTask,
      totalTokens: sessionUsage.totalTokens,
      outputTokens: sessionUsage.outputTokens,
      durationMs: Math.max(0, session.lastActiveAt - session.startedAt),
      shippedSignals: getShippedSignals(yieldSignalsInput),
      missedSignals: getMissedYieldSignals(yieldSignalsInput),
    });

    if (sessionUsage.totalTokens > 0) {
      topSessionsByTotalTokens.push({
        sessionId: session.sessionId,
        providerId: session.providerId,
        workspacePath: session.workspacePath ?? "",
        ...(session.modelId ? { modelId: session.modelId } : {}),
        totalTokens: sessionUsage.totalTokens,
      });
    }
  }

  const capabilityProviders = (
    input.capabilityMatrix?.providers ??
    buildDefaultCapabilityMatrix(input.dataSources?.providers ?? [])
  )
    .slice()
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
  const efficiencyByProvider = new Map<string, typeof efficiencyInputs>();
  const efficiencyByTask = new Map<WorkAnalysisTaskType, typeof efficiencyInputs>();
  for (const entry of efficiencyInputs) {
    const providerBucket = efficiencyByProvider.get(entry.providerId) ?? [];
    providerBucket.push(entry);
    efficiencyByProvider.set(entry.providerId, providerBucket);

    const taskBucket = efficiencyByTask.get(entry.taskType) ?? [];
    taskBucket.push(entry);
    efficiencyByTask.set(entry.taskType, taskBucket);
  }
  const optimizeFindings = detectOptimizeFindings({
    sessions: sessionOptimizeInputs,
    providers: [...usageByProvider.entries()].map(([providerId, value]) => ({
      providerId,
      sessionCount: value.sessionCount,
      totals: value.totals,
    })),
  });
  const compareWorkspace = summarizeCompareDimension(
    [...usageByWorkspace.entries()].map(([workspacePath, value]) => ({
      key: workspacePath,
      label: workspacePath,
      sessionCount: value.sessionCount,
      totals: value.totals,
    })),
    usageTotals.totalTokens
  );
  const compareProvider = summarizeCompareDimension(
    [...usageByProvider.entries()].map(([providerId, value]) => ({
      key: providerId,
      label: providerId,
      sessionCount: value.sessionCount,
      totals: value.totals,
    })),
    usageTotals.totalTokens
  );
  const compareModelEntries = [...usageByModel.values()].map((value) => ({
    key: `${value.providerId}\u0000${value.modelId}`,
    label: `${value.providerId} / ${value.modelId}`,
    providerId: value.providerId,
    modelId: value.modelId,
    sessionCount: value.sessionCount,
    totals: value.totals,
  }));
  const compareModelMetadata = new Map(
    compareModelEntries.map((entry) => [entry.key, entry] as const)
  );
  const compareModel = summarizeCompareDimension(
    compareModelEntries.map((value) => ({
      key: value.key,
      label: value.label,
      sessionCount: value.sessionCount,
      totals: value.totals,
    })),
    usageTotals.totalTokens
  );
  const compareTask = summarizeCompareDimension(
    [...taskByType.entries()].map(([taskType, value]) => ({
      key: taskType,
      label: taskType,
      sessionCount: value.sessionIds.size,
      totals: value.totals,
    })),
    usageTotals.totalTokens
  );
  const yieldByWorkspace = new Map<string, typeof yieldInputs>();
  const yieldByTask = new Map<WorkAnalysisTaskType, typeof yieldInputs>();
  for (const entry of yieldInputs) {
    const workspaceBucket = yieldByWorkspace.get(entry.workspacePath) ?? [];
    workspaceBucket.push(entry);
    yieldByWorkspace.set(entry.workspacePath, workspaceBucket);

    const taskBucket = yieldByTask.get(entry.taskType) ?? [];
    taskBucket.push(entry);
    yieldByTask.set(entry.taskType, taskBucket);
  }
  const yieldOverall = summarizeYield(yieldInputs);
  const dailyActivity = buildDailyTrendBuckets(usageByDay.entries());
  const compareWorkspaces = compareWorkspace.map((entry) => ({
    key: entry.key,
    label: entry.label,
    workspacePath: entry.key,
    sessionCount: entry.sessionCount,
    totalTokens: entry.totals.totalTokens,
    shareOfTokens: entry.shareOfTokens,
    sharePercent: toSharePercent(entry.shareOfTokens),
    averageTokensPerSession: entry.averageTokensPerSession,
    averageOutputShare: entry.averageOutputShare,
  }));
  const compareProviders = compareProvider.map((entry) => ({
    key: entry.key,
    label: entry.label,
    providerId: entry.key,
    sessionCount: entry.sessionCount,
    totalTokens: entry.totals.totalTokens,
    shareOfTokens: entry.shareOfTokens,
    sharePercent: toSharePercent(entry.shareOfTokens),
    averageTokensPerSession: entry.averageTokensPerSession,
    averageOutputShare: entry.averageOutputShare,
  }));
  const compareModels = compareModel.map((entry) => {
    const source = compareModelMetadata.get(entry.key);
    return {
      key: entry.key,
      label: entry.label,
      providerId: source?.providerId ?? "",
      modelId: source?.modelId ?? entry.label,
      sessionCount: entry.sessionCount,
      totalTokens: entry.totals.totalTokens,
      shareOfTokens: entry.shareOfTokens,
      sharePercent: toSharePercent(entry.shareOfTokens),
      averageTokensPerSession: entry.averageTokensPerSession,
      averageOutputShare: entry.averageOutputShare,
    };
  });
  const compareTasks = compareTask.map((entry) => ({
    key: entry.key,
    label: entry.label,
    taskType: entry.key as WorkAnalysisTaskType,
    sessionCount: entry.sessionCount,
    totalTokens: entry.totals.totalTokens,
    shareOfTokens: entry.shareOfTokens,
    sharePercent: toSharePercent(entry.shareOfTokens),
    averageTokensPerSession: entry.averageTokensPerSession,
    averageOutputShare: entry.averageOutputShare,
  }));
  const yieldSummary = {
    overall: yieldOverall,
    byWorkspace: [...yieldByWorkspace.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([workspacePath, sessions]) => ({
        workspacePath,
        summary: summarizeYield(sessions),
      })),
    byTask: [...yieldInputsByTask.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([taskType, sessions]) => ({
        taskType,
        summary: summarizeYield(sessions),
        turnBehavior: summarizeTurnBehavior(sessions),
      })),
    topShippedSessions: yieldInputs
      .filter(isShippedSession)
      .sort(
        (left, right) =>
          right.totals.totalTokens - left.totals.totalTokens ||
          left.sessionId.localeCompare(right.sessionId)
      )
      .slice(0, 10)
      .map((session) => ({
        sessionId: session.sessionId,
        providerId: session.providerId,
        workspacePath: session.workspacePath,
        taskType: session.taskType,
        totalTokens: session.totals.totalTokens,
        shippedSignals: getShippedSignals(session),
      })),
    lowYieldSessions: yieldInputs
      .filter((session) => !isShippedSession(session) && session.totals.totalTokens > 0)
      .sort(
        (left, right) =>
          right.totals.totalTokens - left.totals.totalTokens ||
          left.sessionId.localeCompare(right.sessionId)
      )
      .slice(0, 10)
      .map((session) => ({
        sessionId: session.sessionId,
        providerId: session.providerId,
        workspacePath: session.workspacePath,
        taskType: session.taskType,
        totalTokens: session.totals.totalTokens,
        missedSignals: getMissedYieldSignals(session),
      })),
    limitations: [
      "Yield is inferred from edit, command, git, and output-token signals.",
      "Provider logs without edit or git events will under-report shipped work.",
    ],
  };
  const dataQuality = {
    clampedDurationCount,
    emptySessionCount: input.sessions.length === 0 ? 1 : 0,
  };
  const usageCoverage =
    usageSessionCount > 0
      ? {
          sessionCount: usageSessionCount,
          callCount: usageCallCount,
          callsWithTotalTokens: usageCallsWithTotalTokens,
          estimatedCallCount: estimatedUsageCallCount,
          sessionCoverageRate:
            input.sessions.length > 0 ? usageSessionCount / input.sessions.length : 0,
        }
      : undefined;
  const breakdowns: WorkAnalysisBreakdownsDomain = {
    byWorkspace: compareWorkspace.map((entry) => ({
      ...entry,
      relatedProviders: sessionTaskSummaries
        .filter((session) => session.workspacePath === entry.label)
        .map((session) => session.providerId)
        .filter(onlyUnique),
      relatedModels: sessionTaskSummaries
        .filter((session) => session.workspacePath === entry.label)
        .map((session) => session.modelId)
        .filter(isDefined)
        .filter(onlyUnique),
    })),
    byProvider: compareProvider.map((entry) => ({
      ...entry,
      relatedWorkspacePaths: sessionTaskSummaries
        .filter((session) => session.providerId === entry.key)
        .map((session) => session.workspacePath)
        .filter(onlyUnique),
      relatedModels: sessionTaskSummaries
        .filter((session) => session.providerId === entry.key)
        .map((session) => session.modelId)
        .filter(isDefined)
        .filter(onlyUnique),
    })),
    byModel: compareModel.map((entry) => ({
      ...entry,
      relatedProviders: [compareModelMetadata.get(entry.key)?.providerId ?? ""].filter(Boolean),
      relatedWorkspacePaths: sessionTaskSummaries
        .filter((session) => session.modelId && entry.label.endsWith(session.modelId))
        .map((session) => session.workspacePath)
        .filter(onlyUnique),
    })),
    byTask: compareTask.map((entry) => ({
      ...entry,
      relatedProviders: taskByType.get(entry.key as WorkAnalysisTaskType)
        ? [...(taskByType.get(entry.key as WorkAnalysisTaskType)?.providerIds ?? [])].sort()
        : [],
      relatedModels: taskByType.get(entry.key as WorkAnalysisTaskType)
        ? [...(taskByType.get(entry.key as WorkAnalysisTaskType)?.modelIds ?? [])].sort()
        : [],
      relatedWorkspacePaths: taskByType.get(entry.key as WorkAnalysisTaskType)
        ? [...(taskByType.get(entry.key as WorkAnalysisTaskType)?.workspacePaths ?? [])].sort()
        : [],
    })),
    byTool: [...usageByTool.entries()]
      .sort(compareUsageEntriesByUseCount)
      .map(([toolName, value]) => ({
        key: toolName,
        label: toolName,
        sessionCount: value.sessionIds.size,
        useCount: value.useCount,
        totals: value.totals,
      }))
      .slice(0, 12),
    byCommand: [...usageByCommand.entries()]
      .sort(compareUsageEntriesByUseCount)
      .map(([commandLabel, value]) => ({
        key: commandLabel,
        label: commandLabel,
        sessionCount: value.sessionIds.size,
        useCount: value.useCount,
        totals: value.totals,
      }))
      .slice(0, 12),
  };
  const efficiencySummary: WorkAnalysisEfficiencyDomain = {
    overall: summarizeEfficiency(efficiencyInputs),
    byProvider: [...efficiencyByProvider.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerId, sessions]) => ({
        providerId,
        summary: summarizeEfficiency(sessions),
      })),
    byTask: [...efficiencyInputsByTask.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([taskType, sessions]) => {
        const baseSummary = summarizeEfficiency(sessions);
        const turnBehavior = summarizeTurnBehavior(yieldInputsByTask.get(taskType) ?? []);

        return {
          taskType,
          summary: {
            ...baseSummary,
            oneShotRate: turnBehavior.editTurnCount > 0 ? turnBehavior.oneShotRate : 0,
            retryRate: turnBehavior.editTurnCount > 0 ? turnBehavior.retryRate : 0,
          },
        };
      }),
  };
  const optimizeSummary: WorkAnalysisOptimizeDomain = {
    totalFindings: optimizeFindings.length,
    totalEstimatedWastedTokens: optimizeFindings.reduce(
      (sum, finding) => sum + finding.estimatedWastedTokens,
      0
    ),
    findings: optimizeFindings,
  };
  const deliverySummary: WorkAnalysisDeliveryDomain = {
    yield: yieldSummary,
  };
  const dataSourcesSummary: WorkAnalysisDataSourcesDomain = {
    providers: input.dataSources?.providers.map((provider) => ({ ...provider })) ?? [],
    dataQuality,
  };
  const sessionsSummary: WorkAnalysisSessionsDomain = {
    featured: {
      topByTotalTokens: sessionInsights
        .slice()
        .sort(compareSessionInsightsByTotalTokens)
        .slice(0, 10),
      topByOutputTokens: sessionInsights
        .slice()
        .sort(compareSessionInsightsByOutputTokens)
        .slice(0, 10),
      lowYield: sessionInsights
        .filter((session) => session.totalTokens > 0 && session.missedSignals.length > 0)
        .sort(compareSessionInsightsByTotalTokens)
        .slice(0, 10),
      topShipped: sessionInsights
        .filter((session) => session.shippedSignals.length > 0)
        .sort(compareSessionInsightsByTotalTokens)
        .slice(0, 10),
    },
  };
  const snapshotV2: WorkBasicAnalysisResultV2 = {
    version: 2,
    query: {
      timeRangeLabel: input.timeRange.label,
      selectedWorkspacePaths: input.query.workspacePaths ?? [],
      availableWorkspacePaths: [...input.availableWorkspacePaths],
    },
    overview: {
      totals: {
        ...usageTotals,
        sessionCount: input.sessions.length,
        workspaceCount:
          input.query.workspacePaths && input.query.workspacePaths.length > 0
            ? input.query.workspacePaths.length
            : input.availableWorkspacePaths.length,
        providerCount: providerIds.size,
        taskTypeCount: taskByType.size,
      },
      activity: {
        totalDurationMs,
        averageDurationMs:
          input.sessions.length > 0 ? Math.round(totalDurationMs / input.sessions.length) : 0,
        byDay: [...usageByDay.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([day, value]) => ({
            day,
            sessionCount: value.sessionCount,
            totals: value.totals,
          })),
        byHour: [...usageByHour.entries()]
          .sort(([left], [right]) => left - right)
          .map(([hour, value]) => ({
            hour,
            sessionCount: value.sessionCount,
            totals: value.totals,
          })),
      },
      shares: {
        topDimension: pickTopCompareDimension({
          workspace: compareWorkspace,
          provider: compareProvider,
          model: compareModel,
          task: compareTask,
        }),
        items: pickOverviewShareItems({
          workspace: compareWorkspace,
          provider: compareProvider,
          model: compareModel,
          task: compareTask,
        }).slice(0, 5),
      },
      coverage: {
        sessionCount: input.sessions.length,
        workspaceCount:
          input.query.workspacePaths && input.query.workspacePaths.length > 0
            ? input.query.workspacePaths.length
            : input.availableWorkspacePaths.length,
        providerCount: providerIds.size,
        timeRangeLabel: input.timeRange.label,
        ...(usageCoverage ? { usage: usageCoverage } : {}),
      },
    },
    breakdowns,
    sessions: sessionsSummary,
    tasks: {
      turns: taskTurns
        .slice()
        .sort(
          (left, right) =>
            right.totalTokens - left.totalTokens ||
            (right.startedAt ?? 0) - (left.startedAt ?? 0) ||
            left.turnId.localeCompare(right.turnId)
        )
        .slice(0, 200),
      byType: [...taskByType.entries()]
        .sort(compareTaskAggregateEntries)
        .map(([taskType, value]) => ({
          taskType,
          turnCount: value.turnCount,
          sessionCount: value.sessionIds.size,
          totals: value.totals,
          providerIds: [...value.providerIds].sort(),
          modelIds: [...value.modelIds].sort(),
          workspacePaths: [...value.workspacePaths].sort(),
        })),
      byTypeAndModel: [...taskByTypeAndModel.values()]
        .sort(compareTaskSummaryByModel)
        .map((value) => ({
          taskType: value.taskType,
          providerId: value.providerId,
          modelId: value.modelId,
          turnCount: value.turnCount,
          sessionCount: value.sessionIds.size,
          totals: value.totals,
        })),
      byTypeAndWorkspace: [...taskByTypeAndWorkspace.values()]
        .sort(compareTaskSummaryByWorkspace)
        .map((value) => ({
          taskType: value.taskType,
          workspacePath: value.workspacePath,
          turnCount: value.turnCount,
          sessionCount: value.sessionIds.size,
          totals: value.totals,
        })),
    },
    efficiency: efficiencySummary,
    optimize: optimizeSummary,
    delivery: deliverySummary,
    capabilities: {
      providers: capabilityProviders,
      skillInventory: {
        installedCount: input.skillInventory.installedSkills.length,
        mountedCount: mountedInstalledSkillSlugs.size,
        unmountedCount: Math.max(0, installedSkillSlugs.size - mountedInstalledSkillSlugs.size),
      },
    },
    dataSources: dataSourcesSummary,
  };

  const result = {
    availableWorkspacePaths: [...input.availableWorkspacePaths],
    snapshotV2,
    capabilityMatrix: {
      providers: capabilityProviders,
    },
    coverage: {
      workspaceCount:
        input.query.workspacePaths && input.query.workspacePaths.length > 0
          ? input.query.workspacePaths.length
          : input.availableWorkspacePaths.length,
      sessionCount: input.sessions.length,
      providerCount: providerIds.size,
      timeRangeLabel: input.timeRange.label,
      ...(usageCoverage ? { usage: usageCoverage } : {}),
    },
    activity: {
      sessionCount: input.sessions.length,
      totalDurationMs,
      averageDurationMs:
        input.sessions.length > 0 ? Math.round(totalDurationMs / input.sessions.length) : 0,
      daily: dailyActivity,
    },
    workHabits: {
      hourBuckets: [...hourCounts.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([hour, sessionCount]) => ({ hour, sessionCount })),
    },
    skillInventory: {
      installedCount: input.skillInventory.installedSkills.length,
      mountedCount: mountedInstalledSkillSlugs.size,
      unmountedCount: Math.max(0, installedSkillSlugs.size - mountedInstalledSkillSlugs.size),
    },
    usage: {
      totalSessions: input.sessions.length,
      sessionsByProvider: Object.fromEntries(
        [...providerSessionCounts.entries()].sort(([left], [right]) => left.localeCompare(right))
      ),
      totals: usageTotals,
      byDay: [...usageByDay.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, value]) => ({
          day,
          sessionCount: value.sessionCount,
          totals: value.totals,
        })),
      byHour: [...usageByHour.entries()]
        .sort(([left], [right]) => left - right)
        .map(([hour, value]) => ({
          hour,
          sessionCount: value.sessionCount,
          totals: value.totals,
        })),
      byProvider: [...usageByProvider.entries()]
        .sort(compareAggregateEntries)
        .map(([providerId, value]) => ({
          providerId,
          sessionCount: value.sessionCount,
          totals: value.totals,
        })),
      byWorkspace: [...usageByWorkspace.entries()]
        .sort(compareAggregateEntries)
        .map(([workspacePath, value]) => ({
          workspacePath,
          sessionCount: value.sessionCount,
          totals: value.totals,
        })),
      byModel: [...usageByModel.values()]
        .sort(
          (left, right) =>
            right.totals.totalTokens - left.totals.totalTokens ||
            right.sessionCount - left.sessionCount ||
            left.providerId.localeCompare(right.providerId) ||
            left.modelId.localeCompare(right.modelId)
        )
        .map((value) => ({
          modelId: value.modelId,
          providerId: value.providerId,
          sessionCount: value.sessionCount,
          totals: value.totals,
        })),
      byTool: [...usageByTool.entries()]
        .sort(compareUsageEntriesByUseCount)
        .map(([toolName, value]) => ({
          toolName,
          sessionCount: value.sessionIds.size,
          useCount: value.useCount,
          totals: value.totals,
        }))
        .slice(0, 12),
      byCommand: [...usageByCommand.entries()]
        .sort(compareUsageEntriesByUseCount)
        .map(([commandLabel, value]) => ({
          commandLabel,
          sessionCount: value.sessionIds.size,
          useCount: value.useCount,
          totals: value.totals,
        }))
        .slice(0, 12),
      topSessionsByTotalTokens: topSessionsByTotalTokens
        .sort(
          (left, right) =>
            right.totalTokens - left.totalTokens ||
            left.providerId.localeCompare(right.providerId) ||
            left.sessionId.localeCompare(right.sessionId)
        )
        .slice(0, 10),
    },
    tasks: {
      turns: taskTurns
        .slice()
        .sort(
          (left, right) =>
            right.totalTokens - left.totalTokens ||
            (right.startedAt ?? 0) - (left.startedAt ?? 0) ||
            left.turnId.localeCompare(right.turnId)
        )
        .slice(0, 200),
      byType: [...taskByType.entries()]
        .sort(compareTaskAggregateEntries)
        .map(([taskType, value]) => ({
          taskType,
          turnCount: value.turnCount,
          sessionCount: value.sessionIds.size,
          totals: value.totals,
          providerIds: [...value.providerIds].sort(),
          modelIds: [...value.modelIds].sort(),
          workspacePaths: [...value.workspacePaths].sort(),
        })),
      byTypeAndModel: [...taskByTypeAndModel.values()]
        .sort(compareTaskSummaryByModel)
        .map((value) => ({
          taskType: value.taskType,
          providerId: value.providerId,
          modelId: value.modelId,
          turnCount: value.turnCount,
          sessionCount: value.sessionIds.size,
          totals: value.totals,
        })),
      byTypeAndWorkspace: [...taskByTypeAndWorkspace.values()]
        .sort(compareTaskSummaryByWorkspace)
        .map((value) => ({
          taskType: value.taskType,
          workspacePath: value.workspacePath,
          turnCount: value.turnCount,
          sessionCount: value.sessionIds.size,
          totals: value.totals,
        })),
      sessions: sessionTaskSummaries
        .sort(
          (left, right) =>
            right.totalTokens - left.totalTokens ||
            left.primaryTask.localeCompare(right.primaryTask) ||
            left.sessionId.localeCompare(right.sessionId)
        )
        .slice(0, 24),
    },
    efficiency: {
      overall: efficiencySummary.overall,
      byProvider: efficiencySummary.byProvider,
      byTask: efficiencySummary.byTask,
    },
    optimize: optimizeSummary,
    compare: {
      topDimension: pickTopCompareDimension({
        workspace: compareWorkspace,
        provider: compareProvider,
        model: compareModel,
        task: compareTask,
      }),
      workspaces: compareWorkspaces,
      providers: compareProviders,
      models: compareModels,
      tasks: compareTasks,
      dimensions: {
        workspace: compareWorkspace,
        provider: compareProvider,
        model: compareModel,
        task: compareTask,
      },
    },
    yield: yieldSummary,
    agentModelMix: {
      providers: [...providerSessionCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([providerId, sessionCount]) => ({ providerId, sessionCount })),
    },
    workSurface: {
      workspacePaths:
        input.query.workspacePaths && input.query.workspacePaths.length > 0
          ? [...input.query.workspacePaths]
          : [...input.availableWorkspacePaths],
    },
    executionSignals: {
      sessionsWithActivity: durations.filter((duration) => duration > 0).length,
      userTurnCount,
      assistantTurnCount,
      toolUseCount,
      fileMtimeTimestampCount,
    },
    dataSources: {
      providers: dataSourcesSummary.providers,
    },
    dataQuality,
  };

  return workBasicAnalysisResultSchema.parse(result);
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

function normalizeUsageTotals(
  usage: BasicAnalyzerSession["usage"] | undefined
): WorkAnalysisUsageTotals {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
    reasoningOutputTokens: usage?.reasoningOutputTokens ?? 0,
    totalTokens:
      usage?.totalTokens ??
      (usage?.inputTokens ?? 0) +
        (usage?.outputTokens ?? 0) +
        (usage?.cachedInputTokens ?? 0) +
        (usage?.cacheCreationInputTokens ?? 0) +
        (usage?.cacheReadInputTokens ?? 0),
  };
}

function hasUsageCoverage(session: BasicAnalyzerSession) {
  if (session.usageCoverage?.hasUsage) {
    return true;
  }

  return Object.values(session.usage ?? {}).some((value) => value !== undefined);
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

const usageTotalKeys: Array<keyof WorkAnalysisUsageTotals> = [
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];

function buildUsageAttributionEvents(
  events: WorkLogEvent[],
  sessionUsage: WorkAnalysisUsageTotals
): Array<{
  event: WorkLogEvent;
  commandLabel?: string;
  usage: WorkAnalysisUsageTotals;
}> {
  const candidates = events
    .map((event) => ({
      event,
      commandLabel: normalizeCommandLabel(event.commandText),
    }))
    .filter(({ commandLabel, event }) => event.toolName || commandLabel);
  if (candidates.length === 0) {
    return [];
  }

  const explicitUsages = candidates.map(({ event }) =>
    hasTokenUsageValues(event.tokenUsage) ? normalizeUsageTotals(event.tokenUsage) : undefined
  );
  const explicitTotal = createEmptyUsageTotals();
  for (const usage of explicitUsages) {
    if (usage) {
      mergeUsageTotals(explicitTotal, usage);
    }
  }

  const implicitUsages = splitUsageTotals(
    subtractUsageTotals(sessionUsage, explicitTotal),
    explicitUsages.filter((usage) => !usage).length
  );
  let implicitIndex = 0;

  return candidates.map((candidate, index) => ({
    event: candidate.event,
    ...(candidate.commandLabel ? { commandLabel: candidate.commandLabel } : {}),
    usage: explicitUsages[index] ?? implicitUsages[implicitIndex++] ?? createEmptyUsageTotals(),
  }));
}

function hasTokenUsageValues(usage: WorkLogEvent["tokenUsage"] | undefined) {
  if (!usage) {
    return false;
  }

  return Object.values(usage).some((value) => typeof value === "number");
}

function subtractUsageTotals(
  left: WorkAnalysisUsageTotals,
  right: WorkAnalysisUsageTotals
): WorkAnalysisUsageTotals {
  return Object.fromEntries(
    usageTotalKeys.map((key) => [key, Math.max(0, left[key] - right[key])])
  ) as unknown as WorkAnalysisUsageTotals;
}

function splitUsageTotals(
  totals: WorkAnalysisUsageTotals,
  partCount: number
): WorkAnalysisUsageTotals[] {
  if (partCount <= 0) {
    return [];
  }

  const parts = Array.from({ length: partCount }, createEmptyUsageTotals);
  for (const key of usageTotalKeys) {
    const total = Math.max(0, Math.round(totals[key]));
    const base = Math.trunc(total / partCount);
    const remainder = total - base * partCount;
    for (let index = 0; index < partCount; index += 1) {
      const part = parts[index];
      if (part) {
        part[key] = base + (index < remainder ? 1 : 0);
      }
    }
  }

  return parts;
}

function getOrCreateAggregate<K, T>(map: Map<K, T>, key: K, create: () => T): T {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const next = create();
  map.set(key, next);
  return next;
}

function compareAggregateEntries<
  T extends { sessionCount: number; totals: WorkAnalysisUsageTotals },
>(left: [string, T], right: [string, T]) {
  return (
    right[1].totals.totalTokens - left[1].totals.totalTokens ||
    right[1].sessionCount - left[1].sessionCount ||
    left[0].localeCompare(right[0])
  );
}

function compareTaskAggregateEntries(
  left: [string, { turnCount: number; sessionIds: Set<string>; totals: WorkAnalysisUsageTotals }],
  right: [string, { turnCount: number; sessionIds: Set<string>; totals: WorkAnalysisUsageTotals }]
) {
  return (
    right[1].totals.totalTokens - left[1].totals.totalTokens ||
    right[1].turnCount - left[1].turnCount ||
    right[1].sessionIds.size - left[1].sessionIds.size ||
    left[0].localeCompare(right[0])
  );
}

function compareTaskSummaryByModel(
  left: {
    taskType: WorkAnalysisTaskType;
    providerId: string;
    modelId: string;
    turnCount: number;
    sessionIds: Set<string>;
    totals: WorkAnalysisUsageTotals;
  },
  right: {
    taskType: WorkAnalysisTaskType;
    providerId: string;
    modelId: string;
    turnCount: number;
    sessionIds: Set<string>;
    totals: WorkAnalysisUsageTotals;
  }
) {
  return (
    right.totals.totalTokens - left.totals.totalTokens ||
    right.turnCount - left.turnCount ||
    right.sessionIds.size - left.sessionIds.size ||
    left.taskType.localeCompare(right.taskType) ||
    left.providerId.localeCompare(right.providerId) ||
    left.modelId.localeCompare(right.modelId)
  );
}

function compareTaskSummaryByWorkspace(
  left: {
    taskType: WorkAnalysisTaskType;
    workspacePath: string;
    turnCount: number;
    sessionIds: Set<string>;
    totals: WorkAnalysisUsageTotals;
  },
  right: {
    taskType: WorkAnalysisTaskType;
    workspacePath: string;
    turnCount: number;
    sessionIds: Set<string>;
    totals: WorkAnalysisUsageTotals;
  }
) {
  return (
    right.totals.totalTokens - left.totals.totalTokens ||
    right.turnCount - left.turnCount ||
    right.sessionIds.size - left.sessionIds.size ||
    left.taskType.localeCompare(right.taskType) ||
    left.workspacePath.localeCompare(right.workspacePath)
  );
}

function compareUsageEntriesByUseCount<
  T extends { sessionIds: Set<string>; useCount: number; totals: WorkAnalysisUsageTotals },
>(left: [string, T], right: [string, T]) {
  return (
    right[1].totals.totalTokens - left[1].totals.totalTokens ||
    right[1].useCount - left[1].useCount ||
    right[1].sessionIds.size - left[1].sessionIds.size ||
    left[0].localeCompare(right[0])
  );
}

function splitUsageAcrossTurns(
  totals: WorkAnalysisUsageTotals,
  turnCount: number
): WorkAnalysisUsageTotals {
  if (turnCount <= 1) {
    return { ...totals };
  }

  return {
    inputTokens: Math.round(totals.inputTokens / turnCount),
    outputTokens: Math.round(totals.outputTokens / turnCount),
    cachedInputTokens: Math.round(totals.cachedInputTokens / turnCount),
    cacheCreationInputTokens: Math.round(totals.cacheCreationInputTokens / turnCount),
    cacheReadInputTokens: Math.round(totals.cacheReadInputTokens / turnCount),
    reasoningOutputTokens: Math.round(totals.reasoningOutputTokens / turnCount),
    totalTokens: Math.round(totals.totalTokens / turnCount),
  };
}

function pickDominantTaskFromTurns(
  classifiedTurns: Array<{
    classification: { primaryTask: WorkAnalysisTaskType };
  }>,
  turnTotalTokens: number
): WorkAnalysisTaskType | undefined {
  if (classifiedTurns.length === 0) {
    return undefined;
  }

  const taskWeights = new Map<WorkAnalysisTaskType, number>();
  for (const { classification } of classifiedTurns) {
    taskWeights.set(
      classification.primaryTask,
      (taskWeights.get(classification.primaryTask) ?? 0) + Math.max(turnTotalTokens, 1)
    );
  }

  return [...taskWeights.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  )[0]?.[0];
}

function compareSessionInsightsByTotalTokens(
  left: { totalTokens: number; sessionId: string },
  right: { totalTokens: number; sessionId: string }
) {
  return right.totalTokens - left.totalTokens || left.sessionId.localeCompare(right.sessionId);
}

function compareSessionInsightsByOutputTokens(
  left: { outputTokens: number; totalTokens: number; sessionId: string },
  right: { outputTokens: number; totalTokens: number; sessionId: string }
) {
  return (
    right.outputTokens - left.outputTokens ||
    right.totalTokens - left.totalTokens ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

function pickOverviewShareItems(input: {
  workspace: WorkAnalysisDimensionBreakdown[];
  provider: WorkAnalysisDimensionBreakdown[];
  model: WorkAnalysisDimensionBreakdown[];
  task: WorkAnalysisDimensionBreakdown[];
}) {
  const topDimension = pickTopCompareDimension(input);
  if (topDimension === "provider") {
    return input.provider.map((entry) => ({
      key: entry.key,
      label: entry.label,
      shareOfTokens: entry.shareOfTokens,
      totalTokens: entry.totals.totalTokens,
    }));
  }
  if (topDimension === "model") {
    return input.model.map((entry) => ({
      key: entry.key,
      label: entry.label,
      shareOfTokens: entry.shareOfTokens,
      totalTokens: entry.totals.totalTokens,
    }));
  }
  if (topDimension === "task") {
    return input.task.map((entry) => ({
      key: entry.key,
      label: entry.label,
      shareOfTokens: entry.shareOfTokens,
      totalTokens: entry.totals.totalTokens,
    }));
  }
  return input.workspace.map((entry) => ({
    key: entry.key,
    label: entry.label,
    shareOfTokens: entry.shareOfTokens,
    totalTokens: entry.totals.totalTokens,
  }));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function onlyUnique<T>(value: T, index: number, items: T[]) {
  return items.indexOf(value) === index;
}

function formatUtcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeCommandLabel(commandText: string | undefined) {
  if (!commandText) {
    return undefined;
  }
  const trimmed = commandText.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.split(/\s+/).slice(0, 3).join(" ").slice(0, 80);
}

function toEfficiencyMetricEvents(
  events: WorkLogEvent[] | undefined
): EfficiencyMetricsEvent[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  const mapped = events.flatMap((event) => {
    const canonicalEventType = mapEfficiencyCanonicalEventType(event);
    if (!canonicalEventType) {
      return [];
    }

    return [
      {
        canonicalEventType,
        ...(canonicalEventType === "message_turn" ? { role: event.role } : {}),
        ...(canonicalEventType === "usage"
          ? {
              inputTokens: event.tokenUsage?.inputTokens ?? 0,
              totalTokens: event.tokenUsage?.totalTokens ?? 0,
              cachedInputTokens: event.tokenUsage?.cachedInputTokens ?? 0,
              cacheCreationInputTokens: event.tokenUsage?.cacheCreationInputTokens ?? 0,
              cacheReadInputTokens: event.tokenUsage?.cacheReadInputTokens ?? 0,
            }
          : {}),
      },
    ];
  });

  return mapped.length > 0 ? mapped : undefined;
}

function toTurnEfficiencyMetricEvents(turn: {
  commandTexts: string[];
  hasEdits: boolean;
  hasGitSignal: boolean;
  userMessage?: string | null;
}): EfficiencyMetricsEvent[] | undefined {
  const events: EfficiencyMetricsEvent[] = [];

  if ((turn.userMessage ?? "").trim().length > 0) {
    events.push({ canonicalEventType: "message_turn", role: "user" });
  }
  if (turn.commandTexts.length > 0) {
    events.push({ canonicalEventType: "command" });
  }
  if (turn.hasEdits) {
    events.push({ canonicalEventType: "edit" });
  }
  if (turn.hasGitSignal) {
    events.push({ canonicalEventType: "git_signal" });
  }

  return events.length > 0 ? events : undefined;
}

function mapEfficiencyCanonicalEventType(
  event: WorkLogEvent
): EfficiencyMetricsEvent["canonicalEventType"] | undefined {
  if (
    event.canonicalEventType === "message_turn" ||
    event.canonicalEventType === "command" ||
    event.canonicalEventType === "edit" ||
    event.canonicalEventType === "git_signal" ||
    event.canonicalEventType === "usage"
  ) {
    return event.canonicalEventType;
  }
  if (event.eventType === "message") {
    return "message_turn";
  }
  if (event.eventType === "command") {
    return "command";
  }
  if (event.eventType === "edit") {
    return "edit";
  }
  if (event.eventType === "git") {
    return "git_signal";
  }
  if (event.eventType === "usage") {
    return "usage";
  }
  return undefined;
}

function supportsLowYieldInference(
  providerId: string,
  providerStatus: "supported" | "no_logs" | "missing_root" | "partial" | "unsupported" | undefined
) {
  if (providerStatus && providerStatus !== "supported") {
    return false;
  }

  return providerId === "codex" || providerId === "claude";
}

function buildDefaultCapabilityMatrix(
  providers: Array<{ providerId: string }>
): WorkAnalysisProviderCapability[] {
  return providers.map((provider) => inferProviderCapability(provider.providerId));
}

function inferProviderCapability(providerId: string): WorkAnalysisProviderCapability {
  const full: WorkAnalysisCapabilityLevel = "full";
  const partial: WorkAnalysisCapabilityLevel = "partial";
  const none: WorkAnalysisCapabilityLevel = "none";

  if (providerId === "codex") {
    return {
      providerId,
      workspacePath: full,
      timestamps: full,
      sessionCounts: full,
      toolCounts: full,
      modelIdentity: full,
      tokenUsage: partial,
      cacheUsage: partial,
      reasoningUsage: partial,
      costEstimation: none,
    };
  }
  if (providerId === "claude") {
    return {
      providerId,
      workspacePath: full,
      timestamps: full,
      sessionCounts: full,
      toolCounts: full,
      modelIdentity: partial,
      tokenUsage: partial,
      cacheUsage: partial,
      reasoningUsage: partial,
      costEstimation: none,
    };
  }
  if (providerId === "gemini") {
    return {
      providerId,
      workspacePath: full,
      timestamps: full,
      sessionCounts: full,
      toolCounts: none,
      modelIdentity: none,
      tokenUsage: none,
      cacheUsage: none,
      reasoningUsage: none,
      costEstimation: none,
    };
  }
  if (providerId === "cursor") {
    return {
      providerId,
      workspacePath: full,
      timestamps: partial,
      sessionCounts: full,
      toolCounts: full,
      modelIdentity: none,
      tokenUsage: none,
      cacheUsage: none,
      reasoningUsage: none,
      costEstimation: none,
    };
  }
  if (providerId === "opencode") {
    return {
      providerId,
      workspacePath: full,
      timestamps: full,
      sessionCounts: full,
      toolCounts: full,
      modelIdentity: full,
      tokenUsage: partial,
      cacheUsage: partial,
      reasoningUsage: partial,
      costEstimation: partial,
    };
  }

  return {
    providerId,
    workspacePath: partial,
    timestamps: partial,
    sessionCounts: partial,
    toolCounts: none,
    modelIdentity: none,
    tokenUsage: none,
    cacheUsage: none,
    reasoningUsage: none,
    costEstimation: none,
  };
}
