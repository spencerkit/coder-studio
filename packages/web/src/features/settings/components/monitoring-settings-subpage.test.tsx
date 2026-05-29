import type { MonitoringResponse, MonitoringSettings } from "@coder-studio/core";
import { createDefaultMonitoringSettings, deriveMonitoringMode } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useEffect, useState } from "react";
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
  it("renders the approved monitoring visual hierarchy on desktop", async () => {
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
    expect(container.querySelector(".settings-monitoring-hero")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-hero__headline")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-hero__summary")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-status-card")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-status-card__health")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-status-card__stats")).toBeNull();
    expect(container.querySelector(".settings-monitoring-hero-actions")).toBeInTheDocument();
    expect(container.querySelectorAll(".settings-monitoring-hero-action")).toHaveLength(3);
    expect(container.querySelector(".settings-monitoring-toolbar")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-kpi-grid")).toBeInTheDocument();
    expect(container.querySelector(".monitoring-stage-toolbar")).not.toBeInTheDocument();
    expect(container.querySelector(".monitoring-dashboard-toolbar")).not.toBeInTheDocument();
    expect(container.querySelector(".monitoring-dashboard-grid")).toBeInTheDocument();
    expect(container.querySelector(".monitoring-detail-panel")).toBeInTheDocument();
    expect(container.querySelector(".monitoring-process-section")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Time window" })).toBeInTheDocument();
    const desktopRefreshButton = screen.getByRole("button", { name: "Refresh monitoring" });
    const desktopToolbarMeta = desktopRefreshButton.closest(".settings-monitoring-toolbar__meta");
    expect(desktopToolbarMeta).not.toBeNull();
    expect(desktopToolbarMeta?.querySelector(".settings-pill-disabled")).toBeNull();
    expect(desktopRefreshButton.closest(".settings-monitoring-toolbar__action-card")).toBeNull();
    expect(desktopRefreshButton).toHaveClass("btn-ghost");
    expect(screen.getAllByText("Coder Studio footprint").length).toBeGreaterThan(0);
    expect(screen.getByText("Performance monitoring")).toBeInTheDocument();
    expect(screen.getAllByText("Stable").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    expect(monitoringData.refresh).not.toHaveBeenCalled();
  });

  it("renders populated attribution and subprocess content when monitoring data is available", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: true,
    };
    const baseResponse = createMonitoringResponse(settings);

    renderSubpage(
      settings,
      createMonitoringDataResult(settings, {
        response: {
          ...baseResponse,
          snapshot: {
            ...baseResponse.snapshot,
            workspaces: [
              {
                id: "workspace:observability",
                kind: "workspace",
                label: "workspace/coder-studio-observability-dashboard-long-name-preview",
                cpuPercent: 7.6,
                memoryBytes: 29.7 * 1024 ** 3,
                processCount: 4,
                uptimeSec: 139 * 60 * 60,
                trend: "steady",
              },
            ],
            sessions: [
              {
                id: "session:review-agent",
                kind: "session",
                parentId: "workspace:observability",
                label: "session/review-agent",
                cpuPercent: 1.4,
                memoryBytes: 630 * 1024 ** 2,
                processCount: 1,
                uptimeSec: 42 * 60,
                trend: "steady",
              },
            ],
            subprocessGroups: [
              {
                id: "subprocess:vite-dev-server",
                kind: "subprocess_group",
                parentId: "session:review-agent",
                label: "vite dev server",
                cpuPercent: 0.4,
                memoryBytes: 92 * 1024 ** 2,
                processCount: 1,
                uptimeSec: 17 * 60,
                trend: "steady",
              },
            ],
          },
          history: {
            ...baseResponse.history,
            workspaces: {
              "workspace:observability": {
                points: [{ sampledAt: 1_000_000, cpuPercent: 7.6, memoryBytes: 29.7 * 1024 ** 3 }],
              },
            },
            sessions: {
              "session:review-agent": {
                points: [{ sampledAt: 1_000_000, cpuPercent: 1.4, memoryBytes: 630 * 1024 ** 2 }],
              },
            },
            subprocessGroups: {
              "subprocess:vite-dev-server": {
                points: [{ sampledAt: 1_000_000, cpuPercent: 0.4, memoryBytes: 92 * 1024 ** 2 }],
              },
            },
          },
        },
      }),
      { viewport: "desktop" }
    );

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(
      screen.getAllByText("workspace/coder-studio-observability-dashboard-long-name-preview").length
    ).toBeGreaterThan(1);
    expect(screen.getByText("session/review-agent")).toBeInTheDocument();
    expect(screen.getByText("vite dev server")).toBeInTheDocument();
  });

  it("keeps the approved monitoring visual hierarchy on mobile", async () => {
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
    expect(container.querySelector(".settings-monitoring-hero")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-status-card__health")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-status-card__stats")).toBeNull();
    expect(container.querySelector(".settings-monitoring-toolbar")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-kpi-grid")).toBeInTheDocument();
    expect(container.querySelector(".monitoring-dashboard-grid")).toBeInTheDocument();
    expect(container.querySelector(".monitoring-stage-toolbar")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getAllByText(/Last updated/).length).toBeGreaterThan(0);
    expect(screen.getByRole("tablist", { name: "Refresh rate" })).toBeInTheDocument();
    const mobileRefreshButton = screen.getByRole("button", { name: "Refresh monitoring" });
    expect(mobileRefreshButton).toBeInTheDocument();
    const mobileToolbarMeta = mobileRefreshButton.closest(".settings-monitoring-toolbar__meta");
    expect(mobileToolbarMeta).not.toBeNull();
    expect(mobileToolbarMeta?.querySelector(".settings-pill-disabled")).toBeNull();
    expect(mobileRefreshButton.closest(".settings-monitoring-toolbar__action-card")).toBeNull();
    expect(mobileRefreshButton).toHaveClass("btn-ghost");
    expect(
      screen.getByRole("button", { name: "Show advanced sampling capabilities" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Runtime summary" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "Workspace and session attribution" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Subprocess drill-down" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
  });

  it("reveals advanced sampling capabilities through the disclosure toggle", async () => {
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
    const disclosure = screen.getByRole("button", {
      name: "Show advanced sampling capabilities",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(
      screen.getByRole("button", { name: "Hide advanced sampling capabilities" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Required for attribution and subprocess drill-down.")
    ).toBeInTheDocument();
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
      screen.getByRole("button", { name: "Show advanced sampling capabilities" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();
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
    expect(
      screen.getAllByText(/Last updated/).some((node) => node.textContent?.includes("Unavailable"))
    ).toBe(true);
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
      screen.getByRole("button", { name: "Show advanced sampling capabilities" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Hide advanced sampling capabilities" })
      ).toHaveAttribute("aria-expanded", "true");
    });
    const shell = document.querySelector(".settings-monitoring-shell");
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open monitoring configuration" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeInTheDocument();
  });

  it("keeps advanced sampling collapsed when mobile settings hydrate from defaults", async () => {
    const disabledSettings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
    };
    const enabledSettings = {
      ...disabledSettings,
      enabled: true,
      workspaceAttributionEnabled: true,
    };
    const store = createStore();

    store.set(localeAtom, "en");
    viewportMocks.viewport = "mobile";

    function HydratingSubpage() {
      const [settings, setSettings] = useState(disabledSettings);
      const [ready, setReady] = useState(false);

      useEffect(() => {
        setSettings(enabledSettings);
        setReady(true);
      }, []);

      return (
        <MonitoringSettingsSubpage
          mode={deriveMonitoringMode(settings)}
          monitoringData={createMonitoringDataResult(settings)}
          monitoringSettingsReady={ready}
          onChange={vi.fn()}
          settings={settings}
        />
      );
    }

    render(
      <Provider store={store}>
        <HydratingSubpage />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    expect(
      screen.getByRole("button", { name: "Show advanced sampling capabilities" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("tablist", { name: "Preset" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByRole("button", { name: "Refresh monitoring" })).toBeEnabled();
    if (screen.queryByRole("button", { name: "Show advanced sampling capabilities" })) {
      fireEvent.click(screen.getByRole("button", { name: "Show advanced sampling capabilities" }));
    }
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
