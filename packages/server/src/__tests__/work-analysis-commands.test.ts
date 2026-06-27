import { describe, expect, it, vi } from "vitest";
import { dispatch } from "../ws/dispatch.js";
import "../commands/work-analysis.js";

describe("work analysis commands", () => {
  it("dispatches work.analysis.runBasic with workspacePaths", async () => {
    const ctx = {
      workAnalysisService: {
        runBasic: vi.fn(async () => ({ basicStatus: "running" })),
        runDeep: vi.fn(),
        get: vi.fn(),
      },
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "1",
        op: "work.analysis.runBasic",
        args: { workspacePaths: ["/repo/a"], timeRange: { preset: "7d" } },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.workAnalysisService.runBasic).toHaveBeenCalledWith({
      workspacePaths: ["/repo/a"],
      timeRange: { preset: "7d" },
    });
  });

  it("routes work.analysis.runBasic through the workspace runtime when workspaceId is provided", async () => {
    const executeOnTarget = vi.fn(async () => ({ basicStatus: "running" }));
    const ctx = {
      runtimeRouter: {
        executeOnTarget,
      },
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "1-runtime",
        op: "work.analysis.runBasic",
        args: {
          workspaceId: "ws-wsl",
          workspacePaths: ["/repo/a"],
          timeRange: { preset: "7d" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(executeOnTarget).toHaveBeenCalledWith(
      { kind: "workspace", workspaceId: "ws-wsl" },
      "work.analysis.runBasic",
      {
        workspaceId: "ws-wsl",
        workspacePaths: ["/repo/a"],
        timeRange: { preset: "7d" },
      },
      expect.objectContaining({
        authContext: undefined,
        clientId: undefined,
      })
    );
  });

  it("returns unknown_op for the removed work.analysis.export command", async () => {
    const ctx = {
      workAnalysisService: {
        runBasic: vi.fn(),
        runDeep: vi.fn(),
        get: vi.fn(),
      },
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "2",
        op: "work.analysis.export",
        args: { workspacePaths: ["/repo/a"], timeRange: { preset: "7d" } },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "unknown_op",
      message: "Unknown operation: work.analysis.export",
    });
  });

  it("dispatches work.analysis.dashboard.refresh as a manual refresh", async () => {
    const ctx = {
      workAnalysisService: {
        runBasic: vi.fn(),
        runDeep: vi.fn(),
        get: vi.fn(),
        getDashboard: vi.fn(),
        refreshDashboard: vi.fn(async () => ({
          scanState: { status: "succeeded" },
          dashboard: { rankings: { projects: [], models: [], agents: [] } },
        })),
      },
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "3",
        op: "work.analysis.dashboard.refresh",
        args: { workspacePaths: ["/repo/a"], timeRange: { preset: "7d" } },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.workAnalysisService.refreshDashboard).toHaveBeenCalledWith(
      {
        workspacePaths: ["/repo/a"],
        timeRange: { preset: "7d" },
      },
      "manual"
    );
  });

  it("routes work.analysis.dashboard.refresh through the workspace runtime when workspaceId is provided", async () => {
    const executeOnTarget = vi.fn(async () => ({
      scanState: { status: "succeeded" },
      dashboard: { rankings: { projects: [], models: [], agents: [] } },
    }));
    const ctx = {
      runtimeRouter: {
        executeOnTarget,
      },
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "3-runtime",
        op: "work.analysis.dashboard.refresh",
        args: {
          workspaceId: "ws-wsl",
          workspacePaths: ["/repo/a"],
          timeRange: { preset: "7d" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(executeOnTarget).toHaveBeenCalledWith(
      { kind: "workspace", workspaceId: "ws-wsl" },
      "work.analysis.dashboard.refresh",
      {
        workspaceId: "ws-wsl",
        workspacePaths: ["/repo/a"],
        timeRange: { preset: "7d" },
      },
      expect.objectContaining({
        authContext: undefined,
        clientId: undefined,
      })
    );
  });

  it("dispatches work.analysis.dashboard.rebuild to clear and rebuild the hourly index", async () => {
    const ctx = {
      workAnalysisService: {
        runBasic: vi.fn(),
        runDeep: vi.fn(),
        get: vi.fn(),
        getDashboard: vi.fn(),
        refreshDashboard: vi.fn(),
        rebuildDashboardIndex: vi.fn(async () => ({
          scanState: { status: "succeeded" },
          dashboard: { rankings: { projects: [], models: [], agents: [] } },
        })),
      },
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "4",
        op: "work.analysis.dashboard.rebuild",
        args: { workspacePaths: ["/repo/a"], timeRange: { preset: "7d" } },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.workAnalysisService.rebuildDashboardIndex).toHaveBeenCalledWith({
      workspacePaths: ["/repo/a"],
      timeRange: { preset: "7d" },
    });
  });
});
