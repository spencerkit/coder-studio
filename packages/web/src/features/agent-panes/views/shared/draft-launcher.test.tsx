import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { WORKSPACE_PATH_DRAG_MIME } from "../../../../lib/workspace-path-drag";
import { DraftLauncher } from "./draft-launcher";

const mockUseProviderLauncher = vi.fn();
const originalResizeObserver = global.ResizeObserver;

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

function createDraftLauncherStore() {
  const store = createStore();

  store.set(localeAtom, "en");
  store.set(wsClientAtom, {
    sendCommand: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  } as never);

  return store;
}

function installResizeObserverMock() {
  let callback: ResizeObserverCallback | null = null;

  class ResizeObserverMock {
    constructor(observerCallback: ResizeObserverCallback) {
      callback = observerCallback;
    }

    observe() {}
    disconnect() {}
  }

  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

  return {
    resize(target: Element, width: number) {
      if (!callback) {
        throw new Error("ResizeObserver was not created");
      }

      callback(
        [
          {
            target,
            contentRect: { width },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      );
    },
  };
}

describe("DraftLauncher", () => {
  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    vi.useRealTimers();
  });

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

  it("switches draft launcher carousel panels", () => {
    const store = createDraftLauncherStore();

    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    const agentButton = screen.getByRole("button", { name: "Agent" });
    const fileButton = screen.getByRole("button", { name: "File Editor" });
    const carouselTrack = container.querySelector(".agent-draft-component-row");

    expect(agentButton).toHaveAttribute("aria-pressed", "true");
    expect(fileButton).toHaveAttribute("aria-pressed", "false");
    expect(carouselTrack).not.toHaveClass("agent-draft-component-row--file");

    fireEvent.click(fileButton);

    expect(agentButton).toHaveAttribute("aria-pressed", "false");
    expect(fileButton).toHaveAttribute("aria-pressed", "true");
    expect(carouselTrack).toHaveClass("agent-draft-component-row--file");
  });

  it("auto-rotates draft launcher carousel panels in compact layout", async () => {
    vi.useFakeTimers();
    const resizeObserver = installResizeObserverMock();
    const store = createDraftLauncherStore();

    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    const launcher = container.querySelector(".agent-draft-launcher");
    const agentButton = screen.getByRole("button", { name: "Agent" });
    const fileButton = screen.getByRole("button", { name: "File Editor" });
    const carouselTrack = container.querySelector(".agent-draft-component-row");

    expect(launcher).not.toBeNull();
    expect(carouselTrack).not.toHaveClass("agent-draft-component-row--file");

    act(() => {
      resizeObserver.resize(launcher as Element, 360);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(agentButton).toHaveAttribute("aria-pressed", "false");
    expect(fileButton).toHaveAttribute("aria-pressed", "true");
    expect(carouselTrack).toHaveClass("agent-draft-component-row--file");
  });

  it("does not auto-rotate draft launcher carousel panels in wide layout", async () => {
    vi.useFakeTimers();
    const resizeObserver = installResizeObserverMock();
    const store = createDraftLauncherStore();

    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    const launcher = container.querySelector(".agent-draft-launcher");
    const agentButton = screen.getByRole("button", { name: "Agent" });
    const fileButton = screen.getByRole("button", { name: "File Editor" });
    const carouselTrack = container.querySelector(".agent-draft-component-row");

    expect(launcher).not.toBeNull();

    act(() => {
      resizeObserver.resize(launcher as Element, 640);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(agentButton).toHaveAttribute("aria-pressed", "true");
    expect(fileButton).toHaveAttribute("aria-pressed", "false");
    expect(carouselTrack).not.toHaveClass("agent-draft-component-row--file");
  });

  it("renders a draft drop label when pane drag hover is active", () => {
    const store = createStore();

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
          dragState={{
            isDragging: true,
            isActiveDropTarget: true,
            hoverPlacement: "center",
          }}
        />
      </Provider>
    );

    expect(screen.getByText("Move here")).toBeInTheDocument();
  });

  it("preserves session-start intent in diagnostics links for blocked providers", () => {
    mockUseProviderLauncher.mockReturnValue({
      states: {
        claude: {
          runtime: {
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
          loading: false,
          inlineError: "manual",
        },
        codex: createRuntimeState("codex"),
      },
      launch: vi.fn(),
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" paneId="pane-1" />
      </Provider>
    );

    expect(screen.getByRole("link", { name: "Open Diagnostics" })).toHaveAttribute(
      "href",
      "/diagnostics?context=session_start&workspaceId=ws-123&providerId=claude&paneId=pane-1&launchMode=assign"
    );
  });

  it("highlights file drag-over state and opens the dropped workspace file in an editor pane", async () => {
    const store = createStore();
    const onOpenFile = vi.fn();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" paneId="pane-1" onOpenFile={onOpenFile} />
      </Provider>
    );

    const root = container.querySelector('[data-pane-id="pane-1"]') as HTMLElement;
    const payload = { workspaceId: "ws-123", path: "src/app.tsx", kind: "file" as const };

    const dataTransfer = {
      files: [],
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      items: [],
      getData: (type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME ? JSON.stringify(payload) : payload.path,
    };
    const dragOver = createEvent.dragOver(root, { dataTransfer });
    fireEvent(root, dragOver);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(await screen.findByText("Open in editor")).toBeInTheDocument();

    const drop = createEvent.drop(root, { dataTransfer });
    fireEvent(root, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(onOpenFile).toHaveBeenCalledWith("pane-1", "src/app.tsx");
  });

  it("allows drag-over for workspace file drags even when payload data is not readable until drop", async () => {
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" paneId="pane-1" onOpenFile={vi.fn()} />
      </Provider>
    );

    const root = container.querySelector('[data-pane-id="pane-1"]') as HTMLElement;
    const dataTransfer = {
      files: [],
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      items: [],
      getData: () => "",
    };
    const dragOver = createEvent.dragOver(root, { dataTransfer });
    fireEvent(root, dragOver);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(await screen.findByText("Open in editor")).toBeInTheDocument();
  });
});
