import type { ProviderRuntimeStatusResponse, Session } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { sessionsAtom } from "../../atoms/sessions";
import { activeWorkspaceIdAtom, workspacesLoadStateAtom } from "../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../test-utils/workspace-state";
import { activeFilePathAtomFamily, openFilesAtomFamily } from "../workspace/atoms";
import type { PaneDropIntent } from "./actions/pane-drag-types";
import type { PaneDragSourceSnapshot } from "./actions/use-pane-drag-controller";
import { activeEditorPaneIdAtomFamily, focusedEditorPaneIdAtomFamily } from "./atoms/editor-panes";
import { LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX, paneLayoutAtomFamily } from "./atoms/pane-layout";
import { AgentPanes } from "./index";

type MockSessionCardProps = {
  dragState?: {
    isActiveDropTarget: boolean;
    isDragging: boolean;
    hoverPlacement: PaneDropIntent["placement"] | null;
  };
  onPaneDragStart?: (source: PaneDragSourceSnapshot) => void;
  paneId?: string;
  sessionId: string;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClose?: () => void;
  onPaneDrop?: (intent: PaneDropIntent) => void;
};

const mockSessionCard = vi.fn(
  ({
    paneId,
    sessionId,
    dragState,
    onPaneDragStart,
    onSplitHorizontal,
    onSplitVertical,
    onClose,
    onPaneDrop,
  }: MockSessionCardProps) => (
    <div
      data-testid="session-card"
      data-dragging={dragState?.isDragging ? "true" : undefined}
      data-drop-target={dragState?.isActiveDropTarget ? "true" : undefined}
      data-hover-placement={dragState?.hoverPlacement ?? undefined}
    >
      <span>{sessionId}</span>
      {paneId && onPaneDragStart ? (
        <button
          type="button"
          onPointerDown={() =>
            onPaneDragStart({
              paneId,
              providerLabel: sessionId === "sess_1" ? "Claude" : "Codex",
              sessionId,
              title: sessionId,
            })
          }
        >
          drag-{sessionId}
        </button>
      ) : null}
      <button type="button" onClick={onSplitHorizontal}>
        split-{sessionId}
      </button>
      <button type="button" onClick={onSplitVertical}>
        split-vertical-{sessionId}
      </button>
      <button type="button" onClick={onClose}>
        close-{sessionId}
      </button>
      {paneId && onPaneDrop ? (
        <>
          <button
            type="button"
            onClick={() =>
              onPaneDrop({
                sourcePaneId: paneId,
                targetPaneId: paneId === "left" ? "right" : "left",
                placement: "center",
                targetType: "session",
              })
            }
          >
            drop-center-{sessionId}
          </button>
          <button
            type="button"
            onClick={() =>
              onPaneDrop({
                sourcePaneId: paneId,
                targetPaneId: paneId === "left" ? "right" : "left",
                placement: "left",
                targetType: "session",
              })
            }
          >
            drop-left-{sessionId}
          </button>
        </>
      ) : null}
    </div>
  )
);

vi.mock("./views/shared/session-card", () => ({
  SessionCard: (props: MockSessionCardProps) => mockSessionCard(props),
}));

type MockDraftLauncherProps = {
  dragState?: {
    isActiveDropTarget: boolean;
    isDragging: boolean;
    hoverPlacement: PaneDropIntent["placement"] | null;
  };
  workspaceId: string;
  paneId?: string;
  onAssignSession?: (paneId: string, sessionId: string) => void;
  onClosePane?: (paneId: string) => void;
  onOpenFile?: (paneId: string, path: string) => void;
  onReplaceWithSession?: (sessionId: string) => void;
  onSplitPane?: (paneId: string, direction: "horizontal" | "vertical") => void;
  onPaneDrop?: (intent: PaneDropIntent) => void;
};

vi.mock("./views/shared/draft-launcher", async () => {
  const actual = await vi.importActual<typeof import("./views/shared/draft-launcher")>(
    "./views/shared/draft-launcher"
  );

  return {
    ...actual,
    DraftLauncher: ({ paneId, onPaneDrop, dragState, ...props }: MockDraftLauncherProps) => (
      <div
        data-testid={paneId ? `draft-launcher-${paneId}` : "draft-launcher-standalone"}
        data-dragging={dragState?.isDragging ? "true" : undefined}
        data-drop-target={dragState?.isActiveDropTarget ? "true" : undefined}
        data-hover-placement={dragState?.hoverPlacement ?? undefined}
      >
        <actual.DraftLauncher {...props} dragState={dragState} paneId={paneId} />
        {paneId && onPaneDrop ? (
          <button
            type="button"
            onClick={() =>
              onPaneDrop({
                sourcePaneId: "left",
                targetPaneId: paneId,
                placement: "center",
                targetType: "draft",
              })
            }
          >
            move-to-draft-{paneId}
          </button>
        ) : null}
        {paneId && props.onOpenFile ? (
          <button type="button" onClick={() => props.onOpenFile?.(paneId, "src/app.tsx")}>
            open-file-{paneId}
          </button>
        ) : null}
      </div>
    ),
  };
});

const mockEditorPaneCard = vi.fn(
  ({
    paneId,
    dragState,
    onClosePane,
    onPaneDragStart,
  }: {
    paneId: string;
    workspaceId: string;
    dragState?: {
      isActiveDropTarget: boolean;
      isDragging: boolean;
      hoverPlacement: PaneDropIntent["placement"] | null;
    };
    onClosePane: (paneId: string) => void;
    onPaneDragStart?: (source: PaneDragSourceSnapshot) => void;
    onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  }) => (
    <div
      data-testid={`editor-pane-${paneId}`}
      data-dragging={dragState?.isDragging ? "true" : undefined}
      data-drop-target={dragState?.isActiveDropTarget ? "true" : undefined}
      data-hover-placement={dragState?.hoverPlacement ?? undefined}
    >
      {onPaneDragStart ? (
        <button type="button" onPointerDown={() => onPaneDragStart({ paneId, title: paneId })}>
          drag-{paneId}
        </button>
      ) : null}
      <button type="button" onClick={() => onClosePane(paneId)}>
        close-editor-{paneId}
      </button>
    </div>
  )
);

const AVAILABLE_PROVIDER_RUNTIME_STATUS: ProviderRuntimeStatusResponse = {
  providers: {
    claude: {
      providerId: "claude",
      displayName: "Claude",
      badge: "Claude",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [],
      requiredCommands: ["claude"],
      available: true,
      missingCommands: [],
      missingPrerequisites: [],
      autoInstallSupported: false,
      installReadiness: "ready",
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
    },
    codex: {
      providerId: "codex",
      displayName: "Codex",
      badge: "Codex",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [],
      requiredCommands: ["codex"],
      available: true,
      missingCommands: [],
      missingPrerequisites: [],
      autoInstallSupported: false,
      installReadiness: "ready",
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
    },
  },
};

vi.mock("./views/shared/editor-pane-card", () => ({
  EditorPaneCard: (props: {
    paneId: string;
    workspaceId: string;
    dragState?: {
      isActiveDropTarget: boolean;
      isDragging: boolean;
      hoverPlacement: PaneDropIntent["placement"] | null;
    };
    onClosePane: (paneId: string) => void;
    onPaneDragStart?: (source: PaneDragSourceSnapshot) => void;
    onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  }) => mockEditorPaneCard(props),
}));

vi.mock("./views/shared/pane-layout", () => ({
  PaneLayout: ({
    children,
    ratio,
    splitId,
    onRatioCommit,
  }: {
    children: React.ReactNode;
    ratio: number;
    splitId?: string;
    onRatioCommit?: (ratio: number) => void;
  }) => (
    <div data-testid="pane-layout" data-ratio={ratio} data-split-id={splitId}>
      <button type="button" onClick={() => onRatioCommit?.(0.73)}>
        resize-{splitId ?? "unknown"}
      </button>
      {children}
    </div>
  ),
}));

function createAgentPaneStore(
  initialLayout?: unknown,
  customSendCommand?: ReturnType<typeof vi.fn>,
  connectionStatus:
    | "connecting"
    | "connected"
    | "disconnected"
    | "reconnecting"
    | "rejected" = "connected"
) {
  const store = createStore();
  const sessions: Session[] = [
    {
      id: "sess_1",
      workspaceId: "ws-1",
      terminalId: "term-1",
      providerId: "claude",
      state: "running",
      capability: "full",
      startedAt: Date.now() - 10_000,
      lastActiveAt: Date.now() - 1_000,
    },
    {
      id: "sess_2",
      workspaceId: "ws-1",
      terminalId: "term-2",
      providerId: "codex",
      state: "idle",
      capability: "full",
      startedAt: Date.now() - 8_000,
      lastActiveAt: Date.now() - 500,
    },
  ];
  const sendCommand =
    customSendCommand ??
    vi.fn(async (op: string) => {
      if (op === "session.list") {
        return sessions;
      }

      return undefined;
    });

  store.set(connectionStatusAtom, connectionStatus);
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(activeWorkspaceIdAtom, "ws-1");
  seedReadyWorkspaceState(store, {
    "ws-1": {
      id: "ws-1",
      name: "repo",
      path: "/tmp/repo",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  store.set(
    sessionsAtom,
    Object.fromEntries(sessions.map((session) => [session.id, session])) as Record<string, Session>
  );
  store.set(
    paneLayoutAtomFamily("ws-1"),
    (initialLayout as never) ?? {
      id: "root",
      type: "leaf",
      sessionId: "sess_1",
    }
  );

  return { store, sendCommand, sessions };
}

function setPaneRect(
  paneId: string,
  rect: { left: number; top: number; width: number; height: number }
) {
  const element = document.querySelector(`[data-pane-id="${paneId}"]`);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing pane wrapper for ${paneId}`);
  }

  const domRect = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  } as DOMRect;

  element.getBoundingClientRect = vi.fn(() => domRect);
  return element;
}

describe("AgentPanes", () => {
  beforeEach(() => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("renders the shared empty state when no workspace is active", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(workspacesLoadStateAtom, "ready");
    store.set(activeWorkspaceIdAtom, null);
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    expect(screen.getByText("No workspace open")).toBeInTheDocument();
  });

  it("splits the active session pane when session-card requests a split", async () => {
    const { store } = createAgentPaneStore();

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "split-sess_1" }));

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual(
        expect.objectContaining({
          type: "split",
          direction: "horizontal",
          children: [
            expect.objectContaining({ sessionId: "sess_1" }),
            expect.objectContaining({ type: "leaf" }),
          ],
        })
      );
    });
  });

  it("persists pane layout mutations into workspace ui state after a split", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "running",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
          {
            id: "sess_2",
            workspaceId: "ws-1",
            terminalId: "term-2",
            providerId: "codex",
            state: "idle",
            capability: "full",
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "repo",
          path: "/tmp/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: args?.uiState,
        };
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(undefined, sendCommand, "connected");

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "split-sess_1" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.uiState.set",
        expect.objectContaining({
          workspaceId: "ws-1",
          uiState: expect.objectContaining({
            leftPanelWidth: 280,
            bottomPanelHeight: 200,
            focusMode: false,
            paneLayout: expect.objectContaining({
              type: "split",
              direction: "horizontal",
              children: [
                expect.objectContaining({ sessionId: "sess_1" }),
                expect.objectContaining({ type: "leaf" }),
              ],
            }),
          }),
        }),
        undefined
      );
    });
  });

  it("closes only the target pane and preserves the split layout as a draft leaf", async () => {
    const { store, sendCommand } = createAgentPaneStore({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "close-sess_1" }));

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      });
    });

    expect(sendCommand).toHaveBeenCalledWith("session.stop", { sessionId: "sess_1" }, undefined);
  });

  it("swaps pane sessions on a center drop over another session pane", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "running",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
          {
            id: "sess_2",
            workspaceId: "ws-1",
            terminalId: "term-2",
            providerId: "codex",
            state: "idle",
            capability: "full",
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "repo",
          path: "/tmp/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: args?.uiState,
        };
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      },
      sendCommand,
      "connected"
    );

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "drop-center-sess_1" }));
    });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_2" },
          { id: "right", type: "leaf", sessionId: "sess_1" },
        ],
      });
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          paneLayout: {
            id: "root",
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            children: [
              { id: "left", type: "leaf", sessionId: "sess_2" },
              { id: "right", type: "leaf", sessionId: "sess_1" },
            ],
          },
        }),
      }),
      undefined
    );
  });

  it("swaps a session with a draft pane on a center drop over a draft target", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "running",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "repo",
          path: "/tmp/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: args?.uiState,
        };
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf" },
        ],
      },
      sendCommand,
      "connected"
    );

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "move-to-draft-right" }));
    });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf" },
          { id: "right", type: "leaf", sessionId: "sess_1" },
        ],
      });
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          paneLayout: {
            id: "root",
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            children: [
              { id: "left", type: "leaf" },
              { id: "right", type: "leaf", sessionId: "sess_1" },
            ],
          },
        }),
      }),
      undefined
    );
  });

  it("inserts a dragged session at the target edge on an edge drop", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "running",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
          {
            id: "sess_2",
            workspaceId: "ws-1",
            terminalId: "term-2",
            providerId: "codex",
            state: "idle",
            capability: "full",
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "repo",
          path: "/tmp/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: args?.uiState,
        };
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      },
      sendCommand,
      "connected"
    );

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "drop-left-sess_1" }));
    });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^split-right-left-/),
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            expect.objectContaining({ id: "left", type: "leaf", sessionId: "sess_1" }),
            expect.objectContaining({ id: "right", type: "leaf", sessionId: "sess_2" }),
          ],
        })
      );
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          paneLayout: expect.objectContaining({
            id: expect.stringMatching(/^split-right-left-/),
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            children: [
              expect.objectContaining({ id: "left", type: "leaf", sessionId: "sess_1" }),
              expect.objectContaining({ id: "right", type: "leaf", sessionId: "sess_2" }),
            ],
          }),
        }),
      }),
      undefined
    );
  });

  it("registers pane leaf wrappers and swaps sessions through pointer drag", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "running",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
          {
            id: "sess_2",
            workspaceId: "ws-1",
            terminalId: "term-2",
            providerId: "codex",
            state: "idle",
            capability: "full",
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "repo",
          path: "/tmp/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: args?.uiState,
        };
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      },
      sendCommand,
      "connected"
    );

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    const leftPane = setPaneRect("left", { left: 0, top: 0, width: 220, height: 180 });
    const rightPane = setPaneRect("right", { left: 260, top: 0, width: 220, height: 180 });

    fireEvent.pointerDown(screen.getByRole("button", { name: "drag-sess_1" }));

    await waitFor(() => {
      expect(document.body).toHaveClass("is-dragging-pane");
    });

    fireEvent.pointerMove(window, { clientX: 370, clientY: 90 });

    await waitFor(() => {
      expect(leftPane).toHaveAttribute("data-pane-dragging", "true");
      expect(rightPane).toHaveAttribute("data-pane-drop-target", "true");
      expect(rightPane).toHaveAttribute("data-pane-hover-placement", "center");
    });

    fireEvent.pointerUp(window, { clientX: 370, clientY: 90 });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_2" },
          { id: "right", type: "leaf", sessionId: "sess_1" },
        ],
      });
    });

    expect(document.body).not.toHaveClass("is-dragging-pane");
  });

  it("registers editor pane wrappers as drop targets and swaps with a session through pointer drag", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "session", sessionId: "sess_1" },
        { id: "right", type: "leaf", leafKind: "editor" },
      ],
    });
    store.set(activeEditorPaneIdAtomFamily("ws-1"), "right");
    store.set(focusedEditorPaneIdAtomFamily("ws-1"), "right");

    render(
      <Provider store={store}>
        <AgentPanes hydrateSessions={false} />
      </Provider>
    );

    const editorPane = setPaneRect("right", { left: 260, top: 0, width: 220, height: 180 });
    setPaneRect("left", { left: 0, top: 0, width: 220, height: 180 });

    fireEvent.pointerDown(screen.getByRole("button", { name: "drag-sess_1" }));
    fireEvent.pointerMove(window, { clientX: 370, clientY: 90 });

    await waitFor(() => {
      expect(editorPane).toHaveAttribute("data-pane-drop-target", "true");
      expect(editorPane).toHaveAttribute("data-pane-hover-placement", "center");
    });

    fireEvent.pointerUp(window, { clientX: 370, clientY: 90 });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", leafKind: "editor" },
          { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_1" },
        ],
      });
      expect(store.get(activeEditorPaneIdAtomFamily("ws-1"))).toBe("left");
    });
  });

  it("keeps editor focus attached when the editor pane is dragged over a session", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_1" },
      ],
    });
    store.set(activeEditorPaneIdAtomFamily("ws-1"), "left");
    store.set(focusedEditorPaneIdAtomFamily("ws-1"), "left");

    render(
      <Provider store={store}>
        <AgentPanes hydrateSessions={false} />
      </Provider>
    );

    setPaneRect("left", { left: 0, top: 0, width: 220, height: 180 });
    const sessionPane = setPaneRect("right", { left: 260, top: 0, width: 220, height: 180 });

    fireEvent.pointerDown(screen.getByRole("button", { name: "drag-left" }));
    fireEvent.pointerMove(window, { clientX: 370, clientY: 90 });

    await waitFor(() => {
      expect(sessionPane).toHaveAttribute("data-pane-drop-target", "true");
      expect(sessionPane).toHaveAttribute("data-pane-hover-placement", "center");
    });

    fireEvent.pointerUp(window, { clientX: 370, clientY: 90 });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", leafKind: "session", sessionId: "sess_1" },
          { id: "right", type: "leaf", leafKind: "editor" },
        ],
      });
      expect(store.get(activeEditorPaneIdAtomFamily("ws-1"))).toBe("right");
      expect(store.get(focusedEditorPaneIdAtomFamily("ws-1"))).toBe("right");
    });
  });

  it("keeps the remaining draft pane visible after closing the last session pane", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf" },
      ],
    });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "close-sess_1" }));

    // After close, both panes become draft leaves, split structure is preserved
    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf" },
          { id: "right", type: "leaf" },
        ],
      });
    });
  });

  it("does not wire a standalone stop action into the session card header", async () => {
    const { store } = createAgentPaneStore();

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
        id: expect.any(String),
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          expect.objectContaining({ type: "leaf", sessionId: "sess_1" }),
          expect.objectContaining({ type: "leaf", sessionId: "sess_2" }),
        ],
      });
    });

    const layoutBeforeStop = structuredClone(store.get(paneLayoutAtomFamily("ws-1")));

    expect(screen.queryByRole("button", { name: "stop-sess_1" })).not.toBeInTheDocument();

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual(layoutBeforeStop);
  });

  it("waits for the websocket connection before requesting session.list", async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);
    const { store } = createAgentPaneStore(undefined, sendCommand, "connecting");
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {});
    expect(sendCommand).not.toHaveBeenCalledWith(
      "session.list",
      { workspaceId: "ws-1" },
      undefined
    );

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });
  });

  it("re-requests session.list after remount when the pane tree mounts again", async () => {
    const sendCommand = vi.fn().mockResolvedValue([
      {
        id: "sess_1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "claude",
        state: "running",
        capability: "full",
        startedAt: Date.now() - 10_000,
        lastActiveAt: Date.now() - 1_000,
      },
    ]);
    const { store } = createAgentPaneStore(undefined, sendCommand, "connected");
    store.set(sessionsAtom, {});

    const { unmount } = render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    unmount();
    sendCommand.mockClear();
    mockSessionCard.mockClear();
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });
  });

  it("mounts all ended sessions when no pane layout has been persisted yet", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "ended",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
            endedAt: Date.now() - 500,
          },
          {
            id: "sess_2",
            workspaceId: "ws-1",
            terminalId: "term-2",
            providerId: "codex",
            state: "ended",
            capability: "full",
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
            endedAt: Date.now() - 250,
          },
        ];
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "leaf",
      },
      sendCommand,
      "connected"
    );
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "split-fallback-1",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "fallback-leaf-1", type: "leaf", leafKind: "session", sessionId: "sess_1" },
        { id: "fallback-leaf-2", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    });
    expect(mockSessionCard).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess_1" }));
    expect(mockSessionCard).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess_2" }));
  });

  it("migrates legacy local pane layout to workspace ui state", async () => {
    const legacyLayout = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };
    window.localStorage.setItem(
      `${LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX}ws-1`,
      JSON.stringify(legacyLayout)
    );

    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "running",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
          {
            id: "sess_2",
            workspaceId: "ws-1",
            terminalId: "term-2",
            providerId: "codex",
            state: "idle",
            capability: "full",
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "repo",
          path: "/tmp/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: args?.uiState,
        };
      }

      return undefined;
    });
    const { store } = createAgentPaneStore({ id: "root", type: "leaf" }, sendCommand, "connected");
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.uiState.set",
        expect.objectContaining({
          workspaceId: "ws-1",
          uiState: expect.objectContaining({
            paneLayout: {
              id: "root",
              type: "split",
              direction: "horizontal",
              children: [
                { id: "left", type: "leaf", leafKind: "session", sessionId: "sess_1" },
                { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
              ],
            },
          }),
        }),
        undefined
      );
    });

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "session", sessionId: "sess_1" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    });
    expect(window.localStorage.getItem(`${LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX}ws-1`)).toBeNull();
  });

  it("restores split ratios from client-local storage after remount", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    });

    const { unmount } = render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    const initialPaneLayout = screen.getByTestId("pane-layout");
    expect(initialPaneLayout).toHaveAttribute("data-ratio", "0.5");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "resize-root" }));
    });

    expect(window.localStorage.getItem("ui.paneRatio.ws-1.root")).toBe("0.73");

    unmount();

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("pane-layout")).toHaveAttribute("data-ratio", "0.73");
    });
  });

  it("keeps ended sessions mounted in the pane layout after session.list hydration", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "ended",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
            endedAt: Date.now() - 250,
          },
        ];
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "leaf",
        sessionId: "sess_1",
      },
      sendCommand,
      "connected"
    );
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "leaf",
      sessionId: "sess_1",
    });
    expect(mockSessionCard).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess_1" }));
    const endedCardProps = mockSessionCard.mock.calls.find(
      ([props]) => (props as { sessionId?: string }).sessionId === "sess_1"
    )?.[0] as { onStart?: unknown } | undefined;
    expect(endedCardProps?.onStart).toBeUndefined();
  });

  it("keeps multiple ended sessions mounted in the pane layout after session.list hydration", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [
          {
            id: "sess_1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "claude",
            state: "ended",
            capability: "full",
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
            endedAt: Date.now() - 250,
          },
        ];
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: "root",
        type: "leaf",
        sessionId: "sess_1",
      },
      sendCommand,
      "connected"
    );
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "leaf",
      sessionId: "sess_1",
    });
  });

  it("disables provider buttons while session.create is in flight to prevent re-entry", async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "provider.runtimeStatus") {
        return AVAILABLE_PROVIDER_RUNTIME_STATUS;
      }
      if (op === "session.create") {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      if (op === "session.list") {
        return [];
      }
      return undefined;
    });
    const { store } = createAgentPaneStore(undefined, sendCommand, "connected");
    store.set(sessionsAtom, {});
    store.set(paneLayoutAtomFamily("ws-1"), { id: "root", type: "leaf" });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    const claudeButton = await screen.findByRole("button", { name: /Claude/i });
    const codexButton = screen.getByRole("button", { name: /Codex/i });

    expect(claudeButton).toHaveAttribute("type", "button");
    expect(codexButton).toHaveAttribute("type", "button");

    fireEvent.click(claudeButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "session.create",
        expect.objectContaining({
          workspaceId: "ws-1",
          providerId: "claude",
          themeBackground: expect.stringMatching(/^#[0-9a-fA-F]{6,8}$/),
        }),
        undefined
      );
    });

    expect(claudeButton).toBeDisabled();
    expect(codexButton).toBeDisabled();

    fireEvent.click(claudeButton);
    fireEvent.click(codexButton);

    expect(sendCommand.mock.calls.filter(([op]) => op === "session.create")).toHaveLength(1);

    resolveCreate?.({
      id: "sess_new",
      workspaceId: "ws-1",
      terminalId: "term-new",
      providerId: "claude",
      state: "starting",
      capability: "full",
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    await waitFor(() => {
      expect(store.get(sessionsAtom)).toHaveProperty("sess_new");
    });
  });

  it("shows inline install guidance and a secondary diagnostics link when the provider is unavailable", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") return [];
      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            claude: {
              providerId: "claude",
              available: false,
              missingCommands: ["claude"],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.claude.manual"],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: { npm: "https://nodejs.org/en/download" },
              },
            },
            codex: {
              providerId: "codex",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.codex.manual"],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: { npm: "https://nodejs.org/en/download" },
              },
            },
          },
        };
      }
      if (op === "provider.install.start") {
        return {
          jobId: "job-1",
          providerId: "claude",
          strategyIds: ["npm"],
          status: "failed",
          steps: [],
          failure: {
            code: "install_failed",
            message: "Install Claude Code CLI to continue.",
            docUrls: {
              provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
              prerequisites: {},
            },
          },
        };
      }
      return undefined;
    });

    const { store } = createAgentPaneStore(undefined, sendCommand, "connected");
    store.set(sessionsAtom, {});
    store.set(localeAtom, "en");
    store.set(paneLayoutAtomFamily("ws-1"), { id: "root", type: "leaf" });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("provider.runtimeStatus", {}, undefined);
    });

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /Claude/i }));

    expect(await screen.findByText("Install Claude Code CLI to continue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open official docs" })).toBeInTheDocument();
  });

  it("starts an inline install flow for standalone launches instead of redirecting to diagnostics", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") return [];
      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            codex: {
              providerId: "codex",
              available: false,
              missingCommands: ["codex"],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.codex.manual"],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: { npm: "https://nodejs.org/en/download" },
              },
            },
            claude: {
              providerId: "claude",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.claude.manual"],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: { npm: "https://nodejs.org/en/download" },
              },
            },
          },
        };
      }
      if (op === "provider.install.start") {
        return {
          jobId: "job-1",
          providerId: "codex",
          strategyIds: ["npm"],
          status: "failed",
          steps: [],
          failure: {
            code: "install_failed",
            message: "Automatic install failed",
            docUrls: {
              provider:
                "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
              prerequisites: {},
            },
          },
        };
      }
      return undefined;
    });

    const { store } = createAgentPaneStore(undefined, sendCommand, "connected");
    store.set(sessionsAtom, {});
    store.set(localeAtom, "en");
    store.set(paneLayoutAtomFamily("ws-1"), { id: "root", type: "leaf" });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("provider.runtimeStatus", {}, undefined);
    });

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /Codex/i }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "provider.install.start",
        {
          providerId: "codex",
        },
        undefined
      );
    });

    expect(window.location.pathname).toBe("/");
    expect(await screen.findByText("Automatic install failed")).toBeInTheDocument();
  });

  it("shows inline prerequisite guidance while keeping diagnostics as a secondary link", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") return [];
      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            claude: {
              providerId: "claude",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.claude.manual"],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: { npm: "https://nodejs.org/en/download" },
              },
            },
            codex: {
              providerId: "codex",
              available: false,
              missingCommands: ["codex"],
              missingPrerequisites: ["npm"],
              autoInstallSupported: true,
              installReadiness: "missing_prerequisite",
              manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.codex.manual"],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: { npm: "https://nodejs.org/en/download" },
              },
            },
          },
        };
      }
      return undefined;
    });

    const { store } = createAgentPaneStore(undefined, sendCommand, "connected");
    store.set(sessionsAtom, {});
    store.set(localeAtom, "en");
    store.set(paneLayoutAtomFamily("ws-1"), { id: "root", type: "leaf" });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("provider.runtimeStatus", {}, undefined);
    });

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /Codex/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Install Node\.js from the official download page\./)
      ).toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "provider.install.start",
      expect.anything(),
      undefined
    );
    expect(screen.getByRole("link", { name: "Open Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open official docs" })).toBeInTheDocument();
  });

  it("renders editor leaves with the editor pane card instead of the draft launcher", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    expect(screen.getByTestId("editor-pane-root")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockSessionCard).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("editor-pane-root")).toBeInTheDocument();
    expect(screen.queryByTestId("draft-launcher-root")).not.toBeInTheDocument();
  });

  it("converts a draft pane into an editor pane when a file is opened from the draft launcher", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "leaf",
      leafKind: "draft",
    });

    render(
      <Provider store={store}>
        <AgentPanes hydrateSessions={false} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "open-file-root" }));

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    expect(await screen.findByTestId("editor-pane-root")).toBeInTheDocument();
  });

  it("opens files from the standalone root draft launcher by converting it into an editor pane", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "leaf",
      leafKind: "draft",
    });
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes hydrateSessions={false} />
      </Provider>
    );

    expect(screen.getByTestId("draft-launcher-root")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "open-file-root" }));

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    expect(await screen.findByTestId("editor-pane-root")).toBeInTheDocument();
  });

  it("reuses the existing editor pane when another draft launcher opens a file", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "draft" },
      ],
    });

    render(
      <Provider store={store}>
        <AgentPanes hydrateSessions={false} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "open-file-right" }));

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "draft" },
      ],
    });
    expect(store.get(activeEditorPaneIdAtomFamily("ws-1"))).toBe("left");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-1"))).toBe("left");
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/app.tsx");
  });

  it("closes an editor pane back to draft and clears the active editor target", async () => {
    const { store } = createAgentPaneStore({
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    store.set(activeEditorPaneIdAtomFamily("ws-1"), "root");
    store.set(focusedEditorPaneIdAtomFamily("ws-1"), "root");
    store.set(activeFilePathAtomFamily("ws-1"), "src/app.tsx");
    store.set(openFilesAtomFamily("ws-1"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "export const app = 1;",
        savedContent: "export const app = 1;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <AgentPanes hydrateSessions={false} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "close-editor-root" }));

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "leaf",
      leafKind: "draft",
    });
    expect(store.get(activeEditorPaneIdAtomFamily("ws-1"))).toBeNull();
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-1"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    expect(await screen.findByTestId("draft-launcher-root")).toBeInTheDocument();
  });
});
