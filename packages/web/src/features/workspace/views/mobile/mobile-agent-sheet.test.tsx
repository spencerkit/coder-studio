import { render, screen } from "@testing-library/react";
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
          runtime: { available: true },
          loading: false,
          installJob: null,
        },
        codex: {
          runtime: { available: true },
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
});
