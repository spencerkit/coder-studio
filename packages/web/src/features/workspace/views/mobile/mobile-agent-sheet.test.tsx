import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { MobileAgentSheet } from "./mobile-agent-sheet";

const mockUseProviderLauncher = vi.fn();

vi.mock("../../../agent-panes/actions/use-provider-launcher", () => ({
  useProviderLauncher: (...args: unknown[]) => mockUseProviderLauncher(...args),
}));

describe("MobileAgentSheet", () => {
  it("renders semantic icons for create-session and provider launch actions", () => {
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
    expect(screen.getByRole("button", { name: "Create Session" })).toBeInTheDocument();

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
    ).toBeTruthy();
    expect(
      providerView.container.querySelector('[data-icon-semantic="agent.provider.codex"]')
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
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
});
