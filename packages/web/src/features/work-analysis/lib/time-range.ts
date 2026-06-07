import type { WorkAnalysisPresetRange, WorkAnalysisTimeRange } from "../types";

export const DEFAULT_WORK_ANALYSIS_RANGE: WorkAnalysisPresetRange = "30d";

export const WORK_ANALYSIS_PRESET_OPTIONS: Array<{
  value: WorkAnalysisPresetRange | "custom";
  labelKey: string;
}> = [
  { value: "24h", labelKey: "settings.analysis.range_24h" },
  { value: "7d", labelKey: "settings.analysis.range_7d" },
  { value: "30d", labelKey: "settings.analysis.range_30d" },
  { value: "90d", labelKey: "settings.analysis.range_90d" },
  { value: "custom", labelKey: "settings.analysis.range_custom" },
];

export function timestampToLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function localInputValueToTimestamp(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getDefaultCustomRange(now = Date.now()): { startAt: string; endAt: string } {
  return {
    startAt: timestampToLocalInputValue(now - 7 * 24 * 60 * 60 * 1000),
    endAt: timestampToLocalInputValue(now),
  };
}

export function buildWorkAnalysisTimeRange(input: {
  preset: WorkAnalysisPresetRange | "custom";
  customStartAt: string;
  customEndAt: string;
}): WorkAnalysisTimeRange | null {
  if (input.preset !== "custom") {
    return { preset: input.preset };
  }

  const startAt = localInputValueToTimestamp(input.customStartAt);
  const endAt = localInputValueToTimestamp(input.customEndAt);
  if (startAt === null || endAt === null || startAt > endAt) {
    return null;
  }

  return { startAt, endAt };
}
