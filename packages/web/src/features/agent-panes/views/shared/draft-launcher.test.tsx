import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { DraftLauncher } from "./draft-launcher";

const mockUseProviderLauncher = vi.fn();

vi.mock("../../actions/use-provider-launcher", () => ({
  useProviderLauncher: (...args: unknown[]) => mockUseProviderLauncher(...args),
}));

function createRuntimeState(providerId: "claude" | "codex") {
  return {
    runtime: {
      providerId,
      available: true,
      missingCommands: [],
      missingPrerequisites: [],
      autoInstallSupported: false,
      installReadiness: "ready" as const,
      manualGuideKeys: [],
      docUrls: {
        provider: "",
        prerequisites: {},
      },
    },
    loading: false,
  };
}

describe("DraftLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: createRuntimeState("claude"),
        codex: createRuntimeState("codex"),
      },
      launch: vi.fn(),
    });
  });

  it("uses shared IconButton compatibility classes for header actions", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <DraftLauncher
          workspaceId="ws-123"
          paneId="pane-1"
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
        />
      </Provider>
    );

    const splitHorizontal = screen.getByRole("button", { name: "Split horizontal" });
    const splitVertical = screen.getByRole("button", { name: "Split vertical" });
    const close = screen.getByRole("button", { name: "Close" });

    expect(splitHorizontal).toHaveClass("btn", "btn-ghost", "btn-sm", "session-action-btn");
    expect(splitVertical).toHaveClass("btn", "btn-ghost", "btn-sm", "session-action-btn");
    expect(close).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "session-action-btn",
      "session-action-btn-close"
    );

    fireEvent.click(splitHorizontal);
    fireEvent.click(splitVertical);
    fireEvent.click(close);

    expect(onSplitPane).toHaveBeenNthCalledWith(1, "pane-1", "horizontal");
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "pane-1", "vertical");
    expect(onClosePane).toHaveBeenCalledWith("pane-1");
  });

  it("renders provider cards with semantic business icons", () => {
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    expect(container.querySelector('[data-icon-semantic="agent.provider.claude"]')).toBeTruthy();
    expect(container.querySelector('[data-icon-semantic="agent.provider.codex"]')).toBeTruthy();
  });

  it("renders the agent selection title", () => {
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    expect(screen.getByText("Select Agent")).toBeInTheDocument();
  });
});
