import type {
  WorkAnalysisEfficiencySummary,
  WorkAnalysisTaskType,
  WorkAnalysisUsageTotals,
} from "../types.js";
import type { EfficiencyMetricsEvent } from "./efficiency.js";
import { buildEfficiencyMetrics } from "./efficiency.js";

export {
  buildEfficiencyMetrics,
  type EfficiencyMetricsEvent,
  type EfficiencyMetricsSession,
  type WorkAnalysisEfficiencyMetrics,
} from "./efficiency.js";

export interface EfficiencySessionInput {
  sessionId: string;
  providerId: string;
  taskType: WorkAnalysisTaskType;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  toolUseCount: number;
  hasCommandSignal: boolean;
  hasEditSignal: boolean;
  hasCacheUsage: boolean;
  events?: EfficiencyMetricsEvent[];
}

export function summarizeEfficiency(
  sessions: EfficiencySessionInput[]
): WorkAnalysisEfficiencySummary {
  if (sessions.length === 0) {
    return {
      sessionCount: 0,
      averageTokensPerSession: 0,
      averageInputTokensPerSession: 0,
      averageOutputTokensPerSession: 0,
      averageTokensPerToolUse: 0,
      commandSessionRate: 0,
      cacheParticipationRate: 0,
      editSignalCoverageRate: 0,
      highTokenSessionRate: 0,
      toolHeavySessionCount: 0,
      oneShotRate: 0,
      retryRate: 0,
      selfCorrectionRate: 0,
      readToEditRatio: 0,
      commandToEditRatio: 0,
      cacheHitShare: 0,
      gitAwareSessionRate: 0,
    };
  }

  const totalTokens = sessions.reduce((sum, session) => sum + session.totalTokens, 0);
  const totalInputTokens = sessions.reduce((sum, session) => sum + session.inputTokens, 0);
  const totalOutputTokens = sessions.reduce((sum, session) => sum + session.outputTokens, 0);
  const totalToolUses = sessions.reduce((sum, session) => sum + session.toolUseCount, 0);
  const commandSessions = sessions.filter((session) => session.hasCommandSignal).length;
  const cacheSessions = sessions.filter((session) => session.hasCacheUsage).length;
  const editSignalSessions = sessions.filter((session) => session.hasEditSignal).length;
  const averageTokensPerSession = Math.round(totalTokens / sessions.length);
  const highTokenThreshold = averageTokensPerSession;
  const highTokenSessions = sessions.filter(
    (session) => session.totalTokens >= highTokenThreshold
  ).length;
  const toolHeavySessionCount = sessions.filter((session) => session.toolUseCount >= 3).length;
  const eventMetrics = buildEfficiencyMetrics(
    sessions.map((session) => ({
      id: session.sessionId,
      events: session.events ?? [],
    }))
  );
  return {
    sessionCount: sessions.length,
    averageTokensPerSession,
    averageInputTokensPerSession: Math.round(totalInputTokens / sessions.length),
    averageOutputTokensPerSession: Math.round(totalOutputTokens / sessions.length),
    averageTokensPerToolUse:
      totalToolUses > 0 ? Math.round(totalTokens / totalToolUses) : averageTokensPerSession,
    commandSessionRate: roundRatio(commandSessions, sessions.length),
    cacheParticipationRate: roundRatio(cacheSessions, sessions.length),
    editSignalCoverageRate: roundRatio(editSignalSessions, sessions.length),
    highTokenSessionRate: roundRatio(highTokenSessions, sessions.length),
    toolHeavySessionCount,
    oneShotRate: eventMetrics.oneShotRate,
    retryRate: eventMetrics.retryRate,
    selfCorrectionRate: eventMetrics.selfCorrectionRate,
    readToEditRatio: eventMetrics.readToEditRatio,
    commandToEditRatio: eventMetrics.commandToEditRatio,
    cacheHitShare: eventMetrics.cacheHitShare,
    gitAwareSessionRate: eventMetrics.gitAwareSessionRate,
  };
}

export function usageTotalsToEfficiencyInput(input: {
  sessionId: string;
  providerId: string;
  taskType: WorkAnalysisTaskType;
  totals: WorkAnalysisUsageTotals;
  toolUseCount: number;
  hasCommandSignal: boolean;
  hasEditSignal: boolean;
  events?: EfficiencyMetricsEvent[];
}): EfficiencySessionInput {
  return {
    sessionId: input.sessionId,
    providerId: input.providerId,
    taskType: input.taskType,
    totalTokens: input.totals.totalTokens,
    inputTokens: input.totals.inputTokens,
    outputTokens: input.totals.outputTokens,
    toolUseCount: input.toolUseCount,
    hasCommandSignal: input.hasCommandSignal,
    hasEditSignal: input.hasEditSignal,
    hasCacheUsage:
      input.totals.cachedInputTokens > 0 ||
      input.totals.cacheCreationInputTokens > 0 ||
      input.totals.cacheReadInputTokens > 0,
    events: input.events,
  };
}

function roundRatio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}
