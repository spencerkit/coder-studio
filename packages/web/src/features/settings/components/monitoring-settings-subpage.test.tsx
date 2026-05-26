import type { MonitoringResponse, MonitoringSettings } from "@coder-studio/core";
import { createDefaultMonitoringSettings, deriveMonitoringMode } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import type { UseMonitoringDataResult } from "../../monitoring";
import { MonitoringSettingsSubpage } from "./monitoring-settings-subpage";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

function createMonitoringResponse(settings: MonitoringSettings): MonitoringResponse {
  return {
    settings,
    snapshot: {
      sampledAt: 1_000_000,
      mode: deriveMonitoringMode(settings),
      host: settings.enabled
        ? {
            cpuPercent: 24,
            memoryUsedBytes: 512,
            memoryTotalBytes: 1024,
            memoryAvailableBytes: 512,
            loadAverage: [0.4, 0.3, 0.2],
            uptimeSec: 120,
            pressure: "normal",
          }
        : null,
      runtime: settings.enabled
        ? {
            serverCpuPercent: 8,
            serverMemoryBytes: 128,
            totalManagedCpuPercent: 16,
            totalManagedMemoryBytes: 256,
            managedProcessCount: 3,
            cpuShareOfHostPercent: 66.6,
            memoryShareOfHostPercent: 50,
          }
        : null,
      workspaces: [],
      sessions: [],
      subprocessGroups: [],
      backgroundGroups: [],
    },
    history: {
      host: { points: [{ sampledAt: 1_000_000, cpuPercent: 24, memoryBytes: 512 }] },
      runtime: settings.enabled
        ? { points: [{ sampledAt: 1_000_000, cpuPercent: 16, memoryBytes: 256, processCount: 3 }] }
        : null,
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
}

function createMonitoringDataResult(
  settings: MonitoringSettings,
  overrides: Partial<UseMonitoringDataResult> = {}
): UseMonitoringDataResult {
  return {
    error: null,
    loading: false,
    refresh: vi.fn(async () => {}),
    response: createMonitoringResponse(settings),
    ...overrides,
  };
}

function renderSubpage(
  settings: MonitoringSettings,
  monitoringData = createMonitoringDataResult(settings),
  {
    monitoringSettingsReady = true,
    viewport = "desktop",
  }: {
    monitoringSettingsReady?: boolean;
    viewport?: "desktop" | "mobile";
  } = {}
) {
  const onChange = vi.fn();
  const store = createStore();

  store.set(localeAtom, "en");
  viewportMocks.viewport = viewport;

  return {
    monitoringData,
    onChange,
    ...render(
      <Provider store={store}>
        <MonitoringSettingsSubpage
          mode={deriveMonitoringMode(settings)}
          monitoringData={monitoringData}
          monitoringSettingsReady={monitoringSettingsReady}
          onChange={onChange}
          settings={settings}
        />
      </Provider>
    ),
  };
}

function renderStatefulSubpage(options: {
  initialSettings: MonitoringSettings;
  nextMonitoringResponse?: MonitoringResponse;
}) {
  const onChange = vi.fn(async () => {});
  const store = createStore();
  const refresh = vi.fn(async () => {});

  store.set(localeAtom, "en");
  viewportMocks.viewport = "desktop";

  function StatefulSubpage() {
    const [settings, setSettings] = useState(options.initialSettings);
    const [response, setResponse] = useState(createMonitoringResponse(options.initialSettings));
    const handleRefresh = async () => {
      await refresh();
      setResponse(
        options.nextMonitoringResponse ?? createMonitoringResponse(options.initialSettings)
      );
    };
    const monitoringData: UseMonitoringDataResult = {
      error: null,
      loading: false,
      refresh: handleRefresh,
      response,
    };

    return (
      <MonitoringSettingsSubpage
        mode={deriveMonitoringMode(settings)}
        monitoringData={monitoringData}
        monitoringSettingsReady
        onChange={async (next) => {
          setSettings(next);
          await onChange(next);
        }}
        settings={settings}
      />
    );
  }

  return {
    refresh,
    onChange,
    ...render(
      <Provider store={store}>
        <StatefulSubpage />
      </Provider>
    ),
  };
}

describe("MonitoringSettingsSubpage", () => {
  it("renders distinct stage and dock regions on desktop", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    const { container, monitoringData } = renderSubpage(
      settings,
      createMonitoringDataResult(settings),
      {
        viewport: "desktop",
      }
    );

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-shell")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-stage")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-dock")).toBeInTheDocument();
    expect(
      container.querySelector(".settings-monitoring-stage .monitoring-toolbar")
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getByText("Coder Studio footprint")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    expect(monitoringData.refresh).not.toHaveBeenCalled();
  });

  it("keeps data first and configuration collapsed on mobile without the old segmented nav", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    const { container } = renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "mobile",
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    const shell = container.querySelector(".settings-monitoring-shell");
    expect(shell).toBeInTheDocument();
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-stage");
    expect(container.querySelector(".settings-monitoring-dock-toggle")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Attribution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Process" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
  });

  it("auto-expands monitoring configuration and moves it first on mobile when monitoring is disabled", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
    };

    const { container } = renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "mobile",
    });

    expect(await screen.findAllByText("Monitoring disabled")).toHaveLength(2);
    expect(
      screen.getByText(
        "No background sampling is running. Enable monitoring in settings before using this page."
      )
    ).toBeInTheDocument();
    const shell = container.querySelector(".settings-monitoring-shell");
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-dock");
    expect(container.querySelector(".settings-monitoring-dock-toggle")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Host metrics" })).toBeDisabled();
    });
  });

  it("does not trigger monitoring refresh directly after a successful settings change", async () => {
    const initialSettings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };
    const disabledSettings = {
      ...initialSettings,
      enabled: false,
    };

    const { onChange, refresh } = renderStatefulSubpage({
      initialSettings,
      nextMonitoringResponse: createMonitoringResponse(disabledSettings),
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(disabledSettings);
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Host overview")).toBeInTheDocument();
  });

  it("disables monitoring controls before monitoring settings are ready", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    const { onChange } = renderSubpage(settings, createMonitoringDataResult(settings), {
      monitoringSettingsReady: false,
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeDisabled();
    expect(screen.getByRole("tablist", { name: "Preset" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
