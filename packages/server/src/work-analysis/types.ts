import type { WorkLogEvent, WorkLogSession, WorkLogUsageCoverage } from "./log-sources/types.js";

export type WorkAnalysisStatus = "idle" | "running" | "succeeded" | "failed";

export type WorkAnalysisPresetRange = "24h" | "7d" | "30d" | "90d";

export interface WorkAnalysisQuery {
  workspacePaths?: string[];
  timeRange: WorkAnalysisTimeRange;
}

export interface ResolvedWorkAnalysisTimeRange {
  startAt: number;
  endAt: number;
  label: string;
}

export type WorkAnalysisTimeRange =
  | { preset: WorkAnalysisPresetRange }
  | { startAt: number; endAt: number };

export interface WorkAnalysisSourceSnapshot {
  sourceDigest: string;
  providerStatuses: Array<{
    providerId: string;
    status: string;
    sessionCount: number;
    parseErrorCount: number;
  }>;
  collectedAt: number;
}

export interface WorkAnalysisProviderWarning {
  code: string;
  message: string;
  sourceRef?: string;
}

export interface WorkAnalysisRecord {
  id: string;
  queryDigest: string;
  workspacePaths?: string[];
  timeRange: WorkAnalysisTimeRange;
  requestedAt?: number;
  basicCompletedAt?: number;
  deepCompletedAt?: number;
  basicStatus: WorkAnalysisStatus;
  deepStatus: WorkAnalysisStatus;
  basicErrorMessage?: string;
  deepErrorMessage?: string;
  sourceSnapshot?: WorkAnalysisSourceSnapshot;
  basicResult?: WorkBasicAnalysisResult;
  deepResult?: WorkDeepAnalysisResult;
}

export type WorkAnalysisScanMode = "manual" | "auto";

export interface WorkAnalysisDashboardProviderStatus {
  providerId: string;
  status: "supported" | "no_logs" | "missing_root" | "partial" | "unsupported";
  sessionCount: number;
  parseErrorCount: number;
  warningCount: number;
  warnings?: WorkAnalysisProviderWarning[];
}

export interface WorkAnalysisDashboardScanState {
  mode: WorkAnalysisScanMode;
  status: WorkAnalysisStatus;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  nextScheduledAt?: number;
  errorMessage?: string;
  sourceDigest?: string;
  providerStatuses: WorkAnalysisDashboardProviderStatus[];
}

export interface WorkAnalysisDashboardKpi {
  key: "totalTokens" | "inputOutput" | "sessions" | "activeTime" | "topProjectShare";
  label: string;
  value: number;
  displayValue?: string;
  helper?: string;
}

export interface WorkAnalysisTokenTrendPoint extends WorkAnalysisUsageTotals {
  hourStart?: number;
  day?: string;
  sessionCount: number;
  activeDurationMs: number;
}

export interface WorkAnalysisHourHeatPoint {
  hour: number;
  totalTokens: number;
  sessionCount: number;
  intensity: number;
}

export interface WorkAnalysisContributionRank {
  key: string;
  label: string;
  totalTokens: number;
  shareOfTokens: number;
  sessionCount: number;
  activeDurationMs: number;
  subtitle?: string;
}

export interface WorkAnalysisSkillBreakdown {
  key: string;
  label: string;
  callCount: number;
  sessionCount: number;
  shareOfCalls: number;
  providerIds: string[];
}

export interface WorkAnalysisDataQualitySummary {
  providers: WorkAnalysisDashboardProviderStatus[];
  warnings: string[];
}

export interface WorkAnalysisDashboardProjection {
  projectionVersion?: number;
  generatedAt: number;
  timeRange: ResolvedWorkAnalysisTimeRange;
  filters: WorkAnalysisQuery;
  kpis: WorkAnalysisDashboardKpi[];
  trends: {
    tokenHourly: WorkAnalysisTokenTrendPoint[];
    tokenDaily: WorkAnalysisTokenTrendPoint[];
    hourHeatmap: WorkAnalysisHourHeatPoint[];
  };
  rankings: {
    projects: WorkAnalysisContributionRank[];
    models: WorkAnalysisContributionRank[];
    agents: WorkAnalysisContributionRank[];
  };
  breakdowns: {
    tasks: WorkAnalysisContributionRank[];
    tools: WorkAnalysisContributionRank[];
    skills?: WorkAnalysisSkillBreakdown[];
  };
  quality: WorkAnalysisDataQualitySummary;
}

export interface WorkAnalysisDashboardRecord {
  version: 1;
  queryDigest: string;
  query: WorkAnalysisQuery;
  mode: WorkAnalysisScanMode;
  requestedAt: number;
  scanState: WorkAnalysisDashboardScanState;
  dashboard?: WorkAnalysisDashboardProjection;
}

export interface WorkAnalysisHourlyIndexSession {
  providerId: WorkLogSession["providerId"];
  sessionId: string;
  workspacePath: string;
  startedAt: number;
  lastActiveAt: number;
  sourceRef: string;
  title?: string;
  modelId?: string;
  gitBranch?: string;
  gitCommit?: string;
  userTurnCount: number;
  assistantTurnCount: number;
  toolUseCount: number;
  usage?: WorkLogSession["usage"];
  usageCoverage?: WorkLogUsageCoverage;
  parseErrorCount: number;
  timestampQuality: WorkLogSession["timestampQuality"];
  events?: WorkLogEvent[];
}

export interface WorkAnalysisHourlyIndexBucket {
  hourStart: number;
  sessions: WorkAnalysisHourlyIndexSession[];
}

export interface WorkAnalysisHourlyIndex {
  version: 1;
  bucketMode?: "hourly_session_slices";
  indexedAt: number;
  indexedThroughHourStart: number;
  sourceDigest: string;
  providerStatuses: WorkAnalysisDashboardProviderStatus[];
  buckets: WorkAnalysisHourlyIndexBucket[];
}

export interface WorkAnalysisHourBucket {
  hour: number;
  sessionCount: number;
}

export type WorkAnalysisCapabilityLevel = "full" | "partial" | "none";

export interface WorkAnalysisProviderCapability {
  providerId: string;
  workspacePath: WorkAnalysisCapabilityLevel;
  timestamps: WorkAnalysisCapabilityLevel;
  sessionCounts: WorkAnalysisCapabilityLevel;
  toolCounts: WorkAnalysisCapabilityLevel;
  modelIdentity: WorkAnalysisCapabilityLevel;
  tokenUsage: WorkAnalysisCapabilityLevel;
  cacheUsage: WorkAnalysisCapabilityLevel;
  reasoningUsage: WorkAnalysisCapabilityLevel;
  costEstimation: WorkAnalysisCapabilityLevel;
}

export interface WorkAnalysisUsageCoverageSummary {
  sessionCount: number;
  callCount: number;
  callsWithTotalTokens: number;
  estimatedCallCount: number;
  sessionCoverageRate: number;
}

export interface WorkAnalysisUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export type WorkAnalysisTaskType =
  | "coding"
  | "debugging"
  | "feature_dev"
  | "refactoring"
  | "testing"
  | "exploration"
  | "planning"
  | "delegation"
  | "git_ops"
  | "build_deploy"
  | "brainstorming"
  | "conversation"
  | "general";

export interface WorkAnalysisTaskSummary {
  taskType: WorkAnalysisTaskType;
  turnCount?: number;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
  providerIds: string[];
  modelIds: string[];
  workspacePaths: string[];
}

export interface WorkAnalysisTaskTurn {
  turnId: string;
  sessionId: string;
  providerId: string;
  workspacePath: string;
  modelId?: string;
  primaryTask: WorkAnalysisTaskType;
  secondaryTasks: WorkAnalysisTaskType[];
  evidence: string[];
  userMessage?: string | null;
  toolNames: string[];
  commandTexts: string[];
  hasEdits: boolean;
  retries: number;
  totalTokens: number;
  startedAt?: number;
}

export interface WorkAnalysisTaskSummaryByModel {
  taskType: WorkAnalysisTaskType;
  providerId: string;
  modelId: string;
  turnCount: number;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
}

export interface WorkAnalysisTaskSummaryByWorkspace {
  taskType: WorkAnalysisTaskType;
  workspacePath: string;
  turnCount: number;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
}

export interface WorkAnalysisTasksDomain {
  turns: WorkAnalysisTaskTurn[];
  byType: WorkAnalysisTaskSummary[];
  byTypeAndModel: WorkAnalysisTaskSummaryByModel[];
  byTypeAndWorkspace: WorkAnalysisTaskSummaryByWorkspace[];
}

export interface WorkAnalysisEfficiencySummary {
  sessionCount: number;
  averageTokensPerSession: number;
  averageInputTokensPerSession: number;
  averageOutputTokensPerSession: number;
  averageTokensPerToolUse: number;
  commandSessionRate: number;
  cacheParticipationRate: number;
  editSignalCoverageRate: number;
  highTokenSessionRate: number;
  toolHeavySessionCount: number;
  oneShotRate: number;
  retryRate: number;
  selfCorrectionRate: number;
  readToEditRatio: number;
  commandToEditRatio: number;
  cacheHitShare: number;
  gitAwareSessionRate: number;
}

export interface WorkAnalysisOptimizeFinding {
  id: string;
  type:
    | "provider_missing_usage"
    | "tool_heavy_low_output"
    | "cache_heavy_session"
    | "high_cost_low_yield"
    | "high_token_no_command"
    | "parse_error_hotspot";
  severity: "high" | "medium" | "low";
  title: string;
  summary: string;
  estimatedWastedTokens: number;
  confidence: "high" | "medium" | "low";
  affectedSessionIds: string[];
  affectedWorkspacePaths: string[];
  affectedProviderIds: string[];
  suggestion: string;
  status: "new";
}

export interface WorkAnalysisCompareDimensionSummary {
  key: string;
  label: string;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
  shareOfTokens: number;
  averageTokensPerSession: number;
  averageOutputShare: number;
}

export interface WorkAnalysisDailyActivityBucket {
  day: string;
  totalTokens: number;
  sessionCount: number;
}

export interface WorkAnalysisCompareRankingEntry {
  key: string;
  label: string;
  sessionCount: number;
  totalTokens: number;
  shareOfTokens: number;
  sharePercent: number;
  averageTokensPerSession: number;
  averageOutputShare: number;
}

export interface WorkAnalysisYieldSummary {
  sessionCount: number;
  shippedSessionCount: number;
  shippedSessionRate: number;
  editSessionCount: number;
  commandSessionCount: number;
  gitSessionCount: number;
  artifactSessionCount: number;
  shippedTokens: number;
  shippedTokenShare: number;
  averageTokensPerShippedSession: number;
  averageTokensPerNonShippedSession: number;
  outputToInputRatio: number;
  artifactSignalPerThousandTokens: number;
  gitAwareSessionRate: number;
}

export interface WorkAnalysisTurnBehaviorSummary {
  turnCount: number;
  editTurnCount: number;
  oneShotTurnCount: number;
  retryTurnCount: number;
  oneShotRate: number;
  retryRate: number;
}

export interface WorkAnalysisDimensionBreakdown {
  key: string;
  label: string;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
  shareOfTokens: number;
  averageTokensPerSession: number;
  averageOutputShare: number;
  relatedProviders?: string[];
  relatedModels?: string[];
  relatedWorkspacePaths?: string[];
}

export interface WorkAnalysisToolBreakdown {
  key: string;
  label: string;
  sessionCount: number;
  useCount: number;
  totals: WorkAnalysisUsageTotals;
}

export interface WorkAnalysisCommandBreakdown {
  key: string;
  label: string;
  sessionCount: number;
  useCount: number;
  totals: WorkAnalysisUsageTotals;
}

export interface WorkAnalysisSessionInsight {
  sessionId: string;
  providerId: string;
  workspacePath: string;
  modelId?: string;
  taskType?: WorkAnalysisTaskType;
  totalTokens: number;
  outputTokens?: number;
  durationMs?: number;
  shippedSignals?: string[];
  missedSignals?: string[];
}

export interface WorkAnalysisOverviewDomain {
  totals: WorkAnalysisUsageTotals & {
    sessionCount: number;
    workspaceCount: number;
    providerCount: number;
    taskTypeCount: number;
  };
  activity: {
    totalDurationMs: number;
    averageDurationMs: number;
    byDay: Array<{
      day: string;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byHour: Array<{
      hour: number;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
  };
  shares: {
    topDimension: "workspace" | "provider" | "model" | "task";
    items: Array<{
      key: string;
      label: string;
      shareOfTokens: number;
      totalTokens: number;
    }>;
  };
  coverage: {
    sessionCount: number;
    workspaceCount: number;
    providerCount: number;
    timeRangeLabel: string;
    usage?: WorkAnalysisUsageCoverageSummary;
  };
}

export interface WorkAnalysisBreakdownsDomain {
  byWorkspace: WorkAnalysisDimensionBreakdown[];
  byProvider: WorkAnalysisDimensionBreakdown[];
  byModel: WorkAnalysisDimensionBreakdown[];
  byTask: WorkAnalysisDimensionBreakdown[];
  byTool: WorkAnalysisToolBreakdown[];
  byCommand: WorkAnalysisCommandBreakdown[];
}

export interface WorkAnalysisSessionsDomain {
  featured: {
    topByTotalTokens: WorkAnalysisSessionInsight[];
    topByOutputTokens: WorkAnalysisSessionInsight[];
    lowYield: WorkAnalysisSessionInsight[];
    topShipped: WorkAnalysisSessionInsight[];
  };
}

export interface WorkAnalysisEfficiencyDomain {
  overall: WorkAnalysisEfficiencySummary;
  byProvider: Array<{
    providerId: string;
    summary: WorkAnalysisEfficiencySummary;
  }>;
  byTask: Array<{
    taskType: WorkAnalysisTaskType;
    summary: WorkAnalysisEfficiencySummary;
  }>;
}

export interface WorkAnalysisOptimizeDomain {
  totalFindings: number;
  totalEstimatedWastedTokens: number;
  findings: WorkAnalysisOptimizeFinding[];
}

export interface WorkAnalysisYieldDomain {
  overall: WorkAnalysisYieldSummary;
  byWorkspace: Array<{
    workspacePath: string;
    summary: WorkAnalysisYieldSummary;
  }>;
  byTask: Array<{
    taskType: WorkAnalysisTaskType;
    summary: WorkAnalysisYieldSummary;
    turnBehavior?: WorkAnalysisTurnBehaviorSummary;
  }>;
  topShippedSessions: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    taskType: WorkAnalysisTaskType;
    totalTokens: number;
    shippedSignals: string[];
  }>;
  lowYieldSessions: Array<{
    sessionId: string;
    providerId: string;
    workspacePath: string;
    taskType: WorkAnalysisTaskType;
    totalTokens: number;
    missedSignals: string[];
  }>;
  limitations: string[];
}

export interface WorkAnalysisDeliveryDomain {
  yield?: WorkAnalysisYieldDomain;
}

export interface WorkAnalysisCapabilitiesDomain {
  providers: WorkAnalysisProviderCapability[];
  skillInventory: {
    installedCount: number;
    mountedCount: number;
    unmountedCount: number;
  };
}

export interface WorkAnalysisDataSourcesDomain {
  providers: Array<{
    providerId: string;
    status: "supported" | "no_logs" | "missing_root" | "partial" | "unsupported";
    sessionCount: number;
    parseErrorCount: number;
    warningCount: number;
    warnings?: WorkAnalysisProviderWarning[];
  }>;
  dataQuality: {
    clampedDurationCount: number;
    emptySessionCount: number;
  };
}

export interface WorkBasicAnalysisResultV2 {
  version: 2;
  query: {
    timeRangeLabel: string;
    selectedWorkspacePaths: string[];
    availableWorkspacePaths: string[];
  };
  overview: WorkAnalysisOverviewDomain;
  breakdowns: WorkAnalysisBreakdownsDomain;
  sessions: WorkAnalysisSessionsDomain;
  tasks?: WorkAnalysisTasksDomain;
  efficiency: WorkAnalysisEfficiencyDomain;
  optimize: WorkAnalysisOptimizeDomain;
  delivery: WorkAnalysisDeliveryDomain;
  capabilities: WorkAnalysisCapabilitiesDomain;
  dataSources: WorkAnalysisDataSourcesDomain;
}

export interface WorkBasicAnalysisResult {
  availableWorkspacePaths: string[];
  snapshotV2?: WorkBasicAnalysisResultV2;
  capabilityMatrix: {
    providers: WorkAnalysisProviderCapability[];
  };
  coverage: {
    workspaceCount: number;
    sessionCount: number;
    providerCount: number;
    timeRangeLabel: string;
    usage?: WorkAnalysisUsageCoverageSummary;
  };
  activity: {
    sessionCount: number;
    totalDurationMs: number;
    averageDurationMs: number;
    daily: WorkAnalysisDailyActivityBucket[];
  };
  workHabits: {
    hourBuckets: WorkAnalysisHourBucket[];
  };
  skillInventory: {
    installedCount: number;
    mountedCount: number;
    unmountedCount: number;
  };
  usage: {
    totalSessions: number;
    sessionsByProvider: Record<string, number>;
    totals: WorkAnalysisUsageTotals;
    byDay: Array<{
      day: string;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byHour: Array<{
      hour: number;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byProvider: Array<{
      providerId: string;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byWorkspace: Array<{
      workspacePath: string;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byModel: Array<{
      modelId: string;
      providerId: string;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byTool: Array<{
      toolName: string;
      sessionCount: number;
      useCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byCommand: Array<{
      commandLabel: string;
      sessionCount: number;
      useCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    topSessionsByTotalTokens: Array<{
      sessionId: string;
      providerId: string;
      workspacePath: string;
      modelId?: string;
      totalTokens: number;
    }>;
  };
  tasks: {
    turns?: WorkAnalysisTaskTurn[];
    byType: WorkAnalysisTaskSummary[];
    byTypeAndModel?: WorkAnalysisTaskSummaryByModel[];
    byTypeAndWorkspace?: WorkAnalysisTaskSummaryByWorkspace[];
    sessions: Array<{
      sessionId: string;
      providerId: string;
      workspacePath: string;
      modelId?: string;
      primaryTask: WorkAnalysisTaskType;
      signals: string[];
      totalTokens: number;
    }>;
  };
  efficiency?: {
    overall: WorkAnalysisEfficiencySummary;
    byProvider: Array<{
      providerId: string;
      summary: WorkAnalysisEfficiencySummary;
    }>;
    byTask: Array<{
      taskType: WorkAnalysisTaskType;
      summary: WorkAnalysisEfficiencySummary;
    }>;
  };
  optimize?: {
    totalFindings: number;
    totalEstimatedWastedTokens: number;
    findings: WorkAnalysisOptimizeFinding[];
  };
  compare?: {
    topDimension: "workspace" | "provider" | "model" | "task";
    workspaces: Array<WorkAnalysisCompareRankingEntry & { workspacePath: string }>;
    providers: Array<WorkAnalysisCompareRankingEntry & { providerId: string }>;
    models: Array<WorkAnalysisCompareRankingEntry & { providerId: string; modelId: string }>;
    tasks: Array<WorkAnalysisCompareRankingEntry & { taskType: WorkAnalysisTaskType }>;
    dimensions: {
      workspace: WorkAnalysisCompareDimensionSummary[];
      provider: WorkAnalysisCompareDimensionSummary[];
      model: WorkAnalysisCompareDimensionSummary[];
      task: WorkAnalysisCompareDimensionSummary[];
    };
  };
  yield?: WorkAnalysisYieldDomain;
  agentModelMix: {
    providers: Array<{
      providerId: string;
      sessionCount: number;
    }>;
  };
  workSurface: {
    workspacePaths: string[];
  };
  executionSignals: {
    sessionsWithActivity: number;
    userTurnCount: number;
    assistantTurnCount: number;
    toolUseCount: number;
    fileMtimeTimestampCount: number;
  };
  dataSources: {
    providers: Array<{
      providerId: string;
      status: "supported" | "no_logs" | "missing_root" | "partial" | "unsupported";
      sessionCount: number;
      parseErrorCount: number;
      warningCount: number;
      warnings?: WorkAnalysisProviderWarning[];
    }>;
  };
  dataQuality: {
    clampedDurationCount: number;
    emptySessionCount: number;
  };
}

export interface WorkDeepAnalysisResult {
  workSummary: string;
  repeatedPatterns: Array<{
    title: string;
    whyItRepeated: string;
    evidence: string[];
  }>;
  bottlenecks: Array<{
    title: string;
    impact: string;
    evidence: string[];
    suggestion: string;
  }>;
  workflowSuggestions: string[];
  skillCandidates: Array<{
    title: string;
    why: string;
    suggestedScope: string;
    evidence: string[];
  }>;
  openLoops: string[];
  followUpSuggestions: string[];
  confidence: "low" | "medium" | "high";
}

export interface WorkAnalysisSessionEvidence {
  providerId?: string;
  sessionId?: string;
  workspacePath?: string;
  title?: string;
  startedAt: number;
  lastActiveAt: number;
  excerpts?: Array<{
    role: "user" | "assistant" | "tool" | "system" | "unknown";
    at?: number;
    text?: string;
    toolName?: string;
    commandKind?: string;
    filePath?: string;
  }>;
  latestUserInput?: string;
  terminalSnapshot?: string;
}

export interface WorkAnalysisEvidence {
  sessions: WorkAnalysisSessionEvidence[];
  skillInventory: {
    installedSkills: Array<{ slug: string }>;
    mounts: Array<{ skillSlug: string; enabled?: boolean }>;
  };
}
