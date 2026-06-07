import type { WorkAnalysisCompareDimensionSummary, WorkAnalysisUsageTotals } from "../types.js";

export interface CompareDimensionInput {
  key: string;
  label: string;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
}

export function summarizeCompareDimension(
  entries: CompareDimensionInput[],
  totalTokens: number
): WorkAnalysisCompareDimensionSummary[] {
  return entries
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      sessionCount: entry.sessionCount,
      totals: entry.totals,
      shareOfTokens: roundRatio(entry.totals.totalTokens, totalTokens),
      averageTokensPerSession:
        entry.sessionCount > 0 ? Math.round(entry.totals.totalTokens / entry.sessionCount) : 0,
      averageOutputShare: roundRatio(entry.totals.outputTokens, entry.totals.totalTokens),
    }))
    .sort(
      (left, right) =>
        right.totals.totalTokens - left.totals.totalTokens ||
        right.sessionCount - left.sessionCount ||
        left.label.localeCompare(right.label)
    );
}

export function pickTopCompareDimension(input: {
  workspace: WorkAnalysisCompareDimensionSummary[];
  provider: WorkAnalysisCompareDimensionSummary[];
  model: WorkAnalysisCompareDimensionSummary[];
  task: WorkAnalysisCompareDimensionSummary[];
}): "workspace" | "provider" | "model" | "task" {
  const ranked = (
    [
      ["workspace", input.workspace],
      ["provider", input.provider],
      ["model", input.model],
      ["task", input.task],
    ] as const
  ).map(([dimension, entries]) => ({
    dimension,
    topShare: entries[0]?.shareOfTokens ?? 0,
    topTokens: entries[0]?.totals.totalTokens ?? 0,
  }));

  ranked.sort(
    (left, right) =>
      right.topShare - left.topShare ||
      right.topTokens - left.topTokens ||
      compareDimensionPriority(left.dimension, right.dimension)
  );

  return ranked[0]?.dimension ?? "workspace";
}

export function toSharePercent(shareOfTokens: number) {
  return Math.round(shareOfTokens * 10_000) / 100;
}

function compareDimensionPriority(
  left: "workspace" | "provider" | "model" | "task",
  right: "workspace" | "provider" | "model" | "task"
) {
  return dimensionPriority(left) - dimensionPriority(right);
}

function dimensionPriority(dimension: "workspace" | "provider" | "model" | "task") {
  switch (dimension) {
    case "workspace":
      return 0;
    case "provider":
      return 1;
    case "task":
      return 2;
    case "model":
      return 3;
  }
}

function roundRatio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}
