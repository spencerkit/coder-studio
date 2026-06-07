import type { WorkAnalysisStatus, WorkBasicAnalysisResult, WorkDeepAnalysisResult } from "./types";

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function formatTokenMetric(value: number | undefined) {
  const tokenCount = value ?? 0;
  const unit =
    tokenCount >= 1_000_000_000
      ? { divisor: 1_000_000_000, suffix: "B" }
      : tokenCount >= 1_000_000
        ? { divisor: 1_000_000, suffix: "M" }
        : null;

  if (!unit) {
    return formatInteger(tokenCount);
  }

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(tokenCount / unit.divisor)}${unit.suffix}`;
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatMultiplier(value: number) {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value)}x`;
}

export function formatTaskLabel(taskType: string) {
  return taskType.split("_").join(" ");
}

export function formatEvidenceLabel(value: string) {
  return value.split("_").join(" ").split(":").join(" / ");
}

export function formatRetryRate(value: number) {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value)}x`;
}

export function formatCompareDimensionLabel(
  value: "workspace" | "provider" | "model" | "task" | undefined
) {
  return value ?? "-";
}

export function summarizeWorkAnalysis(
  basicResult?: WorkBasicAnalysisResult,
  deepResult?: WorkDeepAnalysisResult
) {
  if (!basicResult) {
    return null;
  }

  const leadTask = basicResult.tasks?.byType?.[0];
  const leadProvider = basicResult.usage?.byProvider?.[0];
  const optimize = basicResult.optimize;

  return {
    totalTokens: basicResult.usage?.totals?.totalTokens ?? 0,
    sessionCount: basicResult.activity.sessionCount,
    workspaceCount: basicResult.coverage.workspaceCount,
    taskTypeCount: basicResult.tasks?.byType?.length ?? 0,
    leadTaskLabel: leadTask ? formatTaskLabel(leadTask.taskType) : null,
    leadTaskTokens: leadTask?.totals.totalTokens ?? 0,
    leadProviderId: leadProvider?.providerId ?? null,
    leadProviderTokens: leadProvider?.totals.totalTokens ?? 0,
    topOptimizeCount: optimize?.findings.length ?? 0,
    wastedTokens: optimize?.totalEstimatedWastedTokens ?? 0,
    deepSummary: deepResult?.workSummary ?? null,
  };
}

export function hasAnalysisResult(status: WorkAnalysisStatus, hasResult: boolean) {
  return status === "succeeded" || hasResult;
}
