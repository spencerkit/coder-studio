import { DEFAULT_WORK_ANALYSIS_RANGE } from "./lib/time-range";
import type { WorkAnalysisPresetRange } from "./types";

export const WORK_ANALYTICS_TABS = [
  "overview",
  "tasks",
  "models",
  "optimize",
  "compare",
  "yield",
] as const;

export type WorkAnalyticsTab = (typeof WORK_ANALYTICS_TABS)[number];

export interface WorkAnalyticsRouteState {
  tab: WorkAnalyticsTab;
  rangePreset: WorkAnalysisPresetRange | "custom";
  customStartAt: string;
  customEndAt: string;
  workspacePaths: string[];
}

function isWorkAnalyticsTab(value: string | null): value is WorkAnalyticsTab {
  return value !== null && WORK_ANALYTICS_TABS.includes(value as WorkAnalyticsTab);
}

function isRangePreset(value: string | null): value is WorkAnalysisPresetRange | "custom" {
  return (
    value === "24h" || value === "7d" || value === "30d" || value === "90d" || value === "custom"
  );
}

export function parseWorkAnalyticsSearch(search: string): WorkAnalyticsRouteState {
  const params = new URLSearchParams(search);

  return {
    tab: isWorkAnalyticsTab(params.get("tab"))
      ? (params.get("tab") as WorkAnalyticsTab)
      : "overview",
    rangePreset: isRangePreset(params.get("range"))
      ? (params.get("range") as WorkAnalysisPresetRange | "custom")
      : DEFAULT_WORK_ANALYSIS_RANGE,
    customStartAt: params.get("startAt") ?? "",
    customEndAt: params.get("endAt") ?? "",
    workspacePaths: params.getAll("workspacePath").filter(Boolean),
  };
}

export function buildWorkAnalyticsPath(state: Partial<WorkAnalyticsRouteState> = {}) {
  const params = new URLSearchParams();

  if (state.tab && state.tab !== "overview") {
    params.set("tab", state.tab);
  }

  if (state.rangePreset && state.rangePreset !== DEFAULT_WORK_ANALYSIS_RANGE) {
    params.set("range", state.rangePreset);
  }

  if (state.rangePreset === "custom") {
    if (state.customStartAt) {
      params.set("startAt", state.customStartAt);
    }
    if (state.customEndAt) {
      params.set("endAt", state.customEndAt);
    }
  }

  for (const workspacePath of state.workspacePaths ?? []) {
    params.append("workspacePath", workspacePath);
  }

  const suffix = params.toString();
  return suffix ? `/analytics?${suffix}` : "/analytics";
}
