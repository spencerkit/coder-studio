import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildWorkAnalysisTimeRange,
  DEFAULT_WORK_ANALYSIS_RANGE,
  getDefaultCustomRange,
} from "./lib/time-range";
import type {
  WorkAnalysisDashboardRecord,
  WorkAnalysisPresetRange,
  WorkAnalysisQuery,
} from "./types";
import { useWorkAnalysisDispatch } from "./use-work-analysis-dispatch";

export interface WorkAnalysisControllerOptions {
  initialRangePreset?: WorkAnalysisPresetRange | "custom";
  initialCustomRange?: { startAt: string; endAt: string };
  initialWorkspacePaths?: string[];
}

function sortWorkspacePaths(paths: string[]) {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function areEqualStringArrays(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function useWorkAnalysisController(options: WorkAnalysisControllerOptions = {}) {
  const dispatch = useWorkAnalysisDispatch();
  const [selectedWorkspacePaths, setSelectedWorkspacePaths] = useState<string[]>(() =>
    sortWorkspacePaths(options.initialWorkspacePaths ?? [])
  );
  const [availableWorkspacePaths, setAvailableWorkspacePaths] = useState<string[]>(() =>
    sortWorkspacePaths(options.initialWorkspacePaths ?? [])
  );
  const [hasCustomizedWorkspacePaths, setHasCustomizedWorkspacePaths] = useState(
    (options.initialWorkspacePaths?.length ?? 0) > 0
  );
  const [rangePreset, setRangePreset] = useState<WorkAnalysisPresetRange | "custom">(
    options.initialRangePreset ?? DEFAULT_WORK_ANALYSIS_RANGE
  );
  const [customRange, setCustomRange] = useState(
    () => options.initialCustomRange ?? getDefaultCustomRange()
  );
  const [dashboardRecord, setDashboardRecord] = useState<WorkAnalysisDashboardRecord | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
  const [isRebuildingDashboard, setIsRebuildingDashboard] = useState(false);
  const dashboardLoadRequestIdRef = useRef(0);

  const timeRange = useMemo(
    () =>
      buildWorkAnalysisTimeRange({
        preset: rangePreset,
        customStartAt: customRange.startAt,
        customEndAt: customRange.endAt,
      }),
    [customRange.endAt, customRange.startAt, rangePreset]
  );

  const customizedWorkspacePaths = hasCustomizedWorkspacePaths ? selectedWorkspacePaths : null;

  const query: WorkAnalysisQuery | null = useMemo(() => {
    if (!timeRange) {
      return null;
    }

    if (customizedWorkspacePaths && customizedWorkspacePaths.length === 0) {
      return null;
    }

    return customizedWorkspacePaths
      ? {
          workspacePaths: customizedWorkspacePaths,
          timeRange,
        }
      : { timeRange };
  }, [customizedWorkspacePaths, timeRange]);

  useEffect(() => {
    const requestId = dashboardLoadRequestIdRef.current + 1;
    dashboardLoadRequestIdRef.current = requestId;

    if (!query) {
      setDashboardRecord(null);
      setDashboardLoading(false);
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      setDashboardLoading(true);
      setDashboardRecord(null);
      const result = await dispatch<WorkAnalysisDashboardRecord>(
        "work.analysis.dashboard.get",
        query
      );

      if (cancelled || requestId !== dashboardLoadRequestIdRef.current) {
        return;
      }

      setDashboardRecord(result?.ok ? (result.data ?? null) : null);
      setDashboardLoading(false);
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [dispatch, query]);

  const dashboardWorkspacePaths = useMemo(() => {
    const projectPaths =
      dashboardRecord?.dashboard?.rankings.projects.map((entry) => entry.label) ?? [];
    return sortWorkspacePaths(projectPaths);
  }, [dashboardRecord?.dashboard?.rankings.projects]);

  useEffect(() => {
    if (dashboardWorkspacePaths.length === 0) {
      return;
    }

    setAvailableWorkspacePaths((current) => {
      const next = hasCustomizedWorkspacePaths
        ? sortWorkspacePaths([...current, ...dashboardWorkspacePaths])
        : dashboardWorkspacePaths;
      return areEqualStringArrays(current, next) ? current : next;
    });
  }, [dashboardWorkspacePaths, hasCustomizedWorkspacePaths]);

  useEffect(() => {
    if (hasCustomizedWorkspacePaths || availableWorkspacePaths.length === 0) {
      return;
    }

    setSelectedWorkspacePaths(availableWorkspacePaths);
  }, [availableWorkspacePaths, hasCustomizedWorkspacePaths]);

  async function refreshDashboard() {
    if (!query) {
      return;
    }

    setIsRefreshingDashboard(true);
    const result = await dispatch<WorkAnalysisDashboardRecord>(
      "work.analysis.dashboard.refresh",
      query
    );
    if (result?.ok) {
      setDashboardRecord(result.data ?? null);
    }
    setIsRefreshingDashboard(false);
  }

  async function rebuildDashboardIndex() {
    if (!query) {
      return;
    }

    setIsRebuildingDashboard(true);
    try {
      const result = await dispatch<WorkAnalysisDashboardRecord>(
        "work.analysis.dashboard.rebuild",
        query
      );
      if (result?.ok) {
        setDashboardRecord(result.data ?? null);
      }
    } finally {
      setIsRebuildingDashboard(false);
    }
  }

  const toggleWorkspacePath = (workspacePath: string) => {
    if (!hasCustomizedWorkspacePaths) {
      setHasCustomizedWorkspacePaths(true);
      setSelectedWorkspacePaths([workspacePath]);
      return;
    }

    if (selectedWorkspacePaths.includes(workspacePath) && selectedWorkspacePaths.length <= 1) {
      setHasCustomizedWorkspacePaths(false);
      setSelectedWorkspacePaths(availableWorkspacePaths);
      return;
    }

    setSelectedWorkspacePaths((current) => {
      if (current.includes(workspacePath)) {
        return current.filter((path) => path !== workspacePath);
      }
      return sortWorkspacePaths([...current, workspacePath]);
    });
  };

  return {
    availableWorkspacePaths,
    customRange,
    dashboard: dashboardRecord?.dashboard,
    dashboardLoading,
    dashboardRecord,
    hasCustomizedWorkspacePaths,
    isRefreshingDashboard,
    isRebuildingDashboard,
    query,
    rangePreset,
    rebuildDashboardIndex,
    refreshDashboard,
    selectedWorkspacePaths,
    setCustomRange,
    setHasCustomizedWorkspacePaths,
    setRangePreset,
    setSelectedWorkspacePaths,
    toggleWorkspacePath,
  };
}
