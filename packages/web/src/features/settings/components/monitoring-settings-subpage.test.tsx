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
  viewport?: "desktop" | "mobile";
  refreshError?: Error;
}) {
  const onChange = vi.fn(async (_next: MonitoringSettings) => {});
  const store = createStore();
  const refresh = vi.fn(async () => {});

  store.set(localeAtom, "en");
  viewportMocks.viewport = options.viewport ?? "desktop";

  function StatefulSubpage() {
    const [settings, setSettings] = useState(options.initialSettings);
    const [response, setResponse] = useState(createMonitoringResponse(options.initialSettings));
    const [error, setError] = useState<string | null>(null);
    const handleRefresh = async () => {
      await refresh();
      if (options.refreshError) {
        setError(options.refreshError.message);
        throw options.refreshError;
      }
      setResponse(
        options.nextMonitoringResponse ?? createMonitoringResponse(options.initialSettings)
      );
      setError(null);
    };
    const monitoringData: UseMonitoringDataResult = {
      error,
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
  it("renders a unified control-first shell on desktop", async () => {
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
    const shell = container.querySelector(".settings-monitoring-shell");
    expect(shell).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-control-bar")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-stage")).not.toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-dock")).not.toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-mobile-entry")).not.toBeInTheDocument();
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(shell?.lastElementChild).toHaveClass("settings-monitoring-dashboard-stage");
    expect(
      container.querySelector(".settings-monitoring-dashboard-stage .monitoring-toolbar")
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

  it("keeps the same control-first shell on mobile without a configuration entry card", async () => {
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
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(shell?.lastElementChild).toHaveClass("settings-monitoring-dashboard-stage");
    expect(container.querySelector(".settings-monitoring-stage")).not.toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-dock")).not.toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-mobile-entry")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show advanced monitoring settings" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Attribution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Process" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
  });

  it("keeps advanced monitoring settings hidden until the disclosure is opened", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: true,
    };

    renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "mobile",
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    const disclosureButton = screen.getByRole("button", {
      name: "Show advanced monitoring settings",
    });
    expect(disclosureButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Runtime summary" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "Workspace and session attribution" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Subprocess drill-down" })).not.toBeInTheDocument();

    fireEvent.click(disclosureButton);

    expect(disclosureButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Runtime summary" })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Workspace and session attribution" })
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Subprocess drill-down" })).toBeInTheDocument();
  });

  it("auto-expands advanced monitoring settings on mobile when monitoring is disabled", async () => {
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
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(container.querySelector(".settings-monitoring-dock-toggle")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open monitoring configuration" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show advanced monitoring settings" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Host metrics" })).toBeDisabled();
    });
  });

  it("does not trigger monitoring refresh directly after a successful settings change and keeps stage gating aligned", async () => {
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
    expect(screen.getAllByText("Monitoring disabled").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(
        "No background sampling is running. Enable monitoring in settings before using this page."
      ).length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Host overview")).not.toBeInTheDocument();
  });

  it("falls back to an enabled waiting stage when enable succeeds but recheck fails", async () => {
    const disabledSettings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };
    const enabledSettings = {
      ...disabledSettings,
      enabled: true,
    };

    renderSubpage(
      enabledSettings,
      createMonitoringDataResult(enabledSettings, {
        error: "recheck failed",
        response: createMonitoringResponse(disabledSettings),
      })
    );

    expect(
      await screen.findByRole("switch", { name: "Enable performance monitoring" })
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Monitoring disabled")).not.toBeInTheDocument();
    expect(screen.getByText("Host overview")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for the first process sample.").length).toBeGreaterThan(0);
    expect(screen.getByText("recheck failed")).toBeInTheDocument();
    expect(screen.getByText("Last updated").closest(".monitoring-metric")).toHaveTextContent(
      "Unavailable"
    );
  });

  it("keeps the mobile advanced settings expanded after enabling from the disabled-first layout", async () => {
    const disabledSettings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
    };
    const enabledSettings = {
      ...disabledSettings,
      enabled: true,
    };

    renderStatefulSubpage({
      initialSettings: disabledSettings,
      viewport: "mobile",
      nextMonitoringResponse: createMonitoringResponse(enabledSettings),
    });

    expect(await screen.findAllByText("Monitoring disabled")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(
      screen.queryByRole("button", { name: "Open monitoring configuration" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show advanced monitoring settings" })
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    const shell = document.querySelector(".settings-monitoring-shell");
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open monitoring configuration" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show advanced monitoring settings" })
    ).toHaveAttribute("aria-expanded", "true");
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
    fireEvent.click(screen.getByRole("button", { name: "Show advanced monitoring settings" }));
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeDisabled();
    expect(screen.getByRole("tablist", { name: "Preset" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
