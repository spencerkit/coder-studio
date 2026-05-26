import type { MonitoringResponse, MonitoringSettings } from "@coder-studio/core";
import { createDefaultMonitoringSettings, deriveMonitoringMode } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
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

function renderSubpage(settings: MonitoringSettings) {
  const response = createMonitoringResponse(settings);
  const sendCommand = vi.fn().mockResolvedValue(response);
  const subscribe = vi.fn(() => () => {});
  const onChange = vi.fn();
  const store = createStore();

  store.set(localeAtom, "en");
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand, subscribe } as never);

  return {
    sendCommand,
    subscribe,
    onChange,
    ...render(
      <Provider store={store}>
        <MonitoringSettingsSubpage
          mode={deriveMonitoringMode(settings)}
          onChange={onChange}
          settings={settings}
        />
      </Provider>
    ),
  };
}

function renderStatefulSubpage(options: {
  initialSettings: MonitoringSettings;
  monitoringGetResponse?: MonitoringResponse;
  monitoringRecheckResponse?: MonitoringResponse;
}) {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "monitoring.get") {
      return options.monitoringGetResponse ?? createMonitoringResponse(options.initialSettings);
    }

    if (op === "monitoring.recheck") {
      return options.monitoringRecheckResponse ?? createMonitoringResponse(options.initialSettings);
    }

    throw new Error(`Unexpected command: ${op}`);
  });
  const subscribe = vi.fn(() => () => {});
  const onChange = vi.fn(async () => {});
  const store = createStore();

  store.set(localeAtom, "en");
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand, subscribe } as never);

  function StatefulSubpage() {
    const [settings, setSettings] = useState(options.initialSettings);

    return (
      <MonitoringSettingsSubpage
        mode={deriveMonitoringMode(settings)}
        onChange={async (next) => {
          setSettings(next);
          await onChange(next);
        }}
        settings={settings}
      />
    );
  }

  return {
    sendCommand,
    subscribe,
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

    const { sendCommand, subscribe } = renderSubpage(settings);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getByText("Coder Studio footprint")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(sendCommand).toHaveBeenCalledWith("monitoring.get", {}, undefined);
    expect(subscribe).toHaveBeenCalledWith(["monitoring.snapshot.updated"], expect.any(Function));
  });

  it("keeps monitoring configuration available when monitoring is disabled", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
    };

    renderSubpage(settings);

    expect(await screen.findByText("Monitoring disabled")).toBeInTheDocument();
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

  it("refreshes monitoring data immediately after a successful settings change so the visible view stays in sync", async () => {
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

    const { onChange, sendCommand } = renderStatefulSubpage({
      initialSettings,
      monitoringGetResponse: createMonitoringResponse(initialSettings),
      monitoringRecheckResponse: createMonitoringResponse(disabledSettings),
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(disabledSettings);
    });
    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("monitoring.recheck", {}, undefined);
    });
    expect(await screen.findAllByText("Monitoring disabled")).toHaveLength(2);
    expect(screen.queryByText("Host overview")).not.toBeInTheDocument();
  });
});
