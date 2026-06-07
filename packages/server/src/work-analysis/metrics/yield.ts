import type {
  WorkAnalysisTaskType,
  WorkAnalysisTurnBehaviorSummary,
  WorkAnalysisUsageTotals,
  WorkAnalysisYieldSummary,
} from "../types.js";
import { summarizeOneShot } from "./one-shot.js";

export interface YieldSessionInput {
  sessionId: string;
  providerId: string;
  workspacePath: string;
  taskType: WorkAnalysisTaskType;
  totals: WorkAnalysisUsageTotals;
  hasEditSignal: boolean;
  hasCommandSignal: boolean;
  hasGitSignal: boolean;
  retries?: number;
}

export interface LowYieldSessionSummary {
  sessionId: string;
  providerId: string;
  workspacePath: string;
  taskType: WorkAnalysisTaskType;
  totalTokens: number;
  hasEdit: boolean;
  hasGit: boolean;
}

export function summarizeTurnBehavior(
  sessions: YieldSessionInput[]
): WorkAnalysisTurnBehaviorSummary {
  const oneShot = summarizeOneShot(
    sessions.map((session) => ({
      hasEdits: session.hasEditSignal,
      retries: session.retries ?? 0,
    }))
  );

  return {
    turnCount: sessions.length,
    editTurnCount: oneShot.editTurnCount,
    oneShotTurnCount: oneShot.oneShotTurnCount,
    retryTurnCount: oneShot.retryTurnCount,
    oneShotRate: oneShot.oneShotRate,
    retryRate: oneShot.retryRate,
  };
}

export const HIGH_COST_THRESHOLD = 50_000;

export function summarizeYield(sessions: YieldSessionInput[]): WorkAnalysisYieldSummary {
  if (sessions.length === 0) {
    return {
      sessionCount: 0,
      shippedSessionCount: 0,
      shippedSessionRate: 0,
      editSessionCount: 0,
      commandSessionCount: 0,
      gitSessionCount: 0,
      artifactSessionCount: 0,
      shippedTokens: 0,
      shippedTokenShare: 0,
      averageTokensPerShippedSession: 0,
      averageTokensPerNonShippedSession: 0,
      outputToInputRatio: 0,
      artifactSignalPerThousandTokens: 0,
      gitAwareSessionRate: 0,
    };
  }

  const shippedSessions = sessions.filter(isShippedSession);
  const nonShippedSessions = sessions.filter((session) => !isShippedSession(session));
  const totalTokens = sessions.reduce((sum, session) => sum + session.totals.totalTokens, 0);
  const shippedTokens = shippedSessions.reduce(
    (sum, session) => sum + session.totals.totalTokens,
    0
  );
  const totalInputTokens = sessions.reduce((sum, session) => sum + session.totals.inputTokens, 0);
  const totalOutputTokens = sessions.reduce((sum, session) => sum + session.totals.outputTokens, 0);
  const artifactSessionCount = sessions.filter(
    (session) => session.hasEditSignal || session.hasCommandSignal || session.hasGitSignal
  ).length;
  const artifactSignalCount = sessions.reduce(
    (sum, session) => sum + getShippedSignals(session).length,
    0
  );
  const gitAwareSessionCount = sessions.filter(
    (session) => session.hasGitSignal || session.hasCommandSignal
  ).length;

  return {
    sessionCount: sessions.length,
    shippedSessionCount: shippedSessions.length,
    shippedSessionRate: roundRatio(shippedSessions.length, sessions.length),
    editSessionCount: sessions.filter((session) => session.hasEditSignal).length,
    commandSessionCount: sessions.filter((session) => session.hasCommandSignal).length,
    gitSessionCount: sessions.filter((session) => session.hasGitSignal).length,
    artifactSessionCount,
    shippedTokens,
    shippedTokenShare: roundRatio(shippedTokens, totalTokens),
    averageTokensPerShippedSession:
      shippedSessions.length > 0 ? Math.round(shippedTokens / shippedSessions.length) : 0,
    averageTokensPerNonShippedSession:
      nonShippedSessions.length > 0
        ? Math.round(
            nonShippedSessions.reduce((sum, session) => sum + session.totals.totalTokens, 0) /
              nonShippedSessions.length
          )
        : 0,
    outputToInputRatio: roundRatio(totalOutputTokens, totalInputTokens),
    artifactSignalPerThousandTokens:
      totalTokens > 0 ? Math.round((artifactSignalCount / totalTokens) * 1000 * 1000) / 1000 : 0,
    gitAwareSessionRate: roundRatio(gitAwareSessionCount, sessions.length),
  };
}

export function isShippedSession(session: YieldSessionInput) {
  if (session.hasGitSignal) {
    return true;
  }
  if (session.hasEditSignal && session.hasCommandSignal) {
    return true;
  }
  return session.hasEditSignal && session.totals.outputTokens > 0;
}

export function getShippedSignals(session: YieldSessionInput): string[] {
  const signals: string[] = [];
  if (session.hasEditSignal) signals.push("edit");
  if (session.hasCommandSignal) signals.push("command");
  if (session.hasGitSignal) signals.push("git");
  if (session.totals.outputTokens > 0) signals.push("output");
  return signals;
}

export function getMissedYieldSignals(session: YieldSessionInput): string[] {
  const signals: string[] = [];
  if (!session.hasEditSignal) signals.push("no_edit");
  if (!session.hasCommandSignal) signals.push("no_command");
  if (!session.hasGitSignal) signals.push("no_git");
  if (session.totals.outputTokens === 0) signals.push("no_output");
  return signals;
}

export function findHighCostLowYieldSessions(
  sessions: YieldSessionInput[]
): LowYieldSessionSummary[] {
  return sessions
    .filter(
      (session) => session.totals.totalTokens >= HIGH_COST_THRESHOLD && !isShippedSession(session)
    )
    .map((session) => ({
      sessionId: session.sessionId,
      providerId: session.providerId,
      workspacePath: session.workspacePath,
      taskType: session.taskType,
      totalTokens: session.totals.totalTokens,
      hasEdit: session.hasEditSignal,
      hasGit: session.hasGitSignal,
    }));
}

function roundRatio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}
