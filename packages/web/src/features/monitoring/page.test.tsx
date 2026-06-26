import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import * as monitoringExports from "./index";
import * as monitoringPageExports from "./page";
import { MonitoringContent, MonitoringPage } from "./page";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderMonitoringPage(
  response: unknown,
  viewport: "desktop" | "mobile" = "desktop",
  options: {
    locale?: "en" | "zh";
    sendCommand?: ReturnType<typeof vi.fn>;
  } = {}
) {
  viewportMocks.viewport = viewport;

  const subscribe = vi.fn(
    (_topics: string[], handler: (topic: string, payload: unknown) => void) => {
      handler("monitoring.snapshot.updated", response);
      return () => {};
    }
  );
  const sendCommand = options.sendCommand ?? vi.fn().mockResolvedValue(response);

  const store = createStore();
  store.set(localeAtom, options.locale ?? "en");
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand, subscribe } as never);

  return {
    sendCommand,
    subscribe,
    ...render(
      <Provider store={store}>
        <MonitoringContent />
      </Provider>
    ),
  };
}

describe("MonitoringContent", () => {
  it("exports reusable monitoring primitives from the feature entrypoint", () => {
    expect(monitoringExports.MonitoringContent).toBeDefined();
    expect(monitoringExports.MonitoringPage).toBeDefined();
    expect(monitoringExports.useMonitoringData).toBeDefined();
  });

  it("exports a standalone MonitoringPage wrapper from the page module", () => {
    expect("MonitoringPage" in monitoringPageExports).toBe(true);
  });

  it("renders reusable monitoring content without standalone page chrome", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 3, name: "Performance monitoring" })
    ).not.toBeInTheDocument();
  });

  it("renders a standalone monitoring page wrapper with page chrome", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    const subscribe = vi.fn(() => () => {});
    const sendCommand = vi.fn().mockResolvedValue(response);
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand, subscribe } as never);

    render(
      <Provider store={store}>
        <MonitoringPage />
      </Provider>
    );

    expect(await screen.findByTestId("monitoring-page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Performance monitoring" })
    ).toBeInTheDocument();
  });

  it("loads the snapshot, subscribes for updates, and renders host plus runtime sections", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "ws-1",
            cpuPercent: 30,
            memoryBytes: 300,
            processCount: 4,
            uptimeSec: 60,
            trend: "steady",
          },
        ],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    const { sendCommand, subscribe } = renderMonitoringPage(response);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(sendCommand).toHaveBeenCalledWith("monitoring.get", {}, undefined);
    expect(subscribe).toHaveBeenCalledWith(["monitoring.snapshot.updated"], expect.any(Function));
    expect(screen.getByText("Host overview")).toBeInTheDocument();
    expect(screen.getByText("Coder Studio footprint")).toBeInTheDocument();
    expect(screen.getAllByText("ws-1").length).toBeGreaterThan(1);
  });

  it("does not let a late monitoring.get response overwrite a newer monitoring.recheck response", async () => {
    const initialDeferred = createDeferred<unknown>();
    const refreshDeferred = createDeferred<unknown>();
    const subscribe = vi.fn(() => () => {});
    const staleResponse = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 5000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "light",
        host: {
          cpuPercent: 30,
          memoryUsedBytes: 300,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 700,
          loadAverage: [0.3, 0.2, 0.1],
          uptimeSec: 60,
          pressure: "normal",
        },
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };
    const freshResponse = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 20,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 20, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 20, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "monitoring.get") {
        return initialDeferred.promise;
      }
      if (op === "monitoring.recheck") {
        return refreshDeferred.promise;
      }
      throw new Error(`Unexpected command: ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand, subscribe } as never);

    render(
      <Provider store={store}>
        <MonitoringContent />
      </Provider>
    );

    expect(await screen.findByText("Loading monitoring snapshot...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh monitoring" }));

    await act(async () => {
      refreshDeferred.resolve(freshResponse);
    });

    expect(await screen.findByRole("button", { name: "Refresh monitoring" })).toBeInTheDocument();
    expect(screen.getByText("Elevated")).toBeInTheDocument();

    await act(async () => {
      initialDeferred.resolve(staleResponse);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh monitoring" })).toBeInTheDocument();
    });
    expect(screen.getByText("Elevated")).toBeInTheDocument();
    expect(screen.queryByText("Normal")).not.toBeInTheDocument();
  });

  it("renders localized monitoring labels instead of raw enum values", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response, "desktop", { locale: "zh" });

    expect(await screen.findByText("时间窗口")).toBeInTheDocument();
    expect(screen.getAllByText("标准").length).toBeGreaterThan(0);
    expect(screen.getByText("偏高")).toBeInTheDocument();
    expect(screen.queryByText("Time window")).not.toBeInTheDocument();
    expect(screen.queryByText("standard")).not.toBeInTheDocument();
    expect(screen.queryByText("elevated")).not.toBeInTheDocument();
  });

  it("renders a disabled empty state that links to settings from the standalone wrapper", async () => {
    const response = {
      settings: {
        enabled: false,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 0,
        mode: "disabled",
        host: null,
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Monitoring disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
  });

  it("renders a disabled empty state without a standalone settings CTA", async () => {
    const response = {
      settings: {
        enabled: false,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 0,
        mode: "disabled",
        host: null,
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Monitoring disabled")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No background sampling is running. Enable monitoring in settings before using this page."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
  });

  it("renders monitoring sections sequentially on mobile without the legacy segmented nav", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: false,
        workspaceAttributionEnabled: false,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 5000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "light",
        host: {
          cpuPercent: 30,
          memoryUsedBytes: 300,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 700,
          loadAverage: [0.3, 0.2, 0.1],
          uptimeSec: 60,
          pressure: "normal",
        },
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response, "mobile");

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Attribution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Process" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Enable runtime summary in settings").length).toBeGreaterThan(0);
  });

  it("renders hierarchical attribution and keeps subprocesses out of the attribution tree until drill-down is enabled", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "standard",
        host: {
          cpuPercent: 85,
          memoryUsedBytes: 1_600,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 400,
          loadAverage: [2.4, 1.9, 1.2],
          uptimeSec: 3600,
          pressure: "hot",
        },
        runtime: {
          serverCpuPercent: 14,
          serverMemoryBytes: 180,
          totalManagedCpuPercent: 61,
          totalManagedMemoryBytes: 900,
          managedProcessCount: 7,
          cpuShareOfHostPercent: 71.7,
          memoryShareOfHostPercent: 45,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 42,
            memoryBytes: 600,
            processCount: 4,
            uptimeSec: 500,
            trend: "rising",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Codex",
            cpuPercent: 27,
            memoryBytes: 320,
            processCount: 2,
            uptimeSec: 220,
            trend: "steady",
          },
        ],
        subprocessGroups: [
          {
            id: "subprocess:sess-1:101",
            parentId: "session:sess-1",
            kind: "subprocess_group",
            label: "python tool.py",
            cpuPercent: 12,
            memoryBytes: 140,
            processCount: 1,
            uptimeSec: 80,
            trend: "steady",
          },
        ],
        backgroundGroups: [],
      },
      history: {
        host: {
          points: [
            { sampledAt: 100_000, cpuPercent: 12, memoryBytes: 400 },
            { sampledAt: 900_000, cpuPercent: 85, memoryBytes: 1_600 },
          ],
        },
        runtime: {
          points: [
            { sampledAt: 100_000, cpuPercent: 22, memoryBytes: 500, processCount: 5 },
            { sampledAt: 900_000, cpuPercent: 61, memoryBytes: 900, processCount: 7 },
          ],
        },
        workspaces: {
          "workspace:ws-1": {
            points: [
              { sampledAt: 100_000, cpuPercent: 20, memoryBytes: 300, processCount: 2 },
              { sampledAt: 900_000, cpuPercent: 42, memoryBytes: 600, processCount: 4 },
            ],
          },
        },
        sessions: {
          "session:sess-1": {
            points: [
              { sampledAt: 100_000, cpuPercent: 11, memoryBytes: 180, processCount: 1 },
              { sampledAt: 900_000, cpuPercent: 27, memoryBytes: 320, processCount: 2 },
            ],
          },
        },
        subprocessGroups: {
          "subprocess:sess-1:101": {
            points: [
              { sampledAt: 100_000, cpuPercent: 5, memoryBytes: 60, processCount: 1 },
              { sampledAt: 900_000, cpuPercent: 12, memoryBytes: 140, processCount: 1 },
            ],
          },
        },
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByRole("button", { name: "Refresh monitoring" })).toBeInTheDocument();
    expect(screen.getAllByText("Workspace Alpha").length).toBeGreaterThan(1);
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.queryByText("python tool.py")).not.toBeInTheDocument();

    expect(screen.getByText("Workspace total · 42.0% / 600 B")).toBeInTheDocument();
    expect(screen.getByText("Session · 27.0% / 320 B")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Session Codex 27.0% / 320 B" }));
    expect(screen.getByText("Detail panel")).toBeInTheDocument();
    expect(screen.getAllByText("Codex")).toHaveLength(2);
    expect(
      screen.getByText("Select a workspace, session, or process to inspect details.")
    ).toBeInTheDocument();
  });

  it("renders monitoring sections in health-first order without the legacy refresh summary card", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "standard",
        host: {
          cpuPercent: 85,
          memoryUsedBytes: 1_600,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 400,
          loadAverage: [2.4, 1.9, 1.2],
          uptimeSec: 3600,
          pressure: "hot",
        },
        runtime: {
          serverCpuPercent: 14,
          serverMemoryBytes: 180,
          totalManagedCpuPercent: 61,
          totalManagedMemoryBytes: 900,
          managedProcessCount: 7,
          cpuShareOfHostPercent: 71.7,
          memoryShareOfHostPercent: 45,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 42,
            memoryBytes: 600,
            processCount: 4,
            uptimeSec: 500,
            trend: "rising",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Claude session",
            cpuPercent: 27,
            memoryBytes: 320,
            processCount: 2,
            uptimeSec: 220,
            trend: "steady",
          },
        ],
        subprocessGroups: [
          {
            id: "subprocess:sess-1:101",
            parentId: "session:sess-1",
            kind: "subprocess_group",
            label: "python tool.py",
            cpuPercent: 12,
            memoryBytes: 140,
            processCount: 1,
            uptimeSec: 80,
            trend: "steady",
          },
        ],
        backgroundGroups: [],
      },
      history: {
        host: {
          points: [
            { sampledAt: 100_000, cpuPercent: 12, memoryBytes: 400 },
            { sampledAt: 900_000, cpuPercent: 85, memoryBytes: 1_600 },
          ],
        },
        runtime: {
          points: [
            { sampledAt: 100_000, cpuPercent: 22, memoryBytes: 500, processCount: 5 },
            { sampledAt: 900_000, cpuPercent: 61, memoryBytes: 900, processCount: 7 },
          ],
        },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.queryByText("Refresh every 2s")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Host overview",
      "Coder Studio footprint",
      "Attribution tree",
      "Detail panel",
      "Subprocess drill-down",
      "Background runtime",
    ]);
  });

  it("renders the selected entity detail inline on mobile before subprocess drill-down", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "standard",
        host: {
          cpuPercent: 85,
          memoryUsedBytes: 1_600,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 400,
          loadAverage: [2.4, 1.9, 1.2],
          uptimeSec: 3600,
          pressure: "hot",
        },
        runtime: {
          serverCpuPercent: 14,
          serverMemoryBytes: 180,
          totalManagedCpuPercent: 61,
          totalManagedMemoryBytes: 900,
          managedProcessCount: 7,
          cpuShareOfHostPercent: 71.7,
          memoryShareOfHostPercent: 45,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 42,
            memoryBytes: 600,
            processCount: 4,
            uptimeSec: 500,
            trend: "rising",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Claude session",
            cpuPercent: 27,
            memoryBytes: 320,
            processCount: 2,
            uptimeSec: 220,
            trend: "steady",
          },
        ],
        subprocessGroups: [
          {
            id: "subprocess:sess-1:101",
            parentId: "session:sess-1",
            kind: "subprocess_group",
            label: "python tool.py",
            cpuPercent: 12,
            memoryBytes: 140,
            processCount: 1,
            uptimeSec: 80,
            trend: "steady",
          },
        ],
        backgroundGroups: [],
      },
      history: {
        host: {
          points: [
            { sampledAt: 100_000, cpuPercent: 12, memoryBytes: 400 },
            { sampledAt: 900_000, cpuPercent: 85, memoryBytes: 1_600 },
          ],
        },
        runtime: {
          points: [
            { sampledAt: 100_000, cpuPercent: 22, memoryBytes: 500, processCount: 5 },
            { sampledAt: 900_000, cpuPercent: 61, memoryBytes: 900, processCount: 7 },
          ],
        },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response, "mobile");

    expect((await screen.findAllByText("Workspace Alpha")).length).toBeGreaterThan(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Session Claude session 27.0% / 320 B",
      })
    );

    expect(screen.getByRole("heading", { level: 2, name: "Detail panel" })).toBeInTheDocument();
    expect(screen.getAllByText("Claude session")).toHaveLength(2);
    expect(
      screen
        .getByRole("heading", { level: 2, name: "Detail panel" })
        .compareDocumentPosition(
          screen.getByRole("heading", { level: 2, name: "Subprocess drill-down" })
        ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders subprocess labels inside overflow-safe title and path containers", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "deep",
        host: {
          cpuPercent: 85,
          memoryUsedBytes: 1_600,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 400,
          loadAverage: [2.4, 1.9, 1.2],
          uptimeSec: 3600,
          pressure: "hot",
        },
        runtime: {
          serverCpuPercent: 14,
          serverMemoryBytes: 180,
          totalManagedCpuPercent: 61,
          totalManagedMemoryBytes: 900,
          managedProcessCount: 7,
          cpuShareOfHostPercent: 71.7,
          memoryShareOfHostPercent: 45,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 42,
            memoryBytes: 600,
            processCount: 4,
            uptimeSec: 500,
            trend: "rising",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Claude session",
            cpuPercent: 27,
            memoryBytes: 320,
            processCount: 2,
            uptimeSec: 220,
            trend: "steady",
          },
        ],
        subprocessGroups: [
          {
            id: "subprocess:sess-1:101",
            parentId: "session:sess-1",
            kind: "subprocess_group",
            label:
              "/home/spencer/.local/share/fnm/node-versions/v25.9.0/installation/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
            cpuPercent: 12,
            memoryBytes: 140,
            processCount: 1,
            uptimeSec: 80,
            trend: "steady",
          },
        ],
        backgroundGroups: [],
      },
      history: {
        host: {
          points: [
            { sampledAt: 100_000, cpuPercent: 12, memoryBytes: 400 },
            { sampledAt: 900_000, cpuPercent: 85, memoryBytes: 1_600 },
          ],
        },
        runtime: {
          points: [
            { sampledAt: 100_000, cpuPercent: 22, memoryBytes: 500, processCount: 5 },
            { sampledAt: 900_000, cpuPercent: 61, memoryBytes: 900, processCount: 7 },
          ],
        },
        workspaces: {},
        sessions: {},
        subprocessGroups: {
          "subprocess:sess-1:101": {
            points: [
              { sampledAt: 100_000, cpuPercent: 5, memoryBytes: 60, processCount: 1 },
              { sampledAt: 900_000, cpuPercent: 12, memoryBytes: 140, processCount: 1 },
            ],
          },
        },
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    const longPath =
      "/home/spencer/.local/share/fnm/node-versions/v25.9.0/installation/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex";

    expect(await screen.findByText("Subprocess drill-down")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Subprocess ${longPath} 12.0% / 140 B`,
      })
    );

    expect(document.querySelector(".monitoring-detail__path")).toHaveTextContent(longPath);
    expect(
      screen
        .getByRole("button", {
          name: `Subprocess ${longPath} 12.0% / 140 B`,
        })
        .querySelector(".monitoring-entity-row__title")
    ).toHaveTextContent(longPath);
  });

  it("filters sparkline history to the selected time window", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "standard",
        host: {
          cpuPercent: 85,
          memoryUsedBytes: 1_600,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 400,
          loadAverage: [2.4, 1.9, 1.2],
          uptimeSec: 3600,
          pressure: "hot",
        },
        runtime: {
          serverCpuPercent: 14,
          serverMemoryBytes: 180,
          totalManagedCpuPercent: 61,
          totalManagedMemoryBytes: 900,
          managedProcessCount: 7,
          cpuShareOfHostPercent: 71.7,
          memoryShareOfHostPercent: 45,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: {
          points: [
            { sampledAt: 100_000, cpuPercent: 12, memoryBytes: 400 },
            { sampledAt: 900_000, cpuPercent: 85, memoryBytes: 1_600 },
          ],
        },
        runtime: {
          points: [
            { sampledAt: 100_000, cpuPercent: 22, memoryBytes: 500, processCount: 5 },
            { sampledAt: 900_000, cpuPercent: 61, memoryBytes: 900, processCount: 7 },
          ],
        },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    const { container } = renderMonitoringPage(response);

    expect(await screen.findByRole("button", { name: "Refresh monitoring" })).toBeInTheDocument();
    const hostPolyline = () =>
      container.querySelector(".monitoring-overview-grid .monitoring-sparkline polyline");

    expect(hostPolyline()?.getAttribute("points")?.split(" ")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "5m" }));
    expect(hostPolyline()?.getAttribute("points")?.split(" ")).toHaveLength(1);
  });

  it("shows subprocess drill-down on desktop when enabled", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
        sampleIntervalMs: 5000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "deep",
        host: {
          cpuPercent: 33,
          memoryUsedBytes: 700,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 1_300,
          loadAverage: [0.8, 0.6, 0.4],
          uptimeSec: 120,
          pressure: "normal",
        },
        runtime: {
          serverCpuPercent: 9,
          serverMemoryBytes: 150,
          totalManagedCpuPercent: 24,
          totalManagedMemoryBytes: 360,
          managedProcessCount: 3,
          cpuShareOfHostPercent: 27,
          memoryShareOfHostPercent: 18,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 24,
            memoryBytes: 360,
            processCount: 3,
            uptimeSec: 120,
            trend: "steady",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Claude session",
            cpuPercent: 18,
            memoryBytes: 280,
            processCount: 2,
            uptimeSec: 100,
            trend: "steady",
          },
        ],
        subprocessGroups: [
          {
            id: "subprocess:sess-1:201",
            parentId: "session:sess-1",
            kind: "subprocess_group",
            label: "python indexer.py",
            cpuPercent: 7,
            memoryBytes: 120,
            processCount: 1,
            uptimeSec: 40,
            trend: "steady",
          },
        ],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 900_000, cpuPercent: 33, memoryBytes: 700 }] },
        runtime: {
          points: [{ sampledAt: 900_000, cpuPercent: 24, memoryBytes: 360, processCount: 3 }],
        },
        workspaces: {},
        sessions: {},
        subprocessGroups: {
          "subprocess:sess-1:201": {
            points: [{ sampledAt: 900_000, cpuPercent: 7, memoryBytes: 120, processCount: 1 }],
          },
        },
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Subprocess drill-down")).toBeInTheDocument();
    expect(screen.getByText("python indexer.py")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Subprocess python indexer.py 7.0% / 120 B" })
    );
    expect(screen.getByText("Detail panel")).toBeInTheDocument();
  });

  it("shows subprocess drill-down in the mobile process section when enabled", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
        sampleIntervalMs: 5000,
      },
      snapshot: {
        sampledAt: 1_000_000,
        mode: "deep",
        host: {
          cpuPercent: 33,
          memoryUsedBytes: 700,
          memoryTotalBytes: 2_000,
          memoryAvailableBytes: 1_300,
          loadAverage: [0.8, 0.6, 0.4],
          uptimeSec: 120,
          pressure: "normal",
        },
        runtime: {
          serverCpuPercent: 9,
          serverMemoryBytes: 150,
          totalManagedCpuPercent: 24,
          totalManagedMemoryBytes: 360,
          managedProcessCount: 3,
          cpuShareOfHostPercent: 27,
          memoryShareOfHostPercent: 18,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 24,
            memoryBytes: 360,
            processCount: 3,
            uptimeSec: 120,
            trend: "steady",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Claude session",
            cpuPercent: 18,
            memoryBytes: 280,
            processCount: 2,
            uptimeSec: 100,
            trend: "steady",
          },
        ],
        subprocessGroups: [
          {
            id: "subprocess:sess-1:201",
            parentId: "session:sess-1",
            kind: "subprocess_group",
            label: "python indexer.py",
            cpuPercent: 7,
            memoryBytes: 120,
            processCount: 1,
            uptimeSec: 40,
            trend: "steady",
          },
        ],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 900_000, cpuPercent: 33, memoryBytes: 700 }] },
        runtime: {
          points: [{ sampledAt: 900_000, cpuPercent: 24, memoryBytes: 360, processCount: 3 }],
        },
        workspaces: {},
        sessions: {},
        subprocessGroups: {
          "subprocess:sess-1:201": {
            points: [{ sampledAt: 900_000, cpuPercent: 7, memoryBytes: 120, processCount: 1 }],
          },
        },
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response, "mobile");

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.getByText("python indexer.py")).toBeInTheDocument();
  });

  it("does not render stale host history when host metrics are unavailable", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: false,
        runtimeSummaryEnabled: false,
        workspaceAttributionEnabled: false,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "light",
        host: null,
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    const { container } = renderMonitoringPage(response);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(container.querySelector(".monitoring-overview-grid .monitoring-sparkline")).toBeNull();
  });

  it("shows an unavailable message instead of a disabled message when process collection degrades", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: {
        durationMs: 20,
        processRowCount: 0,
        subprocessGroupCount: 0,
        historyTrimmed: false,
        degraded: true,
        failureReason: "ps failed",
      },
    };

    renderMonitoringPage(response);

    expect((await screen.findAllByText("Process metrics unavailable")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Process collection is temporarily unavailable.").length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Enable runtime summary in settings")).not.toBeInTheDocument();
  });

  it("surfaces refresh failures without dropping the current snapshot", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };
    const sendCommand = vi.fn().mockImplementation(async (command: string) => {
      if (command === "monitoring.get") {
        return response;
      }
      throw new Error("refresh exploded");
    });

    renderMonitoringPage(response, "desktop", { sendCommand });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh monitoring" }));

    expect(await screen.findByText("Could not refresh monitoring")).toBeInTheDocument();
    expect(screen.getByText("refresh exploded")).toBeInTheDocument();
    expect(screen.getByText("Host overview")).toBeInTheDocument();
  });

  it("shows a waiting message before the first process sample arrives", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(
      (await screen.findAllByText("Waiting for the first process sample.")).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Enable runtime summary in settings")).not.toBeInTheDocument();
  });

  it("renders background runtime groups so LSP processes are visible in the dashboard", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 17,
          totalManagedMemoryBytes: 250,
          managedProcessCount: 2,
          cpuShareOfHostPercent: 23.61,
          memoryShareOfHostPercent: 25,
        },
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [
          {
            id: "background:lsp:ws-1:typescript",
            kind: "background_group",
            label: "TypeScript language server",
            cpuPercent: 7,
            memoryBytes: 150,
            processCount: 1,
            uptimeSec: 45,
            trend: "steady",
          },
        ],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 17, memoryBytes: 250, processCount: 2 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Background runtime")).toBeInTheDocument();
    expect(screen.getAllByText("TypeScript language server").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Background task TypeScript language server 7.0% / 150 B",
      })
    );

    expect(screen.getByText("Detail panel")).toBeInTheDocument();
    expect(screen.getAllByText("TypeScript language server")).toHaveLength(2);
  });

  it("renders workspace-scoped background groups inside the attribution tree instead of background runtime", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 23,
          totalManagedMemoryBytes: 430,
          managedProcessCount: 3,
          cpuShareOfHostPercent: 31.94,
          memoryShareOfHostPercent: 43,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "Workspace Alpha",
            cpuPercent: 16,
            memoryBytes: 310,
            processCount: 2,
            uptimeSec: 80,
            trend: "steady",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "Claude session",
            cpuPercent: 9,
            memoryBytes: 160,
            processCount: 1,
            uptimeSec: 40,
            trend: "steady",
          },
        ],
        subprocessGroups: [],
        backgroundGroups: [
          {
            id: "background:lsp:ws-1:typescript",
            parentId: "workspace:ws-1",
            workspaceId: "ws-1",
            kind: "background_group",
            label: "TypeScript language server",
            cpuPercent: 7,
            memoryBytes: 150,
            processCount: 1,
            uptimeSec: 45,
            trend: "steady",
          },
          {
            id: "background:installer:1",
            kind: "background_group",
            label: "Extension installer",
            cpuPercent: 2,
            memoryBytes: 120,
            processCount: 1,
            uptimeSec: 15,
            trend: "steady",
          },
        ],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 23, memoryBytes: 430, processCount: 3 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Attribution tree")).toBeInTheDocument();

    const attributionTree = screen
      .getByRole("heading", { level: 2, name: "Attribution tree" })
      .closest(".monitoring-tree");
    const backgroundRuntime = screen
      .getByRole("heading", { level: 2, name: "Background runtime" })
      .closest("section");

    expect(attributionTree).not.toBeNull();
    expect(backgroundRuntime).not.toBeNull();

    expect(
      within(attributionTree as HTMLElement).getByRole("button", {
        name: "Background task TypeScript language server 7.0% / 150 B",
      })
    ).toBeInTheDocument();
    expect(
      within(attributionTree as HTMLElement).getByText("Background task · 7.0% / 150 B")
    ).toBeInTheDocument();

    expect(
      within(backgroundRuntime as HTMLElement).queryByText("TypeScript language server")
    ).not.toBeInTheDocument();
    expect(
      within(backgroundRuntime as HTMLElement).getByText("Extension installer")
    ).toBeInTheDocument();
  });
});
