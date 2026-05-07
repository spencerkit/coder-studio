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

  it("shows the config drift banner inside settings when codex findings exist", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          externalConfigAudit: {
            codex: {
              configPath: "/home/spencer/.codex/config.toml",
              exists: true,
              findings: [
                {
                  id: "toml_notify",
                  type: "toml_notify",
                  severity: "warn",
                  startLine: 11,
                  endLine: 14,
                  snippet: 'notify = ["agent-notify", "codex"]',
                  message: "top-level notify conflicts with injected notify",
                },
              ],
            },
          },
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(screen.getByText("Codex 配置冲突（1 项）")).toBeInTheDocument();
    });
  });

  it("keeps the embedded config drift banner detailed on mobile settings", async () => {
    viewportMocks.viewport = "mobile";

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          externalConfigAudit: {
            codex: {
              configPath: "/home/spencer/.codex/config.toml",
              exists: true,
              findings: [
                {
                  id: "toml_notify",
                  type: "toml_notify",
                  severity: "warn",
                  startLine: 11,
                  endLine: 14,
                  snippet: 'notify = ["agent-notify", "codex"]',
                  message: "top-level notify conflicts with injected notify",
                },
              ],
            },
          },
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    await waitFor(() => {
      expect(screen.getByText("Codex 配置冲突（1 项）")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument();
  });

  it("shows an explicit error when settings loading fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("settings exploded"));
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    await waitFor(() => {
      expect(screen.getByText("设置加载失败")).toBeInTheDocument();
    });

    expect(screen.getByText("settings exploded")).toBeInTheDocument();
  });

  it("renders the footer version from server metadata", () => {
    const store = createConnectedStore(vi.fn().mockResolvedValue({}));
    store.set(serverInfoAtom, {
      version: "0.3.0",
      serverInstanceId: "server-123",
    });

    renderSettingsPage(store);

    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Providers" }));

    await waitFor(() => {
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

    fireEvent.click(screen.getByRole("button", { name: "Codex" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Providers" }));

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

    expect(screen.getByRole("button", { name: "Providers" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "快捷键" })).not.toBeInTheDocument();
    expect(screen.queryByText("通知")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Providers" })).toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
    expect(within(pageHeaderLeading() as HTMLElement).getByText("设置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Providers" }));

    await waitFor(() => {
      expect(screen.getByLabelText("启动命令参数")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "配置文件" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("button", { name: "Providers" })).toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Providers" }));

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

  it("renders shortcut capture with shared input compatibility classes", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));
    fireEvent.click(screen.getByText("⌘+K"));

    expect(screen.getByPlaceholderText("按下快捷键...")).toHaveClass(
      "input",
      "shortcuts-capture"
    );
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
