import { findHighCostLowYieldSessions } from "../metrics/yield.js";
import type {
  WorkAnalysisOptimizeFinding,
  WorkAnalysisTaskType,
  WorkAnalysisUsageTotals,
} from "../types.js";

export interface OptimizeSessionInput {
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
}

export interface OptimizeProviderInput {
  providerId: string;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
}

export function detectOptimizeFindings(input: {
  sessions: OptimizeSessionInput[];
  providers: OptimizeProviderInput[];
}): WorkAnalysisOptimizeFinding[] {
  const findings: WorkAnalysisOptimizeFinding[] = [];
  const highCostLowYieldSessions = findHighCostLowYieldSessions(
    input.sessions.filter(
      (session) => session.supportsLowYieldInference && session.parseErrorCount === 0
    )
  );

  for (const provider of input.providers) {
    if (provider.sessionCount > 0 && provider.totals.totalTokens === 0) {
      findings.push({
        id: `provider-missing-usage-${provider.providerId}`,
        type: "provider_missing_usage",
        severity: "medium",
        title: `${provider.providerId} has sessions but no token usage`,
        summary: `${provider.sessionCount} sessions were discovered for ${provider.providerId}, but token usage could not be accounted for from local logs.`,
        estimatedWastedTokens: 0,
        confidence: "high",
        affectedSessionIds: [],
        affectedWorkspacePaths: [],
        affectedProviderIds: [provider.providerId],
        suggestion:
          "Improve provider log extraction or mark this provider as partial so token analysis does not overstate confidence.",
        status: "new",
      });
    }
  }

  if (highCostLowYieldSessions.length > 0) {
    findings.push({
      id: "high-cost-low-yield",
      type: "high_cost_low_yield",
      severity: "high",
      title: "High-cost sessions without yield signals",
      summary: `${highCostLowYieldSessions.length} expensive session(s) matched the current low-yield rules without producing a shipped outcome.`,
      estimatedWastedTokens: highCostLowYieldSessions.reduce(
        (sum, session) => sum + session.totalTokens,
        0
      ),
      confidence: "medium",
      affectedSessionIds: highCostLowYieldSessions.map((session) => session.sessionId),
      affectedWorkspacePaths: [
        ...new Set(highCostLowYieldSessions.map((session) => session.workspacePath)),
      ],
      affectedProviderIds: [
        ...new Set(highCostLowYieldSessions.map((session) => session.providerId)),
      ],
      suggestion:
        "Split expensive sessions earlier or convert work into shipped outcomes before token cost climbs.",
      status: "new",
    });
  }

  for (const session of input.sessions) {
    if (session.totals.totalTokens >= 50_000 && session.toolUseCount >= 3) {
      const outputRatio =
        session.totals.inputTokens > 0
          ? session.totals.outputTokens / session.totals.inputTokens
          : 0;
      if (outputRatio < 0.2) {
        findings.push({
          id: `tool-heavy-${session.sessionId}`,
          type: "tool_heavy_low_output",
          severity: "high",
          title: "Tool-heavy session with low output yield",
          summary: `${session.sessionId} consumed ${session.totals.totalTokens} tokens with ${session.toolUseCount} tool calls but relatively low output tokens.`,
          estimatedWastedTokens: Math.round(session.totals.totalTokens * 0.35),
          confidence: "medium",
          affectedSessionIds: [session.sessionId],
          affectedWorkspacePaths: [session.workspacePath],
          affectedProviderIds: [session.providerId],
          suggestion:
            "Check whether the session is looping through tools or rereading context without converting the work into output.",
          status: "new",
        });
      }
    }

    const cacheOverhead =
      session.totals.cacheCreationInputTokens + session.totals.cacheReadInputTokens;
    if (session.totals.totalTokens >= 25_000 && cacheOverhead > session.totals.outputTokens) {
      findings.push({
        id: `cache-heavy-${session.sessionId}`,
        type: "cache_heavy_session",
        severity: "medium",
        title: "Cache-heavy session",
        summary: `${session.sessionId} spent more cache-related tokens than output tokens.`,
        estimatedWastedTokens: cacheOverhead - session.totals.outputTokens,
        confidence: "medium",
        affectedSessionIds: [session.sessionId],
        affectedWorkspacePaths: [session.workspacePath],
        affectedProviderIds: [session.providerId],
        suggestion:
          "Review whether the session is repeatedly rebuilding context that could be shortened or split.",
        status: "new",
      });
    }

    if (
      session.totals.totalTokens >= 40_000 &&
      !session.hasCommandSignal &&
      session.toolUseCount === 0
    ) {
      findings.push({
        id: `high-token-no-command-${session.sessionId}`,
        type: "high_token_no_command",
        severity: "medium",
        title: "High-token session without command activity",
        summary: `${session.sessionId} consumed ${session.totals.totalTokens} tokens without any command signal.`,
        estimatedWastedTokens: Math.round(session.totals.totalTokens * 0.2),
        confidence: "low",
        affectedSessionIds: [session.sessionId],
        affectedWorkspacePaths: [session.workspacePath],
        affectedProviderIds: [session.providerId],
        suggestion:
          "Inspect whether this was long conversational exploration that should have been narrowed earlier.",
        status: "new",
      });
    }

    if (session.parseErrorCount > 0) {
      findings.push({
        id: `parse-errors-${session.sessionId}`,
        type: "parse_error_hotspot",
        severity: "low",
        title: "Session parsed with provider log errors",
        summary: `${session.sessionId} had ${session.parseErrorCount} provider log parse errors, so downstream analytics may be incomplete.`,
        estimatedWastedTokens: 0,
        confidence: "high",
        affectedSessionIds: [session.sessionId],
        affectedWorkspacePaths: [session.workspacePath],
        affectedProviderIds: [session.providerId],
        suggestion:
          "Fix parser compatibility for this provider log shape before trusting detailed analytics for the session.",
        status: "new",
      });
    }
  }

  return findings
    .sort(
      (left, right) =>
        severityRank(right.severity) - severityRank(left.severity) ||
        right.estimatedWastedTokens - left.estimatedWastedTokens ||
        left.id.localeCompare(right.id)
    )
    .slice(0, 20);
}

function severityRank(severity: WorkAnalysisOptimizeFinding["severity"]) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
