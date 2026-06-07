import type { ProviderListItem } from "@coder-studio/core";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { WORKSPACE_PATH_DRAG_MIME } from "../../../../lib/workspace-path-drag";
import { DraftLauncher } from "./draft-launcher";

const mockUseProviderLauncher = vi.fn();
const paneDragEnabledMock = vi.hoisted(() => ({
  value: true,
}));
vi.mock("../../actions/use-provider-launcher", () => ({
  useProviderLauncher: (...args: unknown[]) => mockUseProviderLauncher(...args),
}));

vi.mock("../../actions/use-pane-drag-enabled", () => ({
  usePaneDragEnabled: () => paneDragEnabledMock.value,
}));

function createProvider(
  provider: Partial<ProviderListItem> & Pick<ProviderListItem, "id">
): ProviderListItem {
  return {
    id: provider.id,
    displayName: provider.displayName ?? provider.id,
    badge: provider.badge ?? provider.id,
    kind: provider.kind ?? "built_in",
    stability: provider.stability,
    capability: provider.capability ?? "full",
    capabilities: provider.capabilities ?? [
      { key: "interactive_session", supported: true, label: "Interactive session" },
      { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
    ],
    requiredCommands: provider.requiredCommands ?? [provider.id],
  };
}

function createRuntimeState(providerId: string) {
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

function createProviderLauncherValue() {
  return {
    providers: [
      createProvider({ id: "claude", displayName: "Claude Code", badge: "Claude" }),
      createProvider({ id: "codex", displayName: "Codex", badge: "Codex" }),
      createProvider({ id: "gemini", displayName: "Gemini CLI", badge: "Gemini" }),
      createProvider({ id: "cursor", displayName: "Cursor Agent", badge: "Cursor" }),
      createProvider({
        id: "opencode",
        displayName: "OpenCode",
        badge: "OpenCode",
        stability: "experimental",
        capability: "limited",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "supervisor_eval", supported: false, label: "Supervisor evaluation" },
        ],
      }),
    ],
    states: {
      claude: createRuntimeState("claude"),
      codex: createRuntimeState("codex"),
      gemini: createRuntimeState("gemini"),
      cursor: createRuntimeState("cursor"),
      opencode: createRuntimeState("opencode"),
    },
    launch: vi.fn(),
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

describe("DraftLauncher", () => {
  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    paneDragEnabledMock.value = true;
    mockUseProviderLauncher.mockReturnValue(createProviderLauncherValue());
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

  it("renders a drag handle in the header actions on desktop", () => {
    const store = createDraftLauncherStore();
    const onPaneDragStart = vi.fn();

    render(
      <Provider store={store}>
        <DraftLauncher
          workspaceId="ws-123"
          paneId="pane-1"
          onPaneDragStart={onPaneDragStart as never}
        />
      </Provider>
    );

    const dragHandle = screen.getByRole("button", { name: "Drag pane" });

    expect(dragHandle).toBeInTheDocument();

    fireEvent.pointerDown(dragHandle);

    expect(onPaneDragStart).toHaveBeenCalledWith(expect.objectContaining({ paneId: "pane-1" }));
  });

  it("renders provider cards without capability metadata in the launcher", () => {
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

    const claudeCard = container.querySelector(".agent-provider-card-claude");
    const codexCard = container.querySelector(".agent-provider-card-codex");
    const geminiCard = container.querySelector(".agent-provider-card-gemini");
    const cursorCard = container.querySelector(".agent-provider-card-cursor");
    const opencodeCard = container.querySelector(".agent-provider-card-opencode");

    expect(claudeCard).not.toBeNull();
    expect(codexCard).not.toBeNull();
    expect(geminiCard).not.toBeNull();
    expect(cursorCard).not.toBeNull();
    expect(opencodeCard).not.toBeNull();
    expect(container.querySelector('[data-icon-semantic^="agent.provider."]')).toBeNull();
    expect(within(claudeCard as HTMLElement).getByText("CL")).toBeInTheDocument();
    expect(within(codexCard as HTMLElement).getByText("CO")).toBeInTheDocument();
    expect(within(geminiCard as HTMLElement).getByText("GE")).toBeInTheDocument();
    expect(within(cursorCard as HTMLElement).getByText("CU")).toBeInTheDocument();
    expect(within(opencodeCard as HTMLElement).getByText("OP")).toBeInTheDocument();
    expect(screen.queryByText("Limited Support")).not.toBeInTheDocument();
    expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
    expect(screen.queryByText("Supervisor evaluation")).not.toBeInTheDocument();
    expect(screen.queryByText("Interactive session")).not.toBeInTheDocument();
  });

  it("renders provider rows as single-line labels with a dedicated CTA column", () => {
    const store = createDraftLauncherStore();
    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    const claudeCard = container.querySelector(".agent-provider-card-claude");
    const claudeMeta = claudeCard?.querySelector(".agent-provider-card-meta");

    expect(claudeCard).not.toBeNull();
    expect(claudeMeta).not.toBeNull();
    expect(container.querySelector(".agent-provider-card-subtitle")).toBeNull();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
    expect(within(claudeCard as HTMLElement).getByText("Claude")).toBeInTheDocument();
    expect(within(claudeMeta as HTMLElement).getByText("Start Session")).toBeInTheDocument();
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

  it("renders split helper copy inside the agent and file headers", () => {
    const store = createDraftLauncherStore();
    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    const workarea = container.querySelector(".agent-draft-workarea");
    const workareaMain = container.querySelector(".agent-draft-workarea-main");
    const workareaSide = container.querySelector(".agent-draft-workarea-side");

    expect(workarea).not.toBeNull();
    expect(workareaMain).not.toBeNull();
    expect(workareaSide).not.toBeNull();
    expect(container.querySelector(".agent-draft-footer")).toBeNull();
    expect(container.querySelector(".agent-draft-workarea-copy")).toBeNull();
    expect(container.querySelector(".agent-draft-panel-icon")).toBeNull();
    expect(
      within(workareaMain as HTMLElement).getByText("Click to launch an Agent")
    ).toBeInTheDocument();
    expect(
      within(workareaSide as HTMLElement).getByText("Or drop files on the right side to open them")
    ).toBeInTheDocument();
    expect(within(workareaSide as HTMLElement).getByText("Drop files to open")).toBeInTheDocument();
  });

  it("does not render the old agent and file editor panel titles", () => {
    const store = createDraftLauncherStore();
    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    expect(screen.queryByText("File Editor")).not.toBeInTheDocument();
    expect(container.querySelector(".agent-draft-carousel-dots")).toBeNull();
    expect(container.querySelector(".agent-draft-component-row")).not.toHaveAttribute(
      "data-active-panel"
    );
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
      providers: createProviderLauncherValue().providers,
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
        gemini: createRuntimeState("gemini"),
        cursor: createRuntimeState("cursor"),
        opencode: createRuntimeState("opencode"),
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

  it("does not show manual install guidance for providers that are already available", () => {
    mockUseProviderLauncher.mockReturnValue({
      providers: createProviderLauncherValue().providers,
      states: {
        claude: createRuntimeState("claude"),
        codex: createRuntimeState("codex"),
        gemini: createRuntimeState("gemini"),
        cursor: {
          runtime: {
            providerId: "cursor",
            available: true,
            missingCommands: [],
            missingPrerequisites: [],
            autoInstallSupported: false,
            installReadiness: "ready",
            manualGuideKeys: ["provider.install.cursor.manual"],
            docUrls: {
              provider: "https://cursor.com/docs/cli/installation",
              prerequisites: {},
            },
          },
          loading: false,
        },
        opencode: createRuntimeState("opencode"),
      },
      launch: vi.fn(),
    });

    const store = createDraftLauncherStore();
    const { container } = render(
      <Provider store={store}>
        <DraftLauncher workspaceId="ws-123" />
      </Provider>
    );

    const cursorCard = container.querySelector(".agent-provider-card-cursor");

    expect(cursorCard).not.toBeNull();
    expect(
      within(cursorCard as HTMLElement).queryByText(
        "Install Cursor Agent from the official CLI installation guide, then make sure agent is available on PATH."
      )
    ).toBeNull();
    expect(
      within(cursorCard as HTMLElement).queryByRole("link", { name: "Open official docs" })
    ).toBeNull();
    expect(
      within(cursorCard as HTMLElement).queryByRole("link", { name: "Open Diagnostics" })
    ).toBeNull();
    expect(within(cursorCard as HTMLElement).getByText("Start Session")).toBeInTheDocument();
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
