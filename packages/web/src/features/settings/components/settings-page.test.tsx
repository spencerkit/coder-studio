import type { MonitoringResponse, MonitoringSettings } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appearancePersonalizationAtom } from "../../../atoms/app-ui";
import {
  type ConnectionStatus,
  connectionStatusAtom,
  serverInfoAtom,
  wsClientAtom,
} from "../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../atoms/workspaces";
import { CommandResultError } from "../../../ws/client";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  terminalPreferencesAtom,
} from "../../terminal-panel/preferences";
import { SettingsPage } from "./settings-page";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  permission: "default" as NotificationPermission,
  requestPermission: vi.fn(async () => "default" as NotificationPermission),
}));

const navigatorMocks = vi.hoisted(() => ({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  platform: "MacIntel",
  maxTouchPoints: 0,
  standalone: false,
  displayModeStandalone: false,
}));

const appearanceMocks = vi.hoisted(() => ({
  deleteAppearanceAsset: vi.fn(),
  uploadAppearanceAsset: vi.fn(),
}));

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock("../../../appearance", async () => {
  const actual = await vi.importActual<typeof import("../../../appearance")>("../../../appearance");
  return {
    ...actual,
    deleteAppearanceAsset: appearanceMocks.deleteAppearanceAsset,
    uploadAppearanceAsset: appearanceMocks.uploadAppearanceAsset,
  };
});

vi.mock("./config-editor", () => ({
  ConfigEditor: ({ configType }: { configType: "claude" | "codex" }) => (
    <div data-testid={`config-editor-${configType}`}>{configType}</div>
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});

function createConnectedStore(
  sendCommand: ReturnType<typeof vi.fn>,
  connectionStatus: ConnectionStatus = "connected"
) {
  const store = createStore();

  store.set(connectionStatusAtom, connectionStatus);
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);

  return store;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMonitoringResponse(
  settings: MonitoringSettings = {
    enabled: true,
    hostMetricsEnabled: true,
    runtimeSummaryEnabled: false,
    workspaceAttributionEnabled: false,
    subprocessDrilldownEnabled: false,
    sampleIntervalMs: 5000,
  }
): MonitoringResponse {
  return {
    settings,
    snapshot: {
      sampledAt: 10,
      mode: settings.enabled ? "light" : "disabled",
      host: settings.enabled
        ? {
            cpuPercent: 30,
            memoryUsedBytes: 300,
            memoryTotalBytes: 1000,
            memoryAvailableBytes: 700,
            loadAverage: [0.3, 0.2, 0.1],
            uptimeSec: 60,
            pressure: "normal",
          }
        : null,
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
}

function renderSettingsPage(
  store = createConnectedStore(vi.fn().mockResolvedValue({})),
  { initialEntry = "/settings" }: { initialEntry?: string } = {}
) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SettingsPage />
      </MemoryRouter>
    </Provider>
  );
}

function installNotificationMock() {
  class NotificationMock {
    static permission = notificationMocks.permission;
    static requestPermission = notificationMocks.requestPermission;
  }

  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: NotificationMock,
  });
}

function removeNotificationMock() {
  delete (window as Window & { Notification?: unknown }).Notification;
}

function applyNavigatorMocks() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(display-mode: standalone)" ? navigatorMocks.displayModeStandalone : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => navigatorMocks.userAgent,
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    get: () => navigatorMocks.platform,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    get: () => navigatorMocks.maxTouchPoints,
  });
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    get: () => navigatorMocks.standalone,
  });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.navigate.mockReset();
    viewportMocks.viewport = "desktop";
    appearanceMocks.deleteAppearanceAsset.mockReset();
    appearanceMocks.uploadAppearanceAsset.mockReset();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    notificationMocks.permission = "default";
    notificationMocks.requestPermission = vi.fn(async () => "default" as NotificationPermission);
    navigatorMocks.userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
    navigatorMocks.platform = "MacIntel";
    navigatorMocks.maxTouchPoints = 0;
    navigatorMocks.standalone = false;
    navigatorMocks.displayModeStandalone = false;
    installNotificationMock();
    applyNavigatorMocks();
    window.history.replaceState({ idx: 0 }, "", "/settings");
  });

  it("shows an explicit error when settings loading fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("settings exploded"));
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(screen.getByText("设置加载失败")).toBeInTheDocument();
    });

    expect(screen.getByRole("alert")).toHaveClass(
      "settings-page__notice",
      "settings-page__notice--error"
    );
    expect(screen.getByText("设置加载失败")).toHaveClass("settings-page__notice-title");
    expect(screen.getByText("settings exploded")).toBeInTheDocument();
    expect(screen.getByText("settings exploded")).toHaveClass("settings-page__notice-message");
    expect(document.querySelector(".settings-page__notice-copy")).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("button", { name: "刷新" })).toHaveClass("settings-link");
  });

  it("refreshes settings when the load-error notice action is pressed", async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("settings exploded"))
      .mockResolvedValueOnce({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const refreshButton = await screen.findByRole("button", { name: "刷新" });
    const callCountBeforeRefresh = sendCommand.mock.calls.length;

    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(callCountBeforeRefresh + 1);
    });

    await waitFor(() => {
      expect(screen.queryByText("设置加载失败")).not.toBeInTheDocument();
    });
  });

  it("redirects to session gate instead of showing an inline load error when activation is required", async () => {
    const sendCommand = vi.fn().mockRejectedValue(
      new CommandResultError({
        code: "activation_required",
        message: "This tab is no longer the active session",
      })
    );
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith("/session-gate", { replace: true });
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("This tab is no longer the active session")).not.toBeInTheDocument();
  });

  it("renders the footer version from server metadata", () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));
    store.set(serverInfoAtom, {
      version: "0.3.0",
      serverInstanceId: "server-123",
    });

    renderSettingsPage(store);

    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
    const footerMeta = document.querySelector(".settings-footer__meta");
    expect(footerMeta).toBeTruthy();
    expect(within(footerMeta as HTMLElement).getByText("设置已自动保存")).toBeInTheDocument();
    expect(within(footerMeta as HTMLElement).getByText("v0.3.0")).toBeInTheDocument();
  });

  it("explains that turning LSP off stops active language services immediately", async () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));

    renderSettingsPage(store);

    expect(await screen.findByRole("group", { name: "LSP 运行模式" })).toHaveAccessibleDescription(
      "控制代码智能的内存占用。关闭后会立即停止当前语言服务进程，诊断、跳转、hover 等能力将暂时不可用。"
    );
  });

  it("wraps desktop settings content in the shared content surface", async () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));

    renderSettingsPage(store);

    await waitFor(() => {
      expect(document.querySelector(".settings-content-surface")).toBeTruthy();
    });
    expect(document.querySelector(".settings-content-surface .settings-section")).toBeTruthy();
  });

  it("renders desktop and mobile settings entry icons through themed semantics", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const desktopStore = createConnectedStore(sendCommand);

    const desktopView = renderSettingsPage(desktopStore);

    await waitFor(() => {
      expect(
        desktopView.container.querySelector('[data-icon-semantic="nav.settings.general"]')
      ).toBeTruthy();
    });

    expect(
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.general"]')
    ).toBeTruthy();
    expect(
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.providers"]')
    ).toBeTruthy();
    expect(
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.appearance"]')
    ).toBeTruthy();
    expect(
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.shortcuts"]')
    ).toBeTruthy();
    expect(
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.about"]')
    ).toBeTruthy();
    expect(
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.diagnostics"]')
    ).toBeTruthy();

    desktopView.unmount();

    viewportMocks.viewport = "mobile";
    const mobileStore = createConnectedStore(vi.fn().mockResolvedValue({}));
    const mobileView = renderSettingsPage(mobileStore);

    await waitFor(() => {
      expect(
        mobileView.container.querySelector('[data-icon-semantic="nav.settings.general"]')
      ).toBeTruthy();
    });

    expect(
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.general"]')
    ).toBeTruthy();
    expect(
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.providers"]')
    ).toBeTruthy();
    expect(
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.appearance"]')
    ).toBeTruthy();
    expect(
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.shortcuts"]')
    ).toBeTruthy();
    expect(
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.about"]')
    ).toBeTruthy();
    expect(
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.diagnostics"]')
    ).toBeTruthy();
  });

  it("opens diagnostics from the general settings section", async () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));

    renderSettingsPage(store);

    expect(screen.getByText(/诊断运行环境|Diagnose the runtime environment/)).toBeInTheDocument();

    const diagnosticsButton = await waitFor(() => {
      const button = document.querySelector(".settings-diagnostics-button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Diagnostics button did not render");
      }
      return button;
    });
    expect(diagnosticsButton).toHaveClass("settings-diagnostics-button");
    fireEvent.click(diagnosticsButton);

    expect(routerMocks.navigate).toHaveBeenCalledWith("/diagnostics?context=manual_check");
  });

  it("renders monitoring inside the settings content surface from section=monitoring", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }
      if (op === "monitoring.get") {
        return {
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
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const monitoringNavButton = await screen.findByRole("button", { name: "性能监控" });
    const contentSurface = document.querySelector(".settings-content-surface") as HTMLElement;

    expect(monitoringNavButton).toHaveClass("settings-nav-item-active");
    expect(contentSurface).not.toHaveClass("settings-content-surface--monitoring");
    expect(within(contentSurface).getByText("主机概览")).toBeInTheDocument();
    expect(within(contentSurface).getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(within(contentSurface).getByRole("tablist", { name: "预设" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开监控" })).not.toBeInTheDocument();
    expect(screen.queryByText("设置通知与终端行为。")).not.toBeInTheDocument();
  });

  it("switches sections after mount when navigating within settings by search param", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse();
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    window.history.replaceState({ idx: 0 }, "", "/settings?section=about");

    render(
      <Provider store={store}>
        <BrowserRouter>
          <SettingsPage />
        </BrowserRouter>
      </Provider>
    );

    expect(await screen.findByTestId("about-settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toHaveClass("settings-nav-item-active");

    await act(async () => {
      window.history.pushState({ idx: 1 }, "", "/settings?section=monitoring");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "性能监控" })).toHaveClass(
        "settings-nav-item-active"
      );
    });

    expect(await screen.findByText("主机概览")).toBeInTheDocument();
    expect(screen.queryByTestId("about-settings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).not.toHaveClass(
      "settings-nav-item-active"
    );
  });

  it("leaves a deep-linked section when the user chooses another settings section", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse();
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    expect(await screen.findByRole("button", { name: "性能监控" })).toHaveClass(
      "settings-nav-item-active"
    );

    fireEvent.click(screen.getByRole("button", { name: "关于" }));

    expect(await screen.findByTestId("about-settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toHaveClass("settings-nav-item-active");
    expect(screen.getByRole("button", { name: "性能监控" })).not.toHaveClass(
      "settings-nav-item-active"
    );
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/settings",
        search: "?section=about",
      },
      { replace: true }
    );
  });

  it("clears a mobile deep-link query when backing out to the settings root", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse();
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    expect(await screen.findByText("主机概览")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(await screen.findByTestId("settings-mobile-root")).toBeInTheDocument();
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/settings",
        search: "",
      },
      { replace: true }
    );
  });

  it("replaces desktop section history entries so leaving settings is not trapped in internal navigation", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse();
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    expect(await screen.findByRole("button", { name: "性能监控" })).toHaveClass(
      "settings-nav-item-active"
    );

    fireEvent.click(screen.getByRole("button", { name: "关于" }));

    await screen.findByTestId("about-settings");
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/settings",
        search: "?section=about",
      },
      { replace: true }
    );

    routerMocks.navigate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/");
  });

  it("replaces mobile section history entries so backing out returns to the root instead of old sections", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse();
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings" });

    expect(await screen.findByTestId("settings-mobile-root")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "性能监控" }));

    expect(await screen.findByText("主机概览")).toBeInTheDocument();
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/settings",
        search: "?section=monitoring",
      },
      { replace: true }
    );

    routerMocks.navigate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(await screen.findByTestId("settings-mobile-root")).toBeInTheDocument();
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/settings",
        search: "",
      },
      { replace: true }
    );
  });

  it("disables monitoring updates until monitoring settings hydrate", async () => {
    const settingsGetDeferred = createDeferred<Record<string, unknown>>();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return settingsGetDeferred.promise;
      }

      if (op === "settings.update") {
        return {};
      }

      if (op === "monitoring.get" || op === "monitoring.recheck") {
        return createMonitoringResponse({
          enabled: true,
          hostMetricsEnabled: true,
          runtimeSummaryEnabled: false,
          workspaceAttributionEnabled: false,
          subprocessDrilldownEnabled: false,
          sampleIntervalMs: 5000,
        });
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    const presetTabs = screen.getByRole("tablist", { name: "预设" });
    const advancedToggle = screen.getByRole("button", { name: "显示高级采样能力" });

    expect(enableSwitch).toHaveAttribute("aria-checked", "false");
    expect(enableSwitch).toBeDisabled();
    expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
    expect(presetTabs).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(enableSwitch);

    expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(sendCommand).not.toHaveBeenCalledWith("settings.update", expect.anything(), undefined);
    expect(sendCommand).not.toHaveBeenCalledWith("monitoring.recheck", {}, undefined);

    await act(async () => {
      settingsGetDeferred.resolve({
        "monitoring.enabled": true,
        "monitoring.hostMetricsEnabled": true,
        "monitoring.runtimeSummaryEnabled": true,
        "monitoring.workspaceAttributionEnabled": true,
        "monitoring.subprocessDrilldownEnabled": false,
        "monitoring.sampleIntervalMs": 2000,
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "显示高级采样能力" }));
    expect(screen.getByRole("switch", { name: "启用性能监控" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "隐藏高级采样能力" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("switch", { name: "主机指标" })).toBeEnabled();
    expect(screen.getByRole("tablist", { name: "预设" })).toHaveAttribute("aria-disabled", "false");
  });

  it("restores monitoring interactions after monitoring settings hydrate", async () => {
    const settingsGetDeferred = createDeferred<Record<string, unknown>>();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: unknown) => {
      if (op === "settings.get") {
        return settingsGetDeferred.promise;
      }

      if (op === "settings.update") {
        return {};
      }

      if (op === "monitoring.get" || op === "monitoring.recheck") {
        return createMonitoringResponse(
          (args as { settings?: { monitoring?: MonitoringSettings } } | undefined)?.settings
            ?.monitoring ?? {
            enabled: true,
            hostMetricsEnabled: true,
            runtimeSummaryEnabled: true,
            workspaceAttributionEnabled: true,
            subprocessDrilldownEnabled: false,
            sampleIntervalMs: 2000,
          }
        );
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    expect(await screen.findByRole("switch", { name: "启用性能监控" })).toBeDisabled();

    await act(async () => {
      settingsGetDeferred.resolve({
        "monitoring.enabled": true,
        "monitoring.hostMetricsEnabled": true,
        "monitoring.runtimeSummaryEnabled": true,
        "monitoring.workspaceAttributionEnabled": true,
        "monitoring.subprocessDrilldownEnabled": false,
        "monitoring.sampleIntervalMs": 2000,
      });
    });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    await waitFor(() => {
      expect(enableSwitch).toBeEnabled();
    });

    fireEvent.click(enableSwitch);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            monitoring: {
              enabled: false,
              hostMetricsEnabled: true,
              runtimeSummaryEnabled: true,
              workspaceAttributionEnabled: true,
              subprocessDrilldownEnabled: false,
              sampleIntervalMs: 2000,
            },
          },
        },
        undefined
      );
    });
  });

  it("keeps monitoring interactions enabled after a later settings reload returns null", async () => {
    const hydratedSettings = {
      enabled: true,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    } satisfies MonitoringSettings;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        if (sendCommand.mock.calls.filter(([command]) => command === "settings.get").length === 1) {
          return {
            "monitoring.enabled": hydratedSettings.enabled,
            "monitoring.hostMetricsEnabled": hydratedSettings.hostMetricsEnabled,
            "monitoring.runtimeSummaryEnabled": hydratedSettings.runtimeSummaryEnabled,
            "monitoring.workspaceAttributionEnabled": hydratedSettings.workspaceAttributionEnabled,
            "monitoring.subprocessDrilldownEnabled": hydratedSettings.subprocessDrilldownEnabled,
            "monitoring.sampleIntervalMs": hydratedSettings.sampleIntervalMs,
          };
        }

        return null;
      }

      if (op === "monitoring.get" || op === "monitoring.recheck") {
        return createMonitoringResponse(hydratedSettings);
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    await waitFor(() => {
      expect(enableSwitch).toBeEnabled();
    });

    await act(async () => {
      store.set(connectionStatusAtom, "disconnected");
    });

    await act(async () => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(2, "settings.get", {}, undefined);
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "显示高级采样能力" }));
    expect(screen.getByRole("switch", { name: "主机指标" })).toBeEnabled();
    expect(screen.getByRole("tablist", { name: "预设" })).toHaveAttribute("aria-disabled", "false");
  });

  it("does not revert a newer successful monitoring update when an older request fails later", async () => {
    const firstUpdateDeferred = createDeferred<unknown>();
    const secondUpdateDeferred = createDeferred<unknown>();
    let updateCallCount = 0;

    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: unknown) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": false,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": true,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 2000,
        };
      }

      if (op === "settings.update") {
        updateCallCount += 1;
        if (updateCallCount === 1) {
          return firstUpdateDeferred.promise;
        }
        if (updateCallCount === 2) {
          return secondUpdateDeferred.promise;
        }
      }

      if (op === "monitoring.get" || op === "monitoring.recheck") {
        const nextEnabled =
          (args as { settings?: { monitoring?: { enabled?: boolean } } } | undefined)?.settings
            ?.monitoring?.enabled ?? false;
        return createMonitoringResponse({
          enabled: nextEnabled,
          hostMetricsEnabled: true,
          runtimeSummaryEnabled: true,
          workspaceAttributionEnabled: true,
          subprocessDrilldownEnabled: false,
          sampleIntervalMs: 2000,
        });
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    expect(enableSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(enableSwitch);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    fireEvent.click(screen.getByRole("switch", { name: "启用性能监控" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    await act(async () => {
      secondUpdateDeferred.resolve({});
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    await act(async () => {
      firstUpdateDeferred.reject(new Error("request failed"));
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });
  });

  it("only triggers monitoring recheck for the latest successful monitoring update", async () => {
    const firstUpdateDeferred = createDeferred<unknown>();
    const secondUpdateDeferred = createDeferred<unknown>();
    let updateCallCount = 0;
    let recheckCallCount = 0;
    const disabledSettings = {
      enabled: false,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    } satisfies MonitoringSettings;
    const enabledSettings = {
      ...disabledSettings,
      enabled: true,
    } satisfies MonitoringSettings;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": disabledSettings.enabled,
          "monitoring.hostMetricsEnabled": disabledSettings.hostMetricsEnabled,
          "monitoring.runtimeSummaryEnabled": disabledSettings.runtimeSummaryEnabled,
          "monitoring.workspaceAttributionEnabled": disabledSettings.workspaceAttributionEnabled,
          "monitoring.subprocessDrilldownEnabled": disabledSettings.subprocessDrilldownEnabled,
          "monitoring.sampleIntervalMs": disabledSettings.sampleIntervalMs,
        };
      }

      if (op === "settings.update") {
        updateCallCount += 1;
        if (updateCallCount === 1) {
          return firstUpdateDeferred.promise;
        }
        if (updateCallCount === 2) {
          return secondUpdateDeferred.promise;
        }
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse(disabledSettings);
      }

      if (op === "monitoring.recheck") {
        recheckCallCount += 1;
        return createMonitoringResponse(
          recheckCallCount === 1 ? disabledSettings : enabledSettings
        );
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    expect(enableSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(enableSwitch);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    fireEvent.click(screen.getByRole("switch", { name: "启用性能监控" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    await act(async () => {
      secondUpdateDeferred.resolve({});
    });

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(([command]) => command === "monitoring.recheck")
      ).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("主机概览")).not.toBeInTheDocument();
    });

    await act(async () => {
      firstUpdateDeferred.resolve({});
    });

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(([command]) => command === "monitoring.recheck")
      ).toHaveLength(1);
    });
    expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.queryByText("主机概览")).not.toBeInTheDocument();
  });

  it("keeps stage gating aligned with dock settings when monitoring recheck fails after a successful update", async () => {
    const enabledSettings = {
      enabled: true,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    } satisfies MonitoringSettings;
    const disabledSettings = {
      ...enabledSettings,
      enabled: false,
    } satisfies MonitoringSettings;

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": enabledSettings.enabled,
          "monitoring.hostMetricsEnabled": enabledSettings.hostMetricsEnabled,
          "monitoring.runtimeSummaryEnabled": enabledSettings.runtimeSummaryEnabled,
          "monitoring.workspaceAttributionEnabled": enabledSettings.workspaceAttributionEnabled,
          "monitoring.subprocessDrilldownEnabled": enabledSettings.subprocessDrilldownEnabled,
          "monitoring.sampleIntervalMs": enabledSettings.sampleIntervalMs,
        };
      }

      if (op === "settings.update") {
        return {};
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse(enabledSettings);
      }

      if (op === "monitoring.recheck") {
        throw new Error("recheck failed");
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    expect(await screen.findByText("主机概览")).toBeInTheDocument();
    expect(enableSwitch).toHaveAttribute("aria-checked", "true");

    fireEvent.click(enableSwitch);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            monitoring: disabledSettings,
          },
        },
        undefined
      );
    });
    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("monitoring.recheck", {}, undefined);
    });
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    expect(screen.getAllByText("监控已关闭").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("主机概览")).not.toBeInTheDocument();
  });

  it("falls back to an enabled waiting stage when enabling monitoring succeeds but recheck fails", async () => {
    const disabledSettings = {
      enabled: false,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    } satisfies MonitoringSettings;

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": disabledSettings.enabled,
          "monitoring.hostMetricsEnabled": disabledSettings.hostMetricsEnabled,
          "monitoring.runtimeSummaryEnabled": disabledSettings.runtimeSummaryEnabled,
          "monitoring.workspaceAttributionEnabled": disabledSettings.workspaceAttributionEnabled,
          "monitoring.subprocessDrilldownEnabled": disabledSettings.subprocessDrilldownEnabled,
          "monitoring.sampleIntervalMs": disabledSettings.sampleIntervalMs,
        };
      }

      if (op === "settings.update") {
        return {};
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse(disabledSettings);
      }

      if (op === "monitoring.recheck") {
        throw new Error("recheck failed");
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    const enableSwitch = await screen.findByRole("switch", { name: "启用性能监控" });
    expect(enableSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByText("监控已关闭").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(enableSwitch);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    expect(screen.queryByText("监控已关闭")).not.toBeInTheDocument();
    expect(screen.getByText("主机概览")).toBeInTheDocument();
    expect(screen.getAllByText("正在等待首个进程样本。").length).toBeGreaterThan(0);
    expect(screen.getByText("recheck failed")).toBeInTheDocument();
    expect(
      screen.getAllByText(/最后更新/).some((node) => node.textContent?.includes("Unavailable"))
    ).toBe(true);
  });

  it("keeps the mobile monitoring dock expanded after enabling from the disabled-first layout", async () => {
    viewportMocks.viewport = "mobile";
    const disabledSettings = {
      enabled: false,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    } satisfies MonitoringSettings;
    const enabledSettings = {
      ...disabledSettings,
      enabled: true,
    } satisfies MonitoringSettings;

    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: unknown) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": disabledSettings.enabled,
          "monitoring.hostMetricsEnabled": disabledSettings.hostMetricsEnabled,
          "monitoring.runtimeSummaryEnabled": disabledSettings.runtimeSummaryEnabled,
          "monitoring.workspaceAttributionEnabled": disabledSettings.workspaceAttributionEnabled,
          "monitoring.subprocessDrilldownEnabled": disabledSettings.subprocessDrilldownEnabled,
          "monitoring.sampleIntervalMs": disabledSettings.sampleIntervalMs,
        };
      }

      if (op === "settings.update") {
        return {};
      }

      if (op === "monitoring.get") {
        return createMonitoringResponse(disabledSettings);
      }

      if (op === "monitoring.recheck") {
        const nextSettings =
          (args as { settings?: { monitoring?: MonitoringSettings } } | undefined)?.settings
            ?.monitoring ?? enabledSettings;
        return createMonitoringResponse(nextSettings);
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    await screen.findByRole("switch", { name: "启用性能监控" });
    expect(screen.queryByRole("button", { name: "打开监控配置" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
      "aria-checked",
      "false"
    );

    fireEvent.click(screen.getByRole("switch", { name: "启用性能监控" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "启用性能监控" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    const shell = document.querySelector(".settings-monitoring-shell");
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(document.querySelector(".settings-body--fill-height")).not.toBeNull();
    expect(document.querySelector(".settings-content--fill-height")).not.toBeNull();
    expect(screen.getByRole("tablist", { name: "预设" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开监控配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "显示高级监控设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "主机指标" })).toBeInTheDocument();
  });

  it("does not render phone continuation entry from settings even when a workspace is active", async () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));
    store.set(activeWorkspaceIdAtom, "ws-1");

    renderSettingsPage(store);

    expect(
      screen.queryByRole("button", {
        name: /Continue on Phone|继续在手机上打开/,
      })
    ).not.toBeInTheDocument();
  });

  it("renders the mobile settings homepage as grouped sections without the legacy hero", async () => {
    viewportMocks.viewport = "mobile";
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));

    renderSettingsPage(store);

    const mobileRoot = await screen.findByTestId("settings-mobile-root");
    const groupHeadings = within(mobileRoot).getAllByRole("heading", { level: 2 });

    expect(groupHeadings).toHaveLength(2);
    expect(within(mobileRoot).getByText("工作区与运行")).toBeInTheDocument();
    expect(within(mobileRoot).getByText("界面与交互")).toBeInTheDocument();
    expect(document.querySelector(".settings-mobile-root-hero")).toBeNull();

    const buttons = within(mobileRoot).getAllByRole("button");
    const labels = buttons.map((button) => button.getAttribute("aria-label")).filter(Boolean);

    expect(labels).toEqual(expect.arrayContaining(["通用", "Agents", "外观", "快捷键", "关于"]));
    expect(labels.indexOf("通用")).toBeLessThan(labels.indexOf("Agents"));
    expect(labels.indexOf("Agents")).toBeLessThan(labels.indexOf("外观"));
    expect(labels.indexOf("外观")).toBeLessThan(labels.indexOf("快捷键"));
    expect(labels.indexOf("快捷键")).toBeLessThan(labels.indexOf("关于"));
  });

  it("renders the About section and saves update preferences through settings.update", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "updates.autoCheckEnabled": true,
          "updates.checkIntervalSec": 21600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("switch", { name: "自动检查更新" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            updates: {
              autoCheckEnabled: false,
            },
          },
        },
        undefined
      );
    });
  });

  it("opens the About section on load when section=about is present", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "updates.autoCheckEnabled": true,
          "updates.checkIntervalSec": 21600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=about" });

    expect(await screen.findByTestId("about-settings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关于" })).toBeInTheDocument();
  });

  it("does not let late settings hydration overwrite a local update preference change", async () => {
    const settingsGetDeferred = createDeferred<Record<string, unknown>>();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return settingsGetDeferred.promise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("switch", { name: "自动检查更新" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            updates: {
              autoCheckEnabled: false,
            },
          },
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "自动检查更新" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    settingsGetDeferred.resolve({
      "updates.autoCheckEnabled": true,
      "updates.checkIntervalSec": 21600,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    expect(screen.getByRole("switch", { name: "自动检查更新" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("localizes the new mobile settings homepage section headings", async () => {
    viewportMocks.viewport = "mobile";
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));

    renderSettingsPage(store);

    expect(await screen.findByText("Workspace & Runtime")).toBeInTheDocument();
    expect(screen.getByText("Interface & Interaction")).toBeInTheDocument();
  });

  it("does not render default Agent Provider selection in general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          defaultProviderId: "codex",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    expect(screen.queryByText("选择默认的 Agent Provider")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claude" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
  });

  it("renders the notification toggles as labeled switches and disables sound when notifications are off", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "notifications.enabled": false,
          "notifications.soundEnabled": true,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const notificationsSwitch = await screen.findByRole("switch", { name: "启用完成通知" });
    const soundSwitch = screen.getByRole("switch", { name: "通知声音" });

    expect(notificationsSwitch).toHaveAttribute("aria-checked", "false");
    expect(soundSwitch).toHaveAttribute("aria-checked", "true");
    expect(soundSwitch).toBeDisabled();
  });

  it("preserves notification settings update payloads when the switches are toggled", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "notifications.enabled": true,
          "notifications.soundEnabled": true,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("switch", { name: "启用完成通知" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            notifications: {
              enabled: false,
            },
          },
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("switch", { name: "启用完成通知" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "通知声音" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("switch", { name: "通知声音" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            notifications: {
              soundEnabled: false,
            },
          },
        },
        undefined
      );
    });
  });

  it("does not render legacy monitoring controls inside general settings after monitoring settings hydrate", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": true,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });
    expect(sendCommand).not.toHaveBeenCalledWith("monitoring.get", {}, undefined);
    expect(sendCommand).not.toHaveBeenCalledWith("monitoring.recheck", {}, undefined);

    expect(screen.queryByRole("button", { name: "打开监控" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "启用性能监控" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "主机指标" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "运行时概览" })).not.toBeInTheDocument();
  });

  it("loads and saves supervisor evaluation timeout in seconds from general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    expect(input).toHaveValue(600);

    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            supervisor: {
              evaluationTimeoutSec: 900,
            },
          },
        },
        undefined
      );
    });
  });

  it("loads and saves supervisor retry settings from general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.retryEnabled": true,
          "supervisor.retryMaxCount": 3,
          "supervisor.retryDelaySec": 10,
          "supervisor.retryOnTimeout": true,
          "supervisor.retryOnEvaluatorError": false,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const retryEnabled = await screen.findByRole("switch", { name: "启用 Supervisor 重试" });
    const retryMaxCount = screen.getByLabelText("最大重试次数");
    const retryDelaySec = screen.getByLabelText("重试间隔（秒）");
    const retryOnTimeout = screen.getByRole("switch", { name: "超时后重试" });
    const retryOnEvaluatorError = screen.getByRole("switch", { name: "评估器异常后重试" });

    expect(retryEnabled).toHaveAttribute("aria-checked", "true");
    expect(retryOnTimeout).toHaveAttribute("aria-checked", "true");
    expect(retryOnEvaluatorError).toHaveAttribute("aria-checked", "false");
    await waitFor(() => {
      expect(retryMaxCount).toHaveValue(3);
      expect(retryDelaySec).toHaveValue(10);
    });

    fireEvent.click(retryEnabled);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            supervisor: {
              retryEnabled: false,
            },
          },
        },
        undefined
      );
    });

    fireEvent.change(retryMaxCount, { target: { value: "5" } });
    fireEvent.blur(retryMaxCount);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            supervisor: {
              retryMaxCount: 5,
            },
          },
        },
        undefined
      );
    });

    fireEvent.change(retryDelaySec, { target: { value: "30" } });
    fireEvent.blur(retryDelaySec);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            supervisor: {
              retryDelaySec: 30,
            },
          },
        },
        undefined
      );
    });

    fireEvent.click(retryOnTimeout);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            supervisor: {
              retryOnTimeout: false,
            },
          },
        },
        undefined
      );
    });

    fireEvent.click(retryOnEvaluatorError);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            supervisor: {
              retryOnEvaluatorError: true,
            },
          },
        },
        undefined
      );
    });
  });

  it("renders the supervisor timeout control as an inline settings row", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    const field = input.closest(".settings-config-field");
    const control = input.closest(".settings-config-control");

    expect(input).toHaveClass("input", "settings-input-compact");
    expect(field).toHaveClass("settings-config-field--inline");
    expect(control).not.toBeNull();
  });

  it("renders the supervisor timeout control with shared input compatibility classes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    expect(input).toHaveClass("input", "settings-input-compact");
  });

  it("does not save supervisor timeout for non-integer numeric strings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    fireEvent.change(input, { target: { value: "1e2" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(600);
    });
    expect(sendCommand).not.toHaveBeenCalledWith("settings.update", expect.anything(), undefined);
  });

  it("does not save supervisor timeout above the supported maximum", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    fireEvent.change(input, { target: { value: "86401" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(600);
    });
    expect(sendCommand).not.toHaveBeenCalledWith(
      "settings.update",
      expect.objectContaining({
        settings: {
          supervisor: {
            evaluationTimeoutSec: 86401,
          },
        },
      }),
      undefined
    );
  });

  it("normalizes an invalid persisted supervisor timeout before rendering", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 999999,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    expect(input).toHaveValue(600);
  });

  it("falls back when the persisted supervisor timeout is fractional", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = screen.getByLabelText("Supervisor 超时（秒）");
    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });
    await act(async () => {
      resolveSettingsGet?.({
        "supervisor.evaluationTimeoutSec": 1.9,
      });
      await settingsGetPromise;
    });
    expect(input).toHaveValue(600);
  });

  it("rolls back supervisor timeout when saving fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      if (op === "settings.update") {
        throw new Error("save failed");
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(600);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
  });

  it("shows a localized fallback when saving supervisor timeout fails without a message", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "supervisor.evaluationTimeoutSec": 600,
        };
      }
      if (op === "settings.update") {
        throw new CommandResultError({
          code: "command_error",
          message: "",
        });
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const input = await screen.findByLabelText("Supervisor 超时（秒）");
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(600);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("配置保存失败");
  });

  it("does not render the MCP Servers settings section", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {};
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    expect(screen.queryByRole("button", { name: "MCP Servers" })).not.toBeInTheDocument();
  });

  it("uses provider-specific startup command args without working directory override", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "settings.get") {
        return {
          "providers.claude.additionalArgs": ["--verbose"],
          "providers.codex.additionalArgs": ["-c", 'model_reasoning_effort="low"'],
        };
      }
      if (op === "settings.previewCommand") {
        const previewArgs = args as { config: { additionalArgs?: string[] } };
        return {
          preview: ["preview", ...(previewArgs.config.additionalArgs ?? [])].join(" "),
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    await waitFor(() => {
      expect(screen.getByRole("tablist", { name: "Agents" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "Claude" })).toHaveClass("settings-provider-tab");
      expect(screen.getByLabelText("启动命令参数")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Working Directory Override")).not.toBeInTheDocument();
    expect(screen.queryByText("Hooks")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注入 Hooks" })).not.toBeInTheDocument();

    const argsInput = screen.getByLabelText("启动命令参数");
    expect(argsInput).toHaveValue("--verbose");
    expect(argsInput).toHaveClass("input", "textarea", "settings-provider-args-input");

    fireEvent.change(argsInput, {
      target: {
        value: "--verbose\n--debug\n\n--print",
      },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            providers: {
              claude: {
                additionalArgs: ["--verbose", "--debug", "--print"],
              },
            },
          },
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.previewCommand",
        {
          providerId: "claude",
          config: {
            additionalArgs: ["--verbose", "--debug", "--print"],
          },
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));

    await waitFor(() => {
      expect(screen.getByLabelText("启动命令参数")).toHaveValue(
        '-c\nmodel_reasoning_effort=\"low\"'
      );
    });

    fireEvent.change(screen.getByLabelText("启动命令参数"), {
      target: {
        value: "--sandbox\n--full-auto",
      },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            providers: {
              codex: {
                additionalArgs: ["--sandbox", "--full-auto"],
              },
            },
          },
        },
        undefined
      );
    });

    expect(screen.queryByLabelText("Working Directory Override")).not.toBeInTheDocument();
  });

  it("retries loading provider settings after websocket becomes connected", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "settings.get") {
        return {
          "providers.claude.additionalArgs": ["--verbose"],
        };
      }
      if (op === "settings.previewCommand") {
        const previewArgs = args as { config: { additionalArgs?: string[] } };
        return {
          preview: ["preview", ...(previewArgs.config.additionalArgs ?? [])].join(" "),
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand, "connecting");

    renderSettingsPage(store);

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(sendCommand).not.toHaveBeenCalledWith("settings.get", {}, undefined);
    expect(screen.queryByText("设置加载失败")).not.toBeInTheDocument();

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("启动命令参数")).toHaveValue("--verbose");
    });

    expect(screen.queryByText("设置加载失败")).not.toBeInTheDocument();
  });

  it("uses shared history-aware exit behavior on desktop", async () => {
    window.history.replaceState({ idx: 0 }, "", "/");
    window.history.pushState({ idx: 1 }, "", "/settings");

    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith(-1);
  });

  it("falls back to / when desktop settings is opened directly without an active workspace", async () => {
    window.history.replaceState({ idx: 0 }, "", "/settings");

    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);
    store.set(activeWorkspaceIdAtom, null);

    renderSettingsPage(store);

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/");
  });

  it("renders the desktop settings header through the shared PageHeader contract", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const desktopHeader = document.querySelector(
      ".settings-header .page-header"
    ) as HTMLElement | null;
    const mobileHeader = document.querySelector(
      ".settings-header .mobile-page-header"
    ) as HTMLElement | null;
    const headerCopy = document.querySelector(
      ".settings-header .page-header__copy"
    ) as HTMLElement | null;

    expect(desktopHeader).not.toBeNull();
    expect(desktopHeader).toHaveClass("page-header--secondary");
    expect(mobileHeader).toBeNull();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(
      within(desktopHeader as HTMLElement).getByRole("button", { name: "返回" })
    ).toBeInTheDocument();
    expect(headerCopy).not.toBeNull();
    expect(within(headerCopy as HTMLElement).queryByText("Coder Studio")).toBeNull();
    expect(within(headerCopy as HTMLElement).queryByText("设置已自动保存")).toBeNull();
    expect(document.querySelector(".settings-header__desktop")).toBeNull();
  });

  it("renders a mobile category list and returns from detail content to the settings root", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "settings.get") {
        return {
          "providers.claude.additionalArgs": ["--verbose"],
        };
      }
      if (op === "settings.previewCommand") {
        const previewArgs = args as { config: { additionalArgs?: string[] } };
        return {
          preview: ["preview", ...(previewArgs.config.additionalArgs ?? [])].join(" "),
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    const pageHeaderLeading = () =>
      document.querySelector(".settings-header .page-header__leading") as HTMLElement | null;
    const mobileHeader = () =>
      document.querySelector(".settings-header .mobile-page-header") as HTMLElement | null;

    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快捷键" })).toBeInTheDocument();
    expect(screen.queryByText("通知")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
    expect(mobileHeader()).not.toBeNull();
    expect(pageHeaderLeading()).not.toBeNull();
    expect(within(pageHeaderLeading() as HTMLElement).getByText("设置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    await waitFor(() => {
      expect(screen.getByText("通用")).toBeInTheDocument();
    });

    expect(screen.getAllByText("通用")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "通用" })).not.toBeInTheDocument();
    expect(within(pageHeaderLeading() as HTMLElement).getByText("通用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
    expect(within(pageHeaderLeading() as HTMLElement).getByText("设置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "快捷键" }));

    await waitFor(() => {
      expect(screen.getByRole("tablist", { name: "快捷键" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("button", { name: "快捷键" })).toBeInTheDocument();
    expect(within(pageHeaderLeading() as HTMLElement).getByText("设置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    await waitFor(() => {
      expect(screen.getByLabelText("启动命令参数")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "配置文件" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
  });

  it("uses a scrollable mobile detail layout for secondary settings pages without fill-height classes", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });

    const detailBody = document.querySelector(".settings-body--mobile");
    const detailContent = document.querySelector(".settings-content--mobile");

    expect(detailBody).not.toBeNull();
    expect(detailContent).not.toBeNull();
    expect(document.querySelector(".settings-body--mobile-detail")).not.toBeNull();
    expect(document.querySelector(".settings-content--mobile-detail")).not.toBeNull();
    expect(document.querySelector(".settings-body--mobile.settings-body--fill-height")).toBeNull();
    expect(
      document.querySelector(".settings-content--mobile.settings-content--fill-height")
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(document.querySelector(".settings-body--mobile")).toBeNull();
    expect(document.querySelector(".settings-body--mobile-detail")).toBeNull();
    expect(document.querySelector(".settings-content--mobile-detail")).toBeNull();
  });

  it("shows provider base settings first on mobile and enters config files through the secondary action", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "settings.get") {
        return {
          "providers.claude.additionalArgs": ["--verbose"],
        };
      }
      if (op === "settings.previewCommand") {
        const previewArgs = args as { config: { additionalArgs?: string[] } };
        return {
          preview: ["preview", ...(previewArgs.config.additionalArgs ?? [])].join(" "),
        };
      }
      if (op === "settings.readConfigFile") {
        return {
          configPath: "/tmp/claude.json",
          content: "{}",
          exists: true,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    await waitFor(() => {
      expect(screen.getByLabelText("启动命令参数")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "配置文件" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开配置文件编辑/ }));

    await waitFor(() => {
      expect(screen.getByText("Claude 配置")).toBeInTheDocument();
    });

    expect(
      document.querySelector(".settings-body--mobile.settings-body--fill-height")
    ).not.toBeNull();
    expect(document.querySelector(".settings-content--fill-height")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回基础配置" }));

    expect(screen.getByLabelText("启动命令参数")).toBeInTheDocument();
  });

  it("keeps the shortcuts section available on desktop", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "快捷键" })).toBeInTheDocument();
    });
  });

  it("renders appearance theme and language controls with shared semantics", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.locale": "zh",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const themePicker = await screen.findByRole("button", { name: "主题 Mint 深色" });
    const chineseLanguagePill = screen.getByRole("button", { name: "中文" });

    expect(themePicker).toHaveAccessibleDescription("选择应用主题");
    expect(
      screen.getByRole("group", {
        name: "语言",
      })
    ).toHaveAccessibleDescription("选择界面语言");
    expect(screen.queryByRole("group", { name: "终端渲染器" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "选中自动复制" })).not.toBeInTheDocument();
    expect(themePicker).toHaveAttribute("aria-haspopup", "listbox");
    expect(chineseLanguagePill).toHaveAttribute("aria-pressed", "true");
  });

  it("hydrates appearance personalization controls from settings.get and syncs the global atom", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "contain",
          "appearance.personalization.common.backgroundDimness": 33,
          "appearance.personalization.common.backgroundBlur": 8,
          "appearance.personalization.common.glassEnabled": true,
          "appearance.personalization.common.glassIntensity": 44,
          "appearance.personalization.common.surfaceOpacity": 91,
          "appearance.personalization.desktop.surfaceOpacity": 72,
          "appearance.personalization.mobile.surfaceOpacity": 64,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    await waitFor(() => {
      expect(store.get(appearancePersonalizationAtom)).toEqual({
        version: 1,
        common: {
          backgroundMode: "image",
          backgroundAssetId: "asset-common",
          backgroundFit: "contain",
          backgroundDimness: 33,
          backgroundBlur: 8,
          glassEnabled: true,
          glassIntensity: 44,
          surfaceOpacity: 91,
        },
        desktop: {
          surfaceOpacity: 72,
        },
        mobile: {
          surfaceOpacity: 64,
        },
      });
    });

    expect(await screen.findByRole("spinbutton", { name: "背景压暗" })).toHaveValue(33);
    expect(screen.getByRole("spinbutton", { name: "背景模糊" })).toHaveValue(8);
    expect(screen.getByRole("spinbutton", { name: "毛玻璃强度" })).toHaveValue(44);
    expect(document.getElementById("appearance-surface-opacity")).toHaveValue(91);
    expect(document.getElementById("appearance-desktop-surface-opacity")).toHaveValue(72);
    expect(document.getElementById("appearance-mobile-surface-opacity")).toHaveValue(64);
  });

  it("enables desktop and mobile appearance override groups through shared toggles", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    fireEvent.click(await screen.findByRole("switch", { name: "桌面端覆盖" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              personalization: {
                version: 1,
                common: {
                  backgroundMode: "image",
                  backgroundAssetId: "asset-common",
                  backgroundFit: "cover",
                  backgroundDimness: 24,
                  backgroundBlur: 0,
                  glassEnabled: false,
                  glassIntensity: 24,
                  surfaceOpacity: 96,
                },
                desktop: {
                  surfaceOpacity: 96,
                },
                mobile: {},
              },
            },
          },
        },
        undefined
      );
    });

    expect(document.getElementById("appearance-desktop-surface-opacity")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "移动端覆盖" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              personalization: {
                version: 1,
                common: {
                  backgroundMode: "image",
                  backgroundAssetId: "asset-common",
                  backgroundFit: "cover",
                  backgroundDimness: 24,
                  backgroundBlur: 0,
                  glassEnabled: false,
                  glassIntensity: 24,
                  surfaceOpacity: 96,
                },
                desktop: {
                  surfaceOpacity: 96,
                },
                mobile: {
                  surfaceOpacity: 96,
                },
              },
            },
          },
        },
        undefined
      );
    });

    expect(document.getElementById("appearance-mobile-surface-opacity")).toBeInTheDocument();
  });

  it("groups background material controls into asset and material surfaces", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "contain",
          "appearance.personalization.common.backgroundDimness": 33,
          "appearance.personalization.common.backgroundBlur": 8,
          "appearance.personalization.common.glassEnabled": true,
          "appearance.personalization.common.glassIntensity": 44,
          "appearance.personalization.common.surfaceOpacity": 91,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const backgroundMaterialGroup = (
      await screen.findByRole("heading", { name: "背景与材质" })
    ).closest(".settings-group");

    expect(backgroundMaterialGroup).not.toBeNull();

    const assetPanel = backgroundMaterialGroup?.querySelector(".settings-appearance-panel--asset");
    const materialPanel = backgroundMaterialGroup?.querySelector(
      ".settings-appearance-panel--material"
    );

    expect(assetPanel).not.toBeNull();
    expect(materialPanel).not.toBeNull();
    expect(
      document
        .getElementById("appearance-background-mode")
        ?.closest(".settings-appearance-panel--asset")
    ).toBe(assetPanel);
    expect(
      document
        .getElementById("appearance-background-fit")
        ?.closest(".settings-appearance-panel--asset")
    ).toBe(assetPanel);
    expect(screen.getByText("asset-common")).toHaveClass("settings-appearance-asset-id");
    expect(assetPanel?.querySelector(".settings-appearance-actions")).not.toBeNull();
    expect(
      screen
        .getByRole("spinbutton", { name: "背景压暗" })
        .closest(".settings-appearance-material-grid")
    ).toBeTruthy();
    expect(
      screen
        .getByRole("spinbutton", { name: "面板不透明度" })
        .closest(".settings-appearance-material-grid")
    ).toBeTruthy();
  });

  it("renders desktop and mobile override controls inside nested appearance panels", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    fireEvent.click(await screen.findByRole("switch", { name: "桌面端覆盖" }));

    const desktopSurfaceOpacity = document.getElementById("appearance-desktop-surface-opacity");

    expect(desktopSurfaceOpacity).not.toBeNull();
    expect(desktopSurfaceOpacity?.closest(".settings-appearance-override-panel")).toBeTruthy();
    expect(
      desktopSurfaceOpacity
        ?.closest(".settings-appearance-override-panel")
        ?.querySelector(".settings-appearance-actions")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "移动端覆盖" }));

    const mobileSurfaceOpacity = document.getElementById("appearance-mobile-surface-opacity");

    expect(mobileSurfaceOpacity).not.toBeNull();
    expect(mobileSurfaceOpacity?.closest(".settings-appearance-override-panel")).toBeTruthy();
  });

  it("deletes the shared appearance background asset and persists a null background asset id", async () => {
    appearanceMocks.deleteAppearanceAsset.mockResolvedValue(undefined);
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    fireEvent.click(await screen.findByRole("button", { name: "移除背景图" }));

    await waitFor(() => {
      expect(appearanceMocks.deleteAppearanceAsset).toHaveBeenCalledWith("asset-common");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              personalization: {
                version: 1,
                common: {
                  backgroundMode: "image",
                  backgroundAssetId: null,
                  backgroundFit: "cover",
                  backgroundDimness: 24,
                  backgroundBlur: 0,
                  glassEnabled: false,
                  glassIntensity: 24,
                  surfaceOpacity: 96,
                },
                desktop: {},
                mobile: {},
              },
            },
          },
        },
        undefined
      );
    });

    expect(store.get(appearancePersonalizationAtom).common.backgroundAssetId).toBeNull();
  });

  it("renders terminal option groups through shared pills in general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalRenderer": "standard",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    const standardRendererPill = await screen.findByRole("button", { name: "标准" });

    expect(
      screen.getByRole("group", {
        name: "终端渲染器",
      })
    ).toHaveAccessibleDescription("选择终端渲染模式");
    expect(standardRendererPill).toHaveAttribute("aria-pressed", "true");
  });

  it("hydrates lsp runtime mode from settings.get", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "lsp.mode": "off",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    expect(await screen.findByRole("group", { name: "LSP 运行模式" })).toHaveAccessibleDescription(
      "控制代码智能的内存占用。关闭后会立即停止当前语言服务进程，诊断、跳转、hover 等能力将暂时不可用。"
    );
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists and applies lsp runtime mode before updating the local selection", async () => {
    let resolveSettingsUpdate: ((value: { updated: string[] }) => void) | undefined;
    const settingsUpdatePromise = new Promise<{ updated: string[] }>((resolve) => {
      resolveSettingsUpdate = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "lsp.mode": "auto",
        };
      }
      if (op === "settings.update") {
        return await settingsUpdatePromise;
      }
      if (op === "lsp.setMode") {
        return { mode: "off" };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));
    fireEvent.click(await screen.findByRole("button", { name: "Off" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            lsp: {
              mode: "off",
            },
          },
        },
        undefined
      );
    });

    expect(sendCommand).not.toHaveBeenCalledWith("lsp.setMode", { mode: "off" }, undefined);
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");

    resolveSettingsUpdate?.({ updated: ["lsp.mode"] });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.setMode", { mode: "off" }, undefined);
    });

    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not flip lsp runtime mode locally when runtime application fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "lsp.mode": "auto",
        };
      }
      if (op === "settings.update") {
        return { updated: ["lsp.mode"] };
      }
      if (op === "lsp.setMode") {
        throw new CommandResultError({
          code: "runtime_apply_failed",
          message: "runtime apply failed",
        });
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));
    fireEvent.click(await screen.findByRole("button", { name: "Off" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            lsp: {
              mode: "off",
            },
          },
        },
        undefined
      );
      expect(sendCommand).toHaveBeenCalledWith("lsp.setMode", { mode: "off" }, undefined);
    });

    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps copy-on-select visible on desktop general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    expect(await screen.findByRole("switch", { name: "选中自动复制" })).toBeInTheDocument();
  });

  it("shows copy-on-select on mobile general settings with mobile-specific hint", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    expect(await screen.findByRole("switch", { name: "选中自动复制" })).toBeInTheDocument();
    expect(screen.getByText("选中文本后自动复制到系统剪贴板")).toBeInTheDocument();
  });

  it("updates theme through a single shared appearance picker", async () => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {};
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    const picker = await screen.findByRole("button", { name: "Theme Mint Dark" });
    expect(picker).toHaveAttribute("aria-haspopup", "listbox");

    fireEvent.click(picker);

    const listbox = await screen.findByRole("listbox", { name: "Theme" });
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "Core Themes",
      "Mint Dark",
      "Mint Light",
      "Graphite Dark",
      "Graphite Light",
      "Nord Dark",
      "Nord Light",
      "High Contrast Dark",
      "High Contrast Light",
      "Seasonal Themes",
      "Spring Light",
      "Spring Dark",
      "Summer Light",
      "Summer Dark",
      "Autumn Light",
      "Autumn Dark",
      "Winter Light",
      "Winter Dark",
    ]);
    expect(within(listbox).getByRole("option", { name: "Mint Dark" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(within(listbox).getByRole("option", { name: "Core Themes" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(within(listbox).getByRole("option", { name: "Seasonal Themes" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(within(listbox).getByRole("option", { name: "Graphite Dark" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Graphite Light" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Nord Light" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Spring Light" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Spring Dark" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Summer Light" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Autumn Dark" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Winter Dark" })).toBeInTheDocument();

    fireEvent.click(within(listbox).getByRole("option", { name: "Graphite Dark" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              themeId: "graphite-dark",
            },
          },
        },
        undefined
      );
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "graphite-dark");

    const updatedPicker = screen.getByRole("button", { name: "Theme Graphite Dark" });
    fireEvent.click(updatedPicker);

    const updatedListbox = await screen.findByRole("listbox", { name: "Theme" });
    fireEvent.click(within(updatedListbox).getByRole("option", { name: "Graphite Light" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              themeId: "graphite-light",
            },
          },
        },
        undefined
      );
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "graphite-light");
    expect(screen.getByRole("button", { name: "Theme Graphite Light" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Theme Graphite Light" }));

    const seasonalListbox = await screen.findByRole("listbox", { name: "Theme" });
    fireEvent.click(within(seasonalListbox).getByRole("option", { name: "Winter Dark" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              themeId: "winter-dark",
            },
          },
        },
        undefined
      );
    });
  });

  it("hydrates the single theme picker from settings.get themeId", async () => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.themeId": "nord-light",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Theme Nord Light" })).toBeInTheDocument();
    });
  });

  it("hydrates the grouped theme picker from a seasonal settings.get themeId", async () => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.themeId": "winter-dark",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Theme Winter Dark" })).toBeInTheDocument();
    });
  });

  it("falls back to legacy appearance.theme when themeId is absent in settings load", async () => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.theme": "light",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Theme Mint Light" })).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute("data-theme", "mint-light");
    });
  });

  it("does not reset the current theme when settings load omits theme values", async () => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    window.localStorage.setItem("ui.themeId", JSON.stringify("graphite-light"));
    document.documentElement.setAttribute("data-theme", "graphite-light");
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {};
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Theme Graphite Light" })).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute("data-theme", "graphite-light");
    });
  });

  it("preserves a newer local theme selection when a stale settings load resolves afterward", async () => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Theme Mint Dark" }));
    fireEvent.click(
      within(await screen.findByRole("listbox", { name: "Theme" })).getByRole("option", {
        name: "Graphite Dark",
      })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              themeId: "graphite-dark",
            },
          },
        },
        undefined
      );
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.themeId": "nord-light",
      });
      await settingsGetPromise;
    });

    expect(screen.getByRole("button", { name: "Theme Graphite Dark" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "graphite-dark");
  });

  it("updates terminal renderer selection through the shared general pills", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalRenderer": "standard",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));
    fireEvent.click(await screen.findByRole("button", { name: "兼容模式" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              terminalRenderer: "compatibility",
            },
          },
        },
        undefined
      );
    });

    expect(screen.getByRole("button", { name: "兼容模式" })).toHaveClass(
      "settings-pill",
      "settings-pill-active"
    );
    expect(screen.getByRole("button", { name: "兼容模式" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "标准" })).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves terminal renderer selection when a stale settings load resolves afterward in general settings", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));
    fireEvent.click(await screen.findByRole("button", { name: "兼容模式" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              terminalRenderer: "compatibility",
            },
          },
        },
        undefined
      );
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.locale": "zh",
        "appearance.terminalRenderer": "standard",
      });
      await settingsGetPromise;
    });

    expect(screen.getByRole("button", { name: "兼容模式" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "标准" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the copy-on-select switch from loaded general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "选中自动复制" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      mobileFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
  });

  it("updates copy-on-select through the general switch and syncs the global atom", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": false,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));
    fireEvent.click(await screen.findByRole("switch", { name: "选中自动复制" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              terminalCopyOnSelect: true,
            },
          },
        },
        undefined
      );
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      mobileFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
  });

  it("renders copy-on-select from the terminal preferences atom before general settings load resolves", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      desktopFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      mobileFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    expect(await screen.findByRole("switch", { name: "选中自动复制" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await act(async () => {
      resolveSettingsGet?.({});
      await settingsGetPromise;
    });
  });

  it("preserves copy-on-select when a stale general settings load resolves afterward", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));
    fireEvent.click(await screen.findByRole("switch", { name: "选中自动复制" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              terminalCopyOnSelect: false,
            },
          },
        },
        undefined
      );
    });

    await act(async () => {
      resolveSettingsGet?.({});
      await settingsGetPromise;
    });

    expect(screen.getByRole("switch", { name: "选中自动复制" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: false,
      desktopFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      mobileFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
  });

  it("defaults copy-on-select to enabled when general settings do not provide a value", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {};
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "选中自动复制" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      mobileFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
  });

  it("renders split terminal font-size inputs from loaded appearance settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.desktopTerminalFontSize": 16,
          "appearance.mobileTerminalFontSize": 14,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const desktopInput = await screen.findByRole("spinbutton", { name: "桌面端终端字号" });
    const mobileInput = await screen.findByRole("spinbutton", { name: "移动端终端字号" });
    await waitFor(() => {
      expect(desktopInput).toHaveValue(16);
      expect(mobileInput).toHaveValue(14);
    });
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 16,
      mobileFontSize: 14,
      fontSize: 16,
    });
  });

  it("falls back to the legacy shared terminal font size when split settings are absent", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalFontSize": 11,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const desktopInput = await screen.findByRole("spinbutton", { name: "桌面端终端字号" });
    const mobileInput = await screen.findByRole("spinbutton", { name: "移动端终端字号" });

    await waitFor(() => {
      expect(desktopInput).toHaveValue(11);
      expect(mobileInput).toHaveValue(11);
    });
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 11,
      mobileFontSize: 11,
      fontSize: 11,
    });
  });

  it("updates desktop terminal font size through the appearance input and syncs the global atom", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.desktopTerminalFontSize": 11,
          "appearance.mobileTerminalFontSize": 13,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const input = await screen.findByRole("spinbutton", { name: "桌面端终端字号" });

    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              desktopTerminalFontSize: 15,
            },
          },
        },
        undefined
      );
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 15,
      mobileFontSize: 13,
      fontSize: 15,
    });
  });

  it("throttles duplicate desktop terminal font-size commits triggered back-to-back", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.desktopTerminalFontSize": 11,
          "appearance.mobileTerminalFontSize": 13,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const input = await screen.findByRole("spinbutton", { name: "桌面端终端字号" });

    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              desktopTerminalFontSize: 15,
            },
          },
        },
        undefined
      );
    });

    expect(
      sendCommand.mock.calls.filter(
        ([op, args]) =>
          op === "settings.update" &&
          typeof args === "object" &&
          args !== null &&
          "settings" in args
      )
    ).toHaveLength(1);
  });

  it("updates mobile terminal font size through the appearance input without changing desktop size", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.desktopTerminalFontSize": 12,
          "appearance.mobileTerminalFontSize": 11,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const input = await screen.findByRole("spinbutton", { name: "移动端终端字号" });

    fireEvent.change(input, { target: { value: "14" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              mobileTerminalFontSize: 14,
            },
          },
        },
        undefined
      );
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 12,
      mobileFontSize: 14,
      fontSize: 12,
    });
  });

  it("shows a validation error and restores the current desktop terminal font size for out-of-range values", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.desktopTerminalFontSize": 12,
          "appearance.mobileTerminalFontSize": 11,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const input = await screen.findByRole("spinbutton", { name: "桌面端终端字号" });
    await waitFor(() => {
      expect(input).toHaveValue(12);
    });

    fireEvent.change(input, { target: { value: "19" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("请输入 10 到 18 之间的整数");
    });

    expect(input).toHaveValue(12);
    expect(sendCommand).not.toHaveBeenCalledWith(
      "settings.update",
      expect.objectContaining({
        settings: {
          appearance: {
            desktopTerminalFontSize: 19,
          },
        },
      }),
      undefined
    );
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 12,
      mobileFontSize: 11,
      fontSize: 12,
    });
  });

  it("preserves desktop terminal font size when a stale appearance settings load resolves afterward", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const input = await screen.findByRole("spinbutton", { name: "桌面端终端字号" });
    fireEvent.change(input, { target: { value: "17" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              desktopTerminalFontSize: 17,
            },
          },
        },
        undefined
      );
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.desktopTerminalFontSize": 11,
        "appearance.mobileTerminalFontSize": 13,
      });
      await settingsGetPromise;
    });

    expect(screen.getByRole("spinbutton", { name: "桌面端终端字号" })).toHaveValue(17);
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 17,
      mobileFontSize: 13,
      fontSize: 17,
    });
  });

  it("updates language selection through the shared appearance pills", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.locale": "zh",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              locale: "en",
            },
          },
        },
        undefined
      );
    });

    expect(screen.getByRole("button", { name: "English" })).toHaveClass(
      "settings-pill",
      "settings-pill-active"
    );
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves language selection when a stale settings load resolves afterward", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    fireEvent.click(await screen.findByRole("button", { name: "English" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              locale: "en",
            },
          },
        },
        undefined
      );
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.locale": "zh",
        "appearance.terminalRenderer": "standard",
      });
      await settingsGetPromise;
    });

    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the shortcuts category chooser with shared tab semantics and legacy classes", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));

    expect(screen.getByRole("tablist", { name: "快捷键" })).toHaveClass("shortcuts-category-tabs");
    expect(screen.getByRole("tab", { name: "全局" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "全局" })).toHaveClass("shortcuts-category-tab");
  });

  it("renders shortcut capture with shared input compatibility classes", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));
    fireEvent.click(screen.getByText("⌘+K"));

    expect(screen.getByPlaceholderText("按下快捷键...")).toHaveClass("input", "shortcuts-capture");
  });

  it("uses the shared kbd primitive compatibility class and interactive semantics for shortcut bindings", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));

    expect(screen.getByText("⌘+K")).toHaveClass("shortcuts-key");
    expect(screen.getByText("⌘+K").tagName).toBe("KBD");
    expect(screen.getByText("⌘+K")).toHaveAttribute("role", "button");
    expect(screen.getByText("⌘+K")).toHaveAttribute("tabindex", "0");
  });

  it("renders the shortcut reset action with icon button compatibility classes", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));
    fireEvent.click(screen.getByText("⌘+K"));
    fireEvent.keyDown(screen.getByPlaceholderText("按下快捷键..."), {
      key: "j",
      metaKey: true,
    });

    expect(screen.getByRole("button", { name: "重置为默认" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm"
    );
  });

  it("renders the reset-all shortcut action with shared button semantics", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));

    expect(screen.getByRole("button", { name: "重置全部" })).toHaveAttribute("type", "button");
  });

  it("prefers browser history when leaving the mobile settings root", async () => {
    viewportMocks.viewport = "mobile";
    window.history.replaceState({ idx: 0 }, "", "/workspace");
    window.history.pushState({ idx: 1 }, "", "/settings");

    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    render(
      <Provider store={store}>
        <BrowserRouter>
          <SettingsPage />
        </BrowserRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith(-1);
  });

  it("splits mobile notification support from denied browser permission on Android", async () => {
    notificationMocks.permission = "denied";
    notificationMocks.requestPermission = vi.fn(async () => "denied" as NotificationPermission);
    navigatorMocks.userAgent =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36";
    navigatorMocks.platform = "Linux armv8l";
    navigatorMocks.maxTouchPoints = 5;
    installNotificationMock();

    renderSettingsPage();

    expect(await screen.findByText("通知状态")).toBeInTheDocument();
    expect(screen.getByText("受限")).toBeInTheDocument();
    expect(
      screen.getByText("当前移动端浏览器中的系统通知支持不稳定，浏览器权限不代表一定能正常送达。")
    ).toBeInTheDocument();
    expect(screen.getByText("通知权限")).toBeInTheDocument();
    expect(screen.getByText("已拒绝")).toBeInTheDocument();
    expect(
      screen.getByText("浏览器或系统通知权限可能已阻止，请检查站点设置和设备通知设置")
    ).toBeInTheDocument();

    const limitedStatus = screen.getByText("受限").closest(".settings-info-value");
    expect(limitedStatus).toHaveClass("settings-capability-limited");
    expect(limitedStatus).not.toHaveClass("settings-provider-capability");
  });

  it("does not offer browser permission request when mobile notification support is limited", async () => {
    notificationMocks.permission = "default";
    notificationMocks.requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    navigatorMocks.userAgent =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36";
    navigatorMocks.platform = "Linux armv8l";
    navigatorMocks.maxTouchPoints = 5;
    installNotificationMock();

    renderSettingsPage();

    expect(await screen.findByText("通知状态")).toBeInTheDocument();
    expect(screen.getByText("受限")).toBeInTheDocument();
    expect(screen.getByText("通知权限")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "请求授权" })).not.toBeInTheDocument();
    expect(
      screen.getByText("当前移动端浏览器内即使允许通知权限，也可能无法稳定展示系统通知。")
    ).toBeInTheDocument();
  });

  it("shows unsupported notification status when the Notification API is unavailable", async () => {
    removeNotificationMock();
    navigatorMocks.userAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    navigatorMocks.platform = "iPhone";
    navigatorMocks.maxTouchPoints = 5;

    renderSettingsPage();

    expect(await screen.findByText("通知状态")).toBeInTheDocument();
    expect(screen.getByText("不支持")).toBeInTheDocument();
    expect(screen.getByText("当前浏览器环境不支持此通知方式。")).toBeInTheDocument();
    expect(screen.getByText("不可用")).toBeInTheDocument();
    expect(screen.getByText("当前环境无法请求浏览器通知权限")).toBeInTheDocument();
  });
});
