import { createHash } from "node:crypto";

import type {
  ResolvedWorkAnalysisTimeRange,
  WorkAnalysisPresetRange,
  WorkAnalysisQuery,
  WorkAnalysisTimeRange,
} from "./types.js";

const PRESET_MS: Record<WorkAnalysisPresetRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

export function normalizeWorkAnalysisQuery(input: WorkAnalysisQuery): WorkAnalysisQuery {
  const workspacePaths = input.workspacePaths
    ? [...new Set(input.workspacePaths)].sort((left, right) => left.localeCompare(right))
    : undefined;

  return {
    ...(workspacePaths && workspacePaths.length > 0 ? { workspacePaths } : {}),
    timeRange: "preset" in input.timeRange ? input.timeRange : { ...input.timeRange },
  };
}

export function resolveWorkAnalysisTimeRange(
  timeRange: WorkAnalysisTimeRange,
  now: number
): ResolvedWorkAnalysisTimeRange {
  if ("preset" in timeRange) {
    return {
      startAt: now - PRESET_MS[timeRange.preset],
      endAt: now,
      label: timeRange.preset,
    };
  }

  return {
    startAt: timeRange.startAt,
    endAt: timeRange.endAt,
    label: `${timeRange.startAt}-${timeRange.endAt}`,
  };
}

export function buildWorkAnalysisQueryDigest(query: WorkAnalysisQuery): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeWorkAnalysisQuery(query)))
    .digest("hex");
}
