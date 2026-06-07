import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import {
  type ConnectionStatus,
  connectionStatusAtom,
  wsClientAtom,
} from "../../../atoms/connection";
import { type ProviderInfo, ProviderSettings } from "./provider-settings";

const editorMountSpy = vi.fn();
const providerCapabilities = [
  { key: "interactive_session", supported: true, label: "Interactive Session" },
  { key: "supervisor_eval", supported: true, label: "Supervisor Eval" },
] as const;
const limitedProviderCapabilities = [
  { key: "interactive_session", supported: true, label: "Interactive Session" },
  { key: "supervisor_eval", supported: false, label: "Supervisor Eval" },
] as const;

vi.mock("./config-editor", () => ({
  ConfigEditor: ({
    configType,
    visible = true,
    fillHeight = false,
  }: {
    configType: "claude" | "codex";
    visible?: boolean;
    fillHeight?: boolean;
  }) => {
    const React = require("react") as typeof import("react");
    React.useEffect(() => {
      editorMountSpy(configType);
    }, [configType]);

    return (
      <div
        data-testid={`config-editor-${configType}`}
        data-visible={String(visible)}
        data-fill-height={String(fillHeight)}
      >
        {configType}-editor
      </div>
    );
  },
}));

function createConnectedStore(
  sendCommand: ReturnType<typeof vi.fn>,
  connectionStatus: ConnectionStatus = "connected"
) {
  const store = createStore();
  store.set(connectionStatusAtom, connectionStatus);
  store.set(localeAtom, "zh");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  return store;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderHarness({
  isMobile = false,
  connectionStatus = "connected" as ConnectionStatus,
  sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
    if (op === "settings.previewCommand") {
      const request = args as { providerId: string; config: { additionalArgs?: string[] } };
      return {
        preview: [request.providerId, ...(request.config.additionalArgs ?? [])].join(" "),
      };
    }
    if (op === "settings.readConfigFile") {
      return {
        configPath: "/tmp/config.json",
        content: "{}",
        exists: true,
      };
    }
    return {};
  }),
} = {}) {
  const providers: ProviderInfo[] = [
    {
      id: "claude",
      displayName: "Claude",
      badge: "Claude",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [...providerCapabilities],
    },
    {
      id: "codex",
      displayName: "Codex",
      badge: "Codex",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [...providerCapabilities],
    },
    {
      id: "gemini",
      displayName: "Gemini CLI",
      badge: "Gemini",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [...providerCapabilities],
    },
    {
      id: "cursor",
      displayName: "Cursor Agent",
      badge: "Cursor",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [...providerCapabilities],
    },
    {
      id: "opencode",
      displayName: "OpenCode",
      badge: "OpenCode",
      kind: "built_in",
      stability: "experimental",
      capability: "limited",
      capabilities: [...limitedProviderCapabilities],
    },
  ];

  function Harness() {
    const [additionalArgsById, setAdditionalArgsById] = useState<Record<string, string>>({
      claude: "--verbose",
      codex: "--sandbox",
      gemini: "--yolo",
      cursor: "--fast",
      opencode: "--local",
    });

    return (
      <ProviderSettings
        providers={providers}
        additionalArgsById={additionalArgsById}
        setAdditionalArgsById={setAdditionalArgsById}
        isMobile={isMobile}
      />
    );
  }

  const store = createConnectedStore(sendCommand, connectionStatus);

  return {
    store,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/settings"]}>
          <Harness />
        </MemoryRouter>
      </Provider>
    ),
  };
}

describe("ProviderSettings desktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to base settings and switches to config files explicitly", async () => {
    const { container } = renderHarness();

    expect(screen.getByRole("tablist", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Claude" })).toHaveClass("settings-provider-tab");
    expect(
      screen.getByText("每行填写一个启动参数，保存后会追加到 Agent 启动命令后面。")
    ).toBeInTheDocument();
    expect(screen.getByText("预览当前 Agent 最终生效的启动命令")).toBeInTheDocument();

    const input = await screen.findByLabelText("启动命令参数");
    expect(input).toHaveValue("--verbose");
    expect(input).toHaveClass("input", "textarea", "settings-provider-args-input");
    expect(container.querySelector(".settings-provider-base-layout")).not.toBeNull();
    expect(container.querySelector(".settings-provider-base-main")).toBeNull();
    expect(container.querySelector(".settings-provider-base-side")).toBeNull();
    expect(
      container.querySelectorAll(".settings-provider-base-layout > .settings-group")
    ).toHaveLength(3);

    expect(screen.getByRole("tablist", { name: "配置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "基础配置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("config-editor-claude")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "配置文件" }));

    expect(screen.getByRole("tab", { name: "配置文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("config-editor-claude")).toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
  });

  it("renders startup args with shared textarea compatibility classes", async () => {
    renderHarness();

    const textarea = await screen.findByLabelText("启动命令参数");
    expect(textarea).toHaveClass("input", "textarea", "settings-provider-args-input");
    expect(textarea).toHaveAttribute("rows", "4");
  });

  it("keeps the config-files subview selected when switching providers", async () => {
    renderHarness();

    fireEvent.click(screen.getByRole("tab", { name: "配置文件" }));
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));

    expect(screen.getByRole("tab", { name: "配置文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("config-editor-codex")).toBeInTheDocument();
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();
  });

  it("shows Gemini Cursor and OpenCode settings sections", async () => {
    renderHarness();

    expect(screen.getByRole("tab", { name: "Gemini CLI" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cursor Agent" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "OpenCode" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Gemini CLI" }));

    expect(screen.getByRole("tab", { name: "Gemini CLI" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("heading", { name: "Gemini CLI" })).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.getAllByText("完整支持").length).toBeGreaterThan(0);
    expect(screen.getByText("稳定")).toBeInTheDocument();
    expect(screen.getByText(/Interactive Session, Supervisor Eval/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "配置文件" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "OpenCode" }));

    expect(screen.getByRole("tab", { name: "OpenCode" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "OpenCode" })).toBeInTheDocument();
    expect(screen.getAllByText("有限支持").length).toBeGreaterThan(0);
    expect(screen.getByText("实验性")).toBeInTheDocument();
    expect(screen.getByText(/Interactive Session/)).toBeInTheDocument();
    expect(screen.queryByText(/Supervisor Eval/)).not.toBeInTheDocument();
  });

  it("keeps command preview scoped to the provider that requested it", async () => {
    const claudePreview = createDeferred<{ preview: string }>();
    const codexPreview = createDeferred<{ preview: string }>();

    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "settings.previewCommand") {
        const request = args as { providerId: string };
        if (request.providerId === "claude") {
          return claudePreview.promise;
        }
        if (request.providerId === "codex") {
          return codexPreview.promise;
        }
      }
      if (op === "settings.readConfigFile") {
        return {
          configPath: "/tmp/config.json",
          content: "{}",
          exists: true,
        };
      }
      return {};
    });

    renderHarness({ sendCommand });

    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));

    codexPreview.resolve({ preview: "codex --sandbox" });
    await screen.findByText("codex --sandbox");

    claudePreview.resolve({ preview: "claude --verbose" });

    await waitFor(() => {
      expect(screen.getByText("codex --sandbox")).toBeInTheDocument();
    });

    expect(screen.queryByText("claude --verbose")).not.toBeInTheDocument();
  });

  it("waits for websocket connection before loading command previews", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "settings.previewCommand") {
        const request = args as { providerId: string; config: { additionalArgs?: string[] } };
        return {
          preview: [request.providerId, ...(request.config.additionalArgs ?? [])].join(" "),
        };
      }
      if (op === "settings.readConfigFile") {
        return {
          configPath: "/tmp/config.json",
          content: "{}",
          exists: true,
        };
      }
      return {};
    });

    const { store } = renderHarness({
      connectionStatus: "connecting",
      sendCommand,
    });

    expect(sendCommand).not.toHaveBeenCalled();

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.previewCommand",
        {
          providerId: "claude",
          config: {
            additionalArgs: ["--verbose"],
          },
        },
        undefined
      );
    });

    expect(await screen.findByText("claude --verbose")).toBeInTheDocument();
  });

  it("shows provider runtime state with diagnostics and docs affordances", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            claude: {
              providerId: "claude",
              available: false,
              missingCommands: ["claude"],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "unsupported_platform",
              manualGuideKeys: ["provider.install.claude.manual"],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: {},
              },
            },
            codex: {
              providerId: "codex",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: {},
              },
            },
          },
        };
      }

      if (op === "settings.previewCommand") {
        const request = args as { providerId: string; config: { additionalArgs?: string[] } };
        return {
          preview: [request.providerId, ...(request.config.additionalArgs ?? [])].join(" "),
        };
      }

      if (op === "settings.readConfigFile") {
        return {
          configPath: "/tmp/config.json",
          content: "{}",
          exists: true,
        };
      }

      return {};
    });

    renderHarness({ sendCommand });

    expect(await screen.findByText("Claude CLI 缺失")).toBeInTheDocument();
    expect(
      screen.getByText(
        "启动前还没有安装所需的 provider 命令。 然后执行 npm install -g @anthropic-ai/claude-code。"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开官方文档" })).toHaveAttribute(
      "href",
      "https://docs.anthropic.com/en/docs/claude-code/getting-started"
    );
    expect(screen.getByRole("button", { name: "打开诊断" })).toBeInTheDocument();
  });

  it("keeps each provider config editor mounted once after first visit", async () => {
    renderHarness();

    fireEvent.click(screen.getByRole("tab", { name: "配置文件" }));
    expect(screen.getByTestId("config-editor-claude")).toHaveAttribute("data-visible", "true");

    fireEvent.click(screen.getByRole("tab", { name: "基础配置" }));
    fireEvent.click(screen.getByRole("tab", { name: "配置文件" }));

    expect(editorMountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByTestId("config-editor-codex")).toHaveAttribute("data-visible", "true");
    expect(editorMountSpy).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("tab", { name: "Claude" }));
    expect(screen.getByTestId("config-editor-claude")).toHaveAttribute("data-visible", "true");
    expect(editorMountSpy).toHaveBeenCalledTimes(2);
  });

  it("switches the desktop config view into a fill-height editor layout", async () => {
    const { container } = renderHarness();

    fireEvent.click(screen.getByRole("tab", { name: "配置文件" }));

    expect(container.querySelector(".settings-provider-section--config-active")).not.toBeNull();
    expect(container.querySelector(".settings-section--fill-height")).not.toBeNull();
    expect(screen.getByTestId("config-editor-claude")).toHaveAttribute("data-fill-height", "true");
  });
});

describe("ProviderSettings mobile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to base settings and enters config files from a secondary action", async () => {
    renderHarness({ isMobile: true });

    const input = await screen.findByLabelText("启动命令参数");
    expect(input).toHaveValue("--verbose");
    expect(input).toHaveClass("input", "textarea", "settings-provider-args-input");

    expect(screen.queryByTestId("config-editor-claude")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开配置文件编辑/ }));

    expect(screen.getByTestId("config-editor-claude")).toBeInTheDocument();
    expect(screen.getByTestId("config-editor-claude")).toHaveAttribute("data-fill-height", "true");
    expect(screen.queryByLabelText("启动命令参数")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回基础配置" }));

    expect(screen.getByLabelText("启动命令参数")).toBeInTheDocument();
  });

  it("returns to base settings when switching providers from the mobile config view", async () => {
    renderHarness({ isMobile: true });

    fireEvent.click(screen.getByRole("button", { name: /打开配置文件编辑/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));

    await waitFor(() => {
      expect(screen.getByLabelText("启动命令参数")).toHaveValue("--sandbox");
    });

    expect(screen.queryByTestId("config-editor-codex")).not.toBeInTheDocument();
  });
});
