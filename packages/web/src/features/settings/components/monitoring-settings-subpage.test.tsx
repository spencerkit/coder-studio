import type { MonitoringResponse, MonitoringSettings } from "@coder-studio/core";
import { createDefaultMonitoringSettings, deriveMonitoringMode } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import type { UseMonitoringDataResult } from "../../monitoring";
import { MonitoringSettingsSubpage } from "./monitoring-settings-subpage";

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
  monitoringData = createMonitoringDataResult(settings)
) {
  const onChange = vi.fn();
  const store = createStore();

  store.set(localeAtom, "en");

  return {
    monitoringData,
    onChange,
    ...render(
      <Provider store={store}>
        <MonitoringSettingsSubpage
          mode={deriveMonitoringMode(settings)}
          monitoringData={monitoringData}
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
  it("renders monitoring data and configuration controls together on desktop", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    const { monitoringData } = renderSubpage(settings);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getByText("Coder Studio footprint")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(monitoringData.refresh).not.toHaveBeenCalled();
  });

  it("keeps monitoring configuration available when monitoring is disabled", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
    };

    renderSubpage(settings);

    expect(await screen.findAllByText("Monitoring disabled")).toHaveLength(2);
    expect(
      screen.getByText(
        "No background sampling is running. Enable monitoring in settings before using this page."
      )
    ).toBeInTheDocument();
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
});
