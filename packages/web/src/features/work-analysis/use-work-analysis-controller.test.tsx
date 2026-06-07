import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import type { WorkAnalysisDashboardRecord } from "./types";
import { useWorkAnalysisController } from "./use-work-analysis-controller";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createWrapper(sendCommand: ReturnType<typeof vi.fn>) {
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);

  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter>{children}</MemoryRouter>
      </Provider>
    );
  };
}

function createDashboardRecord(
  workspacePaths: string[] = ["/repo/a", "/repo/b"]
): WorkAnalysisDashboardRecord {
  return {
    version: 1,
    queryDigest: "digest-1",
    query: { timeRange: { preset: "7d" } },
    mode: "auto",
    requestedAt: 1,
    scanState: {
      mode: "auto",
      status: "succeeded",
      providerStatuses: [],
    },
    dashboard: {
      generatedAt: 1,
      timeRange: {
        startAt: 1,
        endAt: 2,
        label: "7d",
      },
      filters: { timeRange: { preset: "7d" } },
      kpis: [],
      trends: {
        tokenHourly: [],
        tokenDaily: [],
        hourHeatmap: [],
      },
      rankings: {
        projects: workspacePaths.map((workspacePath, index) => ({
          key: workspacePath,
          label: workspacePath,
          totalTokens: 100 - index,
          shareOfTokens: 0.5,
          sessionCount: 1,
          activeDurationMs: 0,
        })),
        models: [],
        agents: [],
      },
      breakdowns: {
        tasks: [],
        tools: [],
      },
      quality: {
        providers: [],
        warnings: [],
      },
    },
  };
}

describe("useWorkAnalysisController", () => {
  it("does not refetch after seeding default workspace paths from analysis results", async () => {
    const pendingSecondResponse = createDeferred<WorkAnalysisDashboardRecord>();
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(createDashboardRecord())
      .mockReturnValueOnce(pendingSecondResponse.promise);

    const { result } = renderHook(() => useWorkAnalysisController(), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it("uses 30 days as the default query range", async () => {
    const sendCommand = vi.fn().mockResolvedValue(createDashboardRecord());

    const { result } = renderHook(() => useWorkAnalysisController(), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.query).toEqual({ timeRange: { preset: "30d" } });
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "work.analysis.dashboard.get",
      { timeRange: { preset: "30d" } },
      undefined
    );
  });

  it("keeps an explicit 7 day initial range", async () => {
    const sendCommand = vi.fn().mockResolvedValue(createDashboardRecord());

    const { result } = renderHook(() => useWorkAnalysisController({ initialRangePreset: "7d" }), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.query).toEqual({ timeRange: { preset: "7d" } });
    });
  });

  it("filters to only the clicked project when switching from all projects", async () => {
    const sendCommand = vi.fn().mockResolvedValue(createDashboardRecord());

    const { result } = renderHook(() => useWorkAnalysisController(), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
    });

    act(() => {
      result.current.toggleWorkspacePath("/repo/a");
    });

    expect(result.current.hasCustomizedWorkspacePaths).toBe(true);
    expect(result.current.selectedWorkspacePaths).toEqual(["/repo/a"]);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenLastCalledWith(
        "work.analysis.dashboard.get",
        {
          timeRange: { preset: "30d" },
          workspacePaths: ["/repo/a"],
        },
        undefined
      );
    });
  });

  it("returns to all projects instead of clearing the query when deselecting the last project", async () => {
    const sendCommand = vi.fn().mockResolvedValue(createDashboardRecord());

    const { result } = renderHook(() => useWorkAnalysisController(), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
    });

    act(() => {
      result.current.toggleWorkspacePath("/repo/a");
    });

    await waitFor(() => {
      expect(result.current.query).toEqual({
        timeRange: { preset: "30d" },
        workspacePaths: ["/repo/a"],
      });
    });

    act(() => {
      result.current.toggleWorkspacePath("/repo/a");
    });

    expect(result.current.hasCustomizedWorkspacePaths).toBe(false);
    expect(result.current.selectedWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
    expect(result.current.query).toEqual({ timeRange: { preset: "30d" } });
    await waitFor(() => {
      expect(sendCommand).toHaveBeenLastCalledWith(
        "work.analysis.dashboard.get",
        { timeRange: { preset: "30d" } },
        undefined
      );
      expect(result.current.dashboardRecord).not.toBeNull();
    });
  });

  it("keeps the full project filter list while showing a filtered dashboard", async () => {
    const sendCommand = vi.fn(async (_op: string, args: unknown) => {
      const query = args as { workspacePaths?: string[] };
      return createDashboardRecord(query.workspacePaths ?? ["/repo/a", "/repo/b"]);
    });

    const { result } = renderHook(() => useWorkAnalysisController(), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
    });

    act(() => {
      result.current.toggleWorkspacePath("/repo/a");
    });

    await waitFor(() => {
      expect(result.current.dashboard?.rankings.projects.map((entry) => entry.label)).toEqual([
        "/repo/a",
      ]);
    });

    expect(result.current.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
  });

  it("rebuilds the dashboard index for the current query and exposes rebuilding state", async () => {
    const rebuildResponse = createDeferred<WorkAnalysisDashboardRecord>();
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(createDashboardRecord())
      .mockReturnValueOnce(rebuildResponse.promise);

    const { result } = renderHook(() => useWorkAnalysisController(), {
      wrapper: createWrapper(sendCommand),
    });

    await waitFor(() => {
      expect(result.current.dashboardRecord).not.toBeNull();
    });

    let rebuildPromise: Promise<void> | undefined;
    act(() => {
      rebuildPromise = result.current.rebuildDashboardIndex();
    });

    expect(result.current.isRebuildingDashboard).toBe(true);
    expect(sendCommand).toHaveBeenLastCalledWith(
      "work.analysis.dashboard.rebuild",
      { timeRange: { preset: "30d" } },
      undefined
    );

    await act(async () => {
      rebuildResponse.resolve(createDashboardRecord(["/repo/rebuilt"]));
      await rebuildPromise;
    });

    expect(result.current.isRebuildingDashboard).toBe(false);
    expect(result.current.dashboard?.rankings.projects.map((entry) => entry.label)).toEqual([
      "/repo/rebuilt",
    ]);
  });
});
