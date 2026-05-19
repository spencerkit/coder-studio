import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

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

function renderSettingsPage(store = createConnectedStore(vi.fn().mockResolvedValue({}))) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/settings"]}>
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

  it("renders the footer version from server metadata", () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));
    store.set(serverInfoAtom, {
      version: "0.3.0",
      serverInstanceId: "server-123",
    });

    renderSettingsPage(store);

    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
    expect(document.querySelector(".settings-footer__meta")).toBeTruthy();
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
      desktopView.container.querySelector('[data-icon-semantic="nav.settings.diagnostics"]')
    ).toBeNull();

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
      mobileView.container.querySelector('[data-icon-semantic="nav.settings.diagnostics"]')
    ).toBeNull();
  });

  it("opens diagnostics from the general settings section", async () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));

    renderSettingsPage(store);

    expect(screen.getByText(/诊断运行环境|Diagnose the runtime environment/)).toBeInTheDocument();

    const diagnosticsButton = await screen.findByRole("button", {
      name: /Open|打开/,
    });
    expect(diagnosticsButton).toHaveClass("settings-diagnostics-button");
    fireEvent.click(diagnosticsButton);

    expect(routerMocks.navigate).toHaveBeenCalledWith("/diagnostics?context=manual_check");
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

    expect(labels).toEqual(expect.arrayContaining(["通用", "Agents", "外观", "快捷键"]));
    expect(labels.indexOf("通用")).toBeLessThan(labels.indexOf("Agents"));
    expect(labels.indexOf("Agents")).toBeLessThan(labels.indexOf("外观"));
    expect(labels.indexOf("外观")).toBeLessThan(labels.indexOf("快捷键"));
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
    expect(within(listbox).getByRole("option", { name: "Mint Dark" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(within(listbox).getByRole("option", { name: "Graphite Dark" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Graphite Light" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Nord Light" })).toBeInTheDocument();

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
