import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { MobileAgentSheet } from "./mobile-agent-sheet";

const mockUseProviderLauncher = vi.fn();

vi.mock("../../../agent-panes/actions/use-provider-launcher", () => ({
  useProviderLauncher: (...args: unknown[]) => mockUseProviderLauncher(...args),
}));

function createProvider(id: string, displayName: string, badge = displayName) {
  return {
    id,
    displayName,
    badge,
    kind: "built_in" as const,
    capability: "full" as const,
    capabilities: [
      { key: "interactive_session" as const, supported: true, label: "Interactive session" },
    ],
    requiredCommands: [id],
  };
}

function createDefaultProviders() {
  return [createProvider("claude", "Claude"), createProvider("codex", "Codex")];
}

describe("MobileAgentSheet", () => {
  it("renders a create-session semantic icon and monogram provider launch icons", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        codex: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
      },
      providers: createDefaultProviders(),
      launch: vi.fn(),
    });

    const firstView = render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(
      firstView.container.querySelector('[data-icon-semantic="agent.action.newSession"]')
    ).toBeTruthy();

    firstView.unmount();

    const providerView = render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          defaultMode="create"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(
      providerView.container.querySelector('[data-icon-semantic="agent.provider.claude"]')
    ).toBeNull();
    expect(
      providerView.container.querySelector('[data-icon-semantic="agent.provider.codex"]')
    ).toBeNull();

    expect(
      providerView.container.querySelector(".mobile-agent-provider-icon--claude")
    ).toHaveTextContent("CL");
    expect(
      providerView.container.querySelector(".mobile-agent-provider-icon--codex")
    ).toHaveTextContent("CO");
  });

  it("renders every provider returned by the launcher in create mode", () => {
    const store = createStore();
    const launch = vi.fn();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      providers: [
        createProvider("claude", "Claude Code", "Claude"),
        createProvider("codex", "Codex"),
        createProvider("gemini", "Gemini CLI", "Gemini"),
        createProvider("cursor", "Cursor Agent", "Cursor"),
        createProvider("opencode", "OpenCode"),
        createProvider("mistral", "Mistral Agent", "Mistral"),
      ],
      states: {
        claude: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        codex: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        gemini: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        cursor: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        opencode: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        mistral: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
      },
      launch,
    });

    render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          defaultMode="create"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gemini" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cursor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OpenCode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mistral" })).toBeInTheDocument();
    expect(screen.getByText("CL")).toBeInTheDocument();
    expect(screen.getByText("CO")).toBeInTheDocument();
    expect(screen.getByText("GE")).toBeInTheDocument();
    expect(screen.getByText("CU")).toBeInTheDocument();
    expect(screen.getByText("OP")).toBeInTheDocument();
    expect(screen.getByText("MI")).toBeInTheDocument();
    expect(screen.getByText("GE").closest(".mobile-agent-provider-icon--gemini")).not.toBeNull();
    expect(screen.getByText("CU").closest(".mobile-agent-provider-icon--cursor")).not.toBeNull();
    expect(screen.getByText("OP").closest(".mobile-agent-provider-icon--opencode")).not.toBeNull();
    const mistralIcon = screen.getByText("MI").closest(".mobile-agent-provider-icon--mistral");
    expect(mistralIcon).not.toBeNull();
    expect(mistralIcon?.className).toMatch(
      /mobile-agent-provider-icon--tone-(accent|info|success|warning)/
    );

    fireEvent.click(screen.getByRole("button", { name: "Gemini" }));

    expect(launch).toHaveBeenCalledWith("gemini");
  });

  it("shows inline provider guidance and a diagnostics affordance only when launch help is needed", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
            available: false,
            autoInstallSupported: false,
            installReadiness: "unsupported_platform",
            manualGuideKeys: ["provider.install.claude.manual"],
          },
          loading: false,
          installJob: null,
          inlineError: "manual",
        },
        codex: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
      },
      providers: createDefaultProviders(),
      launch: vi.fn(),
    });

    render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          defaultMode="create"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(
      screen.getByText("Then run npm install -g @anthropic-ai/claude-code.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Diagnostics" })).toBeInTheDocument();
  });

  it("skips provider entries that are missing launcher state instead of crashing", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
      },
      providers: createDefaultProviders(),
      launch: vi.fn(),
    });

    render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          defaultMode="create"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Claude" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
  });

  it("opens diagnostics with session-start intent from mobile provider guidance", () => {
    const assignSpy = vi.fn();
    const originalAssign = window.location.assign;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: assignSpy,
      },
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
            available: false,
            autoInstallSupported: false,
            installReadiness: "unsupported_platform",
            manualGuideKeys: ["provider.install.claude.manual"],
          },
          loading: false,
          installJob: null,
          inlineError: "manual",
        },
        codex: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
      },
      providers: createDefaultProviders(),
      launch: vi.fn(),
    });

    render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          defaultMode="create"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Diagnostics" }));

    expect(assignSpy).toHaveBeenCalledWith(
      "/diagnostics?context=session_start&workspaceId=ws-1&providerId=claude"
    );

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: originalAssign,
      },
    });
  });

  it("does not show launch help for providers that are already available", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        codex: {
          runtime: {
            available: true,
            autoInstallSupported: false,
            installReadiness: "ready",
            manualGuideKeys: ["provider.install.codex.manual"],
          },
          loading: false,
          installJob: null,
        },
      },
      providers: createDefaultProviders(),
      launch: vi.fn(),
    });

    render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId={null}
          activeWorkspaceId="ws-1"
          defaultMode="create"
          sessions={[]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(screen.queryByText("Then run npm install -g @openai/codex.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Diagnostics" })).toBeNull();
    expect(screen.queryByText("Start Codex session")).toBeNull();
    expect(
      within(screen.getByRole("button", { name: "Codex" })).getByText("Start new session")
    ).toBeInTheDocument();
  });

  it("renders session state in the mobile agent list", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);

    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
        codex: {
          runtime: {
            available: true,
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: [],
          },
          loading: false,
          installJob: null,
        },
      },
      providers: createDefaultProviders(),
      launch: vi.fn(),
    });

    render(
      <Provider store={store}>
        <MobileAgentSheet
          activeSessionId="sess-1"
          activeWorkspaceId="ws-1"
          sessions={[
            {
              id: "sess-1",
              workspaceId: "ws-1",
              terminalId: "term-1",
              providerId: "claude",
              state: "running",
              capability: "full",
              startedAt: 1,
              lastActiveAt: 1,
            },
            {
              id: "sess-2",
              workspaceId: "ws-1",
              terminalId: "term-2",
              providerId: "codex",
              state: "idle",
              capability: "full",
              startedAt: 1,
              lastActiveAt: 1,
            },
          ]}
          onClose={vi.fn()}
          onCloseSession={vi.fn().mockResolvedValue(undefined)}
          onSelectSession={vi.fn()}
          onSessionCreated={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByText("CLAUDE · Running")).toBeInTheDocument();
    expect(screen.getByText("CODEX · Idle")).toBeInTheDocument();
  });
});
