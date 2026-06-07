export interface WorkAnalysisEfficiencyMetrics {
  oneShotRate: number;
  retryRate: number;
  selfCorrectionRate: number;
  readToEditRatio: number;
  commandToEditRatio: number;
  cacheHitShare: number;
  gitAwareSessionRate: number;
}

export interface EfficiencyMetricsSession {
  id: string;
  events: EfficiencyMetricsEvent[];
}

export interface EfficiencyMetricsEvent {
  canonicalEventType: "message_turn" | "command" | "edit" | "git_signal" | "usage";
  role?: "user" | "assistant" | "tool" | "system" | "unknown";
  inputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export function buildEfficiencyMetrics(
  sessions: EfficiencyMetricsSession[]
): WorkAnalysisEfficiencyMetrics {
  if (sessions.length === 0) {
    return {
      oneShotRate: 0,
      retryRate: 0,
      selfCorrectionRate: 0,
      readToEditRatio: 0,
      commandToEditRatio: 0,
      cacheHitShare: 0,
      gitAwareSessionRate: 0,
    };
  }

  let oneShotSessions = 0;
  let retrySessions = 0;
  let selfCorrectedSessions = 0;
  let analyzableSessions = 0;
  let readSignals = 0;
  let editSignals = 0;
  let commandSignals = 0;
  let gitAwareSessions = 0;
  let inputSideTokens = 0;
  let cacheRelatedTokens = 0;

  for (const session of sessions) {
    let messageTurnCount = 0;
    let hasCommand = false;
    let hasEdit = false;
    let hasGit = false;
    let isAnalyzable = false;

    for (const event of session.events) {
      if (event.canonicalEventType === "message_turn") {
        isAnalyzable = true;
        if (event.role !== "assistant") {
          messageTurnCount += 1;
          readSignals += 1;
        }
      } else if (event.canonicalEventType === "command") {
        isAnalyzable = true;
        commandSignals += 1;
        hasCommand = true;
      } else if (event.canonicalEventType === "edit") {
        isAnalyzable = true;
        editSignals += 1;
        hasEdit = true;
      } else if (event.canonicalEventType === "git_signal") {
        isAnalyzable = true;
        hasGit = true;
      }

      if (event.canonicalEventType === "usage") {
        const eventCacheTokens =
          (event.cachedInputTokens ?? 0) +
          (event.cacheCreationInputTokens ?? 0) +
          (event.cacheReadInputTokens ?? 0);
        inputSideTokens += (event.inputTokens ?? 0) + eventCacheTokens;
        cacheRelatedTokens += eventCacheTokens;
      }
    }

    if (!isAnalyzable) {
      continue;
    }

    analyzableSessions += 1;

    if (messageTurnCount === 1 && (hasEdit || hasGit)) {
      oneShotSessions += 1;
    }
    if (messageTurnCount > 1) {
      retrySessions += 1;
      if (hasEdit || hasGit) {
        selfCorrectedSessions += 1;
      }
    }
    if (hasGit || hasCommand) {
      gitAwareSessions += 1;
    }
  }

  return {
    oneShotRate: roundRatio(oneShotSessions, analyzableSessions),
    retryRate: roundRatio(retrySessions, analyzableSessions),
    selfCorrectionRate: roundRatio(selfCorrectedSessions, analyzableSessions),
    readToEditRatio: roundRatio(readSignals, editSignals),
    commandToEditRatio: roundRatio(commandSignals, editSignals),
    cacheHitShare: roundRatio(cacheRelatedTokens, inputSideTokens),
    gitAwareSessionRate: roundRatio(gitAwareSessions, analyzableSessions),
  };
}

function roundRatio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}
