import type { Session } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../../atoms/activation";
import {
  authenticatedAtom,
  lastViewedTargetAtom,
  localeAtom,
  pendingFocusSessionAtom,
  visibleMobileSessionIdAtom,
} from "../../atoms/app-ui";
import {
  authEnabledAtom,
  connectionStatusAtom,
  reconnectAttemptCountAtom,
  wsClientAtom,
} from "../../atoms/connection";
import { sessionsAtom } from "../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { paneLayoutAtomFamily } from "../../features/agent-panes/atoms/pane-layout";
import { toastsAtom } from "../../features/notifications/atoms";
import { supervisorCyclesAtom, supervisorsAtom } from "../../features/supervisor/atoms";
import {
  branchQuickPickAtom,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
} from "../../features/workspace/atoms";
import { seedReadyWorkspaceState } from "../../test-utils/workspace-state";
import { MobileShell } from "./index";

const { mockMobileEditorHandleSave, mockMobileEditorToggleSvgTextMode } = vi.hoisted(() => ({
  mockMobileEditorHandleSave: vi.fn(),
  mockMobileEditorToggleSvgTextMode: vi.fn(),
}));

vi.mock("../../features/welcome", () => ({
  WelcomePage: () => <div>WelcomePage</div>,
}));

vi.mock("../../features/settings", () => ({
  SettingsPage: () => <div>SettingsPage</div>,
}));

vi.mock("../../features/command-palette", () => ({
  CommandPalette: () => null,
}));

vi.mock("../../features/workspace/views/shared/branch-quick-pick", async () => {
  const [{ useAtomValue }, { branchQuickPickAtom }] = await Promise.all([
    import("jotai"),
    import("../../features/workspace/atoms"),
  ]);

  return {
    BranchQuickPick: () => {
      const quickPick = useAtomValue(branchQuickPickAtom);
      return quickPick.visible ? <div data-testid="branch-quick-pick-overlay-mock" /> : null;
    },
    DesktopBranchQuickPickPopover: ({ children }: { children: ReactNode }) => children,
  };
});

vi.mock("../../features/auth", () => ({
  LoginPage: () => <div>LoginPage</div>,
}));

vi.mock("../../features/not-found", () => ({
  NotFoundPage: () => <div>Page not found</div>,
}));

vi.mock("../../features/agent-panes", () => ({
  AgentPanes: () => <div data-testid="agent-panes-empty-mock">AgentPanes</div>,
}));

vi.mock("../../features/agent-panes/views/shared/session-card", () => ({
  SessionCard: ({
    sessionId,
    showHeaderActions,
    showSupervisorInline,
    terminalReadOnlyOverride,
    headerAccessory,
  }: {
    sessionId: string;
    showHeaderActions?: boolean;
    showSupervisorInline?: boolean;
    terminalReadOnlyOverride?: boolean;
    headerAccessory?: ReactNode;
  }) => (
    <div
      data-testid="mobile-session-card"
      data-show-header-actions={String(showHeaderActions)}
      data-show-supervisor-inline={String(showSupervisorInline)}
      data-readonly={String(terminalReadOnlyOverride)}
      style={{ display: "flex", flex: "1 1 auto", minHeight: 0, minWidth: 0 }}
    >
      <div data-testid="mobile-session-card-header">
        <span>{sessionId}</span>
        {headerAccessory ? (
          <div data-testid="mobile-session-card-header-accessory">{headerAccessory}</div>
        ) : null}
      </div>
    </div>
  ),
}));

vi.mock("../../features/workspace/views/shared/file-tree-panel", () => ({
  FileTreePanel: ({ onSelectFile }: { onSelectFile?: (path: string) => void }) => (
    <button type="button" onClick={() => onSelectFile?.("src/app.tsx")}>
      mock-file-tree
    </button>
  ),
}));

vi.mock("../../features/workspace/views/shared/git-panel", () => ({
  GitPanel: ({
    onPreviewOpen,
  }: {
    onPreviewOpen?: (preview: { path: string; diff: string; staged: boolean }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onPreviewOpen?.({
          path: "src/app.tsx",
          diff: "diff --git a/src/app.tsx b/src/app.tsx",
          staged: false,
        })
      }
    >
      mock-git-panel
    </button>
  ),
}));

vi.mock("../../features/workspace/views/shared/git-diff-viewer", () => ({
  GitDiffViewer: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="mobile-git-diff-viewer">
      <button type="button" aria-label="关闭" onClick={onClose}>
        关闭
      </button>
      GitDiffViewer
    </div>
  ),
}));

vi.mock("../../features/code-editor/actions/use-code-editor-actions", () => ({
  useCodeEditorActions: () => ({
    activeFilePath: "src/app.tsx",
    activeLoadError: null,
    canSave: true,
    currentFile: {
      kind: "text",
      path: "src/app.tsx",
      content: "export const app = true;",
      baseHash: "hash-1",
      isDirty: true,
    },
    handleClose: vi.fn(),
    handleContentChange: vi.fn(),
    handleSave: mockMobileEditorHandleSave,
    isImageFile: false,
    isSaving: false,
    isSvgTextBacked: false,
    isTextFile: true,
    openInDiffMode: vi.fn(),
    saveError: null,
    toggleSvgTextMode: mockMobileEditorToggleSvgTextMode,
    workspace: {
      id: "ws-1",
      name: "Alpha",
      path: "/tmp/alpha",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
    workspaceId: "ws-1",
  }),
}));

vi.mock("../../features/code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: ({ chrome }: { chrome?: string }) => (
    <div data-testid="mobile-code-editor" data-chrome={chrome ?? "full"}>
      CodeEditorHost
    </div>
  ),
  CodeEditorHeaderActions: () => (
    <button type="button" aria-label="保存文件" onClick={mockMobileEditorHandleSave}>
      保存文件
    </button>
  ),
}));

vi.mock("../../features/terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="mobile-terminal-panel">TerminalPanel</div>,
}));

vi.mock("../../features/notifications", () => ({
  useSessionNotifications: () => {},
  ToastContainer: () => null,
}));

function createSession(
  partial: Partial<Session> & Pick<Session, "id" | "terminalId" | "providerId">
): Session {
  return {
    id: partial.id,
    workspaceId: partial.workspaceId ?? "ws-1",
    terminalId: partial.terminalId,
    providerId: partial.providerId,
    state: partial.state ?? "idle",
    capability: partial.capability ?? "full",
    startedAt: partial.startedAt ?? Date.now() - 10_000,
    lastActiveAt: partial.lastActiveAt ?? Date.now() - 1_000,
    title: partial.title,
    endedAt: partial.endedAt,
    completionPercent: partial.completionPercent,
    errorReason: partial.errorReason,
  };
}

function installVisualViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<EventListener>>();
  const visualViewport = {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      const event = new Event(type);
      listeners.get(type)?.forEach((listener) => listener(event));
    },
  };

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: 800,
  });

  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
  });

  return visualViewport;
}

function installFullscreenApiForMobileShell() {
  let fullscreenElement: Element | null = null;

  const requestFullscreen = vi.fn().mockImplementation(function (this: HTMLElement) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });

  const exitFullscreen = vi.fn().mockImplementation(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });

  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });

  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });

  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });

  return { requestFullscreen, exitFullscreen };
}

function removeFullscreenApiForMobileShell() {
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: false,
  });

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => null,
  });

  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: undefined,
  });

  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: undefined,
  });
}

function installMatchMediaMock(predicate: (query: string) => boolean) {
  const originalMatchMedia = window.matchMedia;
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

  window.matchMedia = vi.fn((query: string) => ({
    matches: predicate(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      const key = `${query}:${type}`;
      const bucket = listeners.get(key) ?? new Set<(event: MediaQueryListEvent) => void>();
      bucket.add(listener);
      listeners.set(key, bucket);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.get(`${query}:${type}`)?.delete(listener);
    }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-display">{location.pathname}</div>;
}

function renderMobileShell({
  initialEntry = "/workspace",
  withWorkspaces = true,
  locale = "en" as "en" | "zh",
  connectionStatus = "connected" as
    | "connected"
    | "connecting"
    | "reconnecting"
    | "disconnected"
    | "rejected",
  reconnectAttempts = 0,
  seedSupervisor = true,
  sessions = [
    createSession({
      id: "sess_1",
      terminalId: "term-1",
      providerId: "claude",
      state: "idle",
      lastActiveAt: Date.now() - 5_000,
      title: "Claude",
    }),
    createSession({
      id: "sess_2",
      terminalId: "term-2",
      providerId: "codex",
      state: "running",
      lastActiveAt: Date.now() - 500,
      title: "Codex",
    }),
  ],
  paneLayout = {
    id: "root",
    type: "split" as const,
    direction: "horizontal" as const,
    children: [
      { id: "left", type: "leaf" as const, sessionId: "sess_1" },
      { id: "right", type: "leaf" as const, sessionId: "sess_2" },
    ],
  },
  sendCommand = vi.fn(async (op: string) => {
    if (op === "session.list") {
      return sessions;
    }

    if (op === "supervisor.get") {
      return {
        supervisor: {
          id: "sup-1",
          sessionId: "sess_2",
          workspaceId: "ws-1",
          objective: "Ship mobile phase 3",
          evaluatorProviderId: "claude",
          state: "idle",
          maxSupervisionCount: 0,
          completedSupervisionCount: 0,
          cycles: [
            {
              id: "cycle-1",
              supervisorId: "sup-1",
              sessionId: "sess_2",
              trigger: "manual",
              status: "completed",
              evidenceSource: "transcript",
              objective: "Ship mobile phase 3",
              evaluatorProviderId: "claude",
              result: "cycle 1/1",
              createdAt: Date.now() - 5_000,
              completedAt: Date.now() - 1_000,
            },
          ],
          createdAt: Date.now() - 5_000,
          updatedAt: Date.now() - 1_000,
        },
      };
    }

    return undefined;
  }),
  sendTerminalInput = vi.fn().mockResolvedValue(undefined),
  lastViewedTarget = null as { workspaceId: string; sessionId?: string; updatedAt: number } | null,
}: {
  initialEntry?: string;
  withWorkspaces?: boolean;
  locale?: "en" | "zh";
  sessions?: Session[];
  seedSupervisor?: boolean;
  paneLayout?: {
    id: string;
    type: "leaf" | "split";
    direction?: "horizontal" | "vertical";
    children?: Array<{ id: string; type: "leaf" | "split"; sessionId?: string }>;
    sessionId?: string;
  };
  sendCommand?: ReturnType<typeof vi.fn>;
  sendTerminalInput?: ReturnType<typeof vi.fn>;
  lastViewedTarget?: { workspaceId: string; sessionId?: string; updatedAt: number } | null;
} = {}) {
  window.localStorage.setItem("ui.locale", JSON.stringify(locale));
  const store = createStore();
  store.set(localeAtom, locale);
  store.set(activationStatusAtom, "active");
  store.set(connectionStatusAtom, connectionStatus);
  store.set(reconnectAttemptCountAtom, reconnectAttempts);
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);
  store.set(wsClientAtom, {
    sendCommand,
    sendTerminalInput,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(lastViewedTargetAtom, lastViewedTarget);
  if (withWorkspaces) {
    seedReadyWorkspaceState(store, {
      "ws-1": {
        id: "ws-1",
        name: "Alpha",
        path: "/tmp/alpha",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          activeSessionId: "sess_2",
          paneLayout: paneLayout as never,
        },
      },
      "ws-2": {
        id: "ws-2",
        name: "Beta",
        path: "/tmp/beta",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(sessionsAtom, Object.fromEntries(sessions.map((session) => [session.id, session])));
    store.set(paneLayoutAtomFamily("ws-1"), paneLayout as never);
    store.set(
      supervisorsAtom,
      seedSupervisor
        ? new Map([
            [
              "sess_2",
              {
                id: "sup-1",
                sessionId: "sess_2",
                workspaceId: "ws-1",
                objective: "Ship mobile phase 3",
                evaluatorProviderId: "claude",
                state: "idle",
                maxSupervisionCount: 0,
                completedSupervisionCount: 0,
                cycles: [
                  {
                    id: "cycle-1",
                    supervisorId: "sup-1",
                    sessionId: "sess_2",
                    trigger: "manual",
                    status: "completed",
                    evidenceSource: "transcript",
                    objective: "Ship mobile phase 3",
                    evaluatorProviderId: "claude",
                    result: "cycle 1/1",
                    createdAt: Date.now() - 5_000,
                    completedAt: Date.now() - 1_000,
                  },
                ],
                createdAt: Date.now() - 5_000,
                updatedAt: Date.now() - 1_000,
              },
            ],
          ])
        : new Map()
    );
    store.set(
      supervisorCyclesAtom,
      seedSupervisor
        ? new Map([
            [
              "sup-1",
              [
                {
                  id: "cycle-1",
                  supervisorId: "sup-1",
                  sessionId: "sess_2",
                  trigger: "manual",
                  status: "completed",
                  evidenceSource: "transcript",
                  objective: "Ship mobile phase 3",
                  evaluatorProviderId: "claude",
                  result: "cycle 1/1",
                  createdAt: Date.now() - 5_000,
                  completedAt: Date.now() - 1_000,
                },
              ],
            ],
          ])
        : new Map()
    );
  }

  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MobileShell />
      </MemoryRouter>
    </Provider>
  );

  return { store, sendCommand, sendTerminalInput, ...view };
}

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === "(max-width: 899px), (pointer: coarse)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: undefined,
  });
  window.localStorage.clear();
  mockMobileEditorHandleSave.mockReset();
  mockMobileEditorToggleSvgTextMode.mockReset();
  vi.unstubAllGlobals();
});

describe("MobileShell Phase 2 workspace", () => {
  it("renders mobile workspace chrome on /workspace", async () => {
    renderMobileShell({ initialEntry: "/workspace" });

    expect(screen.getByRole("button", { name: "Switch workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch active agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Agent sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Files sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Terminal sheet" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Mobile agents" })).not.toBeInTheDocument();
    expect(screen.queryByText("已连接")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_2");
    expect(screen.getByTestId("mobile-session-card")).not.toHaveAttribute("data-readonly", "true");
    expect(screen.getByTestId("mobile-session-card")).toHaveStyle({
      display: "flex",
      flex: "1 1 auto",
      minHeight: "0",
      minWidth: "0",
    });
    expect(screen.getByTestId("mobile-session-card").parentElement).toHaveClass(
      "mobile-shell__agent-stage"
    );
    expect(screen.queryByRole("textbox", { name: "Agent composer" })).not.toBeInTheDocument();
  });

  it("renders the shared workspace footer below the mobile dock", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [];
      }

      if (op === "git.status") {
        return {
          branch: "feature/mobile-footer",
          ahead: 1,
          behind: 0,
          staged: [],
          modified: [{ path: "src/app.tsx", status: "modified" }],
          deleted: [],
          untracked: [],
        };
      }

      return undefined;
    });

    renderMobileShell({ initialEntry: "/workspace", sendCommand });

    await waitFor(() => {
      expect(
        document.querySelector(".mobile-shell__bottom-stack .git-panel-status-strip__branch-text")
      ).toHaveTextContent("feature/mobile-footer");
    });

    expect(
      document.querySelector(".mobile-shell__bottom-stack .workspace-status-bar")
    ).not.toBeNull();
    expect(
      document.querySelector(".mobile-shell__bottom-stack .git-panel-status-strip__branch-text")
    ).toHaveTextContent("feature/mobile-footer");
    expect(document.querySelector(".mobile-shell__bottom-stack")?.lastElementChild).toHaveClass(
      "workspace-status-bar"
    );
  });

  it("opens and closes the files sheet", async () => {
    const user = userEvent.setup();
    renderMobileShell({ initialEntry: "/workspace" });

    await user.click(screen.getByRole("button", { name: "Open Files sheet" }));

    expect(screen.getByRole("tablist", { name: "Files sheet tabs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Close current sheet" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back|返回/i }));

    expect(screen.queryByRole("tab", { name: "Files" })).not.toBeInTheDocument();
  });

  it("shows the current branch name in the shared workspace footer", async () => {
    const { store } = renderMobileShell({ initialEntry: "/workspace" });

    act(() => {
      store.set(gitStateAtomFamily("ws-1"), {
        branch: "feature/mobile-branch-pill",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
      });
    });

    expect(
      document.querySelector(".mobile-shell__bottom-stack .git-panel-status-strip__branch-text")
    ).toHaveTextContent("feature/mobile-branch-pill");
  });

  it("opens branch quick pick from the shared mobile footer", async () => {
    const user = userEvent.setup();
    const { store } = renderMobileShell({ initialEntry: "/workspace" });

    act(() => {
      store.set(gitStateAtomFamily("ws-1"), {
        branch: "feature/mobile-branch-pill",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
      });
    });

    const branchButton = document.querySelector(
      ".mobile-shell__bottom-stack .git-panel-status-strip__branch"
    );
    expect(branchButton).not.toBeNull();
    await user.click(branchButton as HTMLElement);

    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "ws-1",
      inputValue: "",
    });
    expect(screen.getByTestId("branch-quick-pick-overlay-mock")).toBeInTheDocument();
  });

  it("opens the workspace drawer and switches active workspace", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-2",
          updatedAt: 10,
        };
      }

      return undefined;
    });
    const { store } = renderMobileShell({ initialEntry: "/workspace", sendCommand });

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(screen.getByRole("button", { name: "Switch to workspace Beta" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-2", sessionId: undefined },
        undefined
      );
    });
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
  });

  it("closes the active workspace from the mobile workspace drawer and falls back to the next workspace", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [];
      }

      return undefined;
    });
    const { store } = renderMobileShell({
      initialEntry: "/workspace",
      sendCommand,
    });

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(screen.getByRole("button", { name: "Close workspace Alpha" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.close",
        {
          id: "ws-1",
        },
        undefined
      );
    });

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
  });

  it("returns to welcome after closing the last workspace from the mobile workspace drawer", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [];
      }

      return undefined;
    });
    const { store } = renderMobileShell({
      initialEntry: "/workspace",
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
      },
      sendCommand,
    });

    store.set(workspacesLoadStateAtom, "ready");
    store.set(workspacesLoadErrorAtom, null);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        name: "Alpha",
        path: "/tmp/alpha",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    } as never);
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspaceOrderAtom, ["ws-1"]);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(screen.getByRole("button", { name: "Close workspace Alpha" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.close",
        {
          id: "ws-1",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });

  it("shows a direct settings entry instead of a more-actions trigger", async () => {
    renderMobileShell({ initialEntry: "/workspace" });

    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open more actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick Actions" })).not.toBeInTheDocument();
  });

  it("preserves shared IconButton compatibility classes on mobile topbar icon-only triggers", async () => {
    removeFullscreenApiForMobileShell();
    renderMobileShell({ initialEntry: "/workspace" });

    expect(screen.getByRole("button", { name: "Open settings" })).toHaveClass(
      "btn",
      "btn-ghost",
      "mobile-topbar__icon-button"
    );
    expect(screen.getByRole("button", { name: "Enter Fullscreen" })).toHaveClass(
      "btn",
      "btn-ghost",
      "mobile-topbar__icon-button"
    );
  });

  it("opens settings from the direct mobile topbar button", async () => {
    const user = userEvent.setup();
    renderMobileShell({ initialEntry: "/workspace" });

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(screen.getByText("SettingsPage")).toBeInTheDocument();
  });

  it("shows a fullscreen toggle to the right of the settings trigger when the browser supports fullscreen", async () => {
    installFullscreenApiForMobileShell();
    renderMobileShell({ initialEntry: "/workspace" });

    const settingsButton = screen.getByRole("button", { name: "Open settings" });
    const fullscreenButton = await screen.findByRole("button", { name: "Enter Fullscreen" });

    expect(settingsButton.nextElementSibling).toBe(fullscreenButton);
  });

  it("keeps the fullscreen toggle visible on mobile when the browser does not support fullscreen", async () => {
    removeFullscreenApiForMobileShell();
    renderMobileShell({ initialEntry: "/workspace" });

    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Fullscreen" })).toBeInTheDocument();
  });

  it("shows a friendly toast instead of crashing when mobile fullscreen is unavailable", async () => {
    removeFullscreenApiForMobileShell();
    const user = userEvent.setup();
    const { store } = renderMobileShell({ initialEntry: "/workspace" });

    await user.click(screen.getByRole("button", { name: "Enter Fullscreen" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "info",
      title: "Fullscreen unavailable",
      body: "Fullscreen is not available in this browser.",
    });
  });

  it("switches the mobile fullscreen button to exit mode after entering fullscreen", async () => {
    const api = installFullscreenApiForMobileShell();
    const user = userEvent.setup();
    renderMobileShell({ initialEntry: "/workspace" });

    await user.click(await screen.findByRole("button", { name: "Enter Fullscreen" }));

    await waitFor(() => {
      expect(api.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Exit Fullscreen" })).toBeInTheDocument();
    });
  });

  it("keeps welcome route as full-page content outside the workspace scaffold", () => {
    renderMobileShell({ initialEntry: "/", withWorkspaces: false });

    expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
  });

  it("shows a shared loading shell on mobile while auth status is still unknown", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("正在连接工作区...")).toBeInTheDocument();
    expect(document.querySelector(".app-loading-shell")).toBeTruthy();
    expect(screen.getByText("CODER STUDIO").closest(".app-loading-card")).toBeTruthy();
    expect(screen.queryByText("LoginPage")).not.toBeInTheDocument();
  });

  it("renders SettingsPage on mobile /settings while auth status is still unknown", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/settings"]}>
          <LocationProbe />
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("SettingsPage")).toBeInTheDocument();
    expect(screen.getByTestId("location-display")).toHaveTextContent("/settings");
    expect(screen.queryByText("正在连接工作区...")).not.toBeInTheDocument();
  });

  it("does not bootstrap workspaces from / on mobile before redirecting to /login when auth is enabled and user is unauthenticated", async () => {
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/tmp/ws-1",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
      },
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <LocationProbe />
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(screen.getByTestId("location-display")).toHaveTextContent("/login");
      expect(sendCommand).not.toHaveBeenCalled();
    });
  });

  it("keeps the explicit /login route on mobile when auth is enabled and user is unauthenticated", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/login"]}>
          <LocationProbe />
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(screen.getByTestId("location-display")).toHaveTextContent("/login");
    });
  });

  it("redirects /login to / on mobile for authenticated users", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/login"]}>
          <LocationProbe />
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
      expect(screen.getByTestId("location-display")).toHaveTextContent("/");
    });
  });

  it("does not preserve the legacy /auth route on mobile", () => {
    renderMobileShell({
      initialEntry: "/auth",
      withWorkspaces: false,
    });

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("rewrites /auth to /login on mobile when auth is required and user is unauthenticated", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/auth"]}>
          <LocationProbe />
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(screen.getByTestId("location-display")).toHaveTextContent("/login");
    });
  });

  it("shows a loading workspace gate instead of the mobile scaffold while workspaces are still loading", () => {
    const store = createStore();
    store.set(activationStatusAtom, "active");
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "loading");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("Loading workspaces")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-shell")).not.toBeInTheDocument();
  });

  it("shows a workspace load error gate instead of the mobile scaffold when bootstrap fails", () => {
    const store = createStore();
    store.set(activationStatusAtom, "active");
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "error");
    store.set(workspacesLoadErrorAtom, "Failed to fetch workspace list");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("Failed to load workspaces")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-shell")).not.toBeInTheDocument();
  });

  it("does not render the mobile scaffold before redirecting home when /workspace resolves to an empty workspace list", async () => {
    const store = createStore();
    store.set(activationStatusAtom, "active");
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByTestId("mobile-shell")).not.toBeInTheDocument();
    expect(screen.queryByText("No active workspace")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });

  it("redirects /workspace home on mobile when the workspace list is ready but empty while reconnecting", async () => {
    const store = createStore();
    store.set(activationStatusAtom, "active");
    store.set(connectionStatusAtom, "reconnecting");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByText("Loading workspaces")).not.toBeInTheDocument();
    expect(screen.queryByText("No active workspace")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });

  it("shows the global reconnecting banner on non-workspace mobile routes", () => {
    renderMobileShell({
      initialEntry: "/settings",
      locale: "zh",
      connectionStatus: "reconnecting",
      withWorkspaces: false,
    });

    expect(screen.getByText("正在重新连接...")).toBeInTheDocument();
  });

  it("shows a not found page for unknown frontend routes", () => {
    renderMobileShell({
      initialEntry: "/missing-page",
      withWorkspaces: false,
    });

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("switches the active session from the dock selector", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    expect(screen.getByRole("region", { name: "Agent Sessions sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Session" })).toBeInTheDocument();
    const activeRow = screen
      .getByRole("button", {
        name: "Codex",
        description: "Switch to agent Codex CODEX",
      })
      .closest(".mobile-select-sheet__item-row");
    const inactiveRow = screen
      .getByRole("button", {
        name: "Claude",
        description: "Switch to agent Claude CLAUDE",
      })
      .closest(".mobile-select-sheet__item-row");
    expect(activeRow).not.toBeNull();
    expect(inactiveRow).not.toBeNull();
    expect(
      within(activeRow as HTMLElement).getByRole("button", { name: "Close Current Session" })
    ).toBeInTheDocument();
    expect(
      within(inactiveRow as HTMLElement).getByRole("button", { name: "Close Current Session" })
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Claude",
        description: "Switch to agent Claude CLAUDE",
      })
    );

    expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
  });

  it("renders the agent sheet as a fullscreen mobile sheet on mobile", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));

    expect(screen.getByRole("region", { name: "Agent Sessions sheet" })).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);
    expect(document.querySelector(".mobile-shell__bottom-stack .mobile-sheet-layer")).toBeNull();
  });

  it("dismisses the agent sheet when tapping the backdrop", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    await user.click(screen.getByRole("button", { name: "Dismiss current sheet" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Agent Sessions sheet" })
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the provider sheet open when provider launch fails", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [];
      }

      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            claude: {
              providerId: "claude",
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
      }

      if (op === "session.create") {
        throw new Error("session create failed");
      }

      return undefined;
    });

    renderMobileShell({
      sendCommand,
      sessions: [
        createSession({
          id: "sess_2",
          terminalId: "term-2",
          providerId: "codex",
          state: "idle",
          title: "Codex",
        }),
      ],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_2",
      },
    });

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    expect(screen.getByRole("region", { name: "Select Provider sheet" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Codex",
        description: "Start Codex session Start new session",
      })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "session.create",
        {
          workspaceId: "ws-1",
          providerId: "codex",
        },
        undefined
      );
    });

    expect(screen.getByRole("region", { name: "Select Provider sheet" })).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);
  });

  it("switches from session mode to provider mode inside a single mobile select sheet", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));

    expect(screen.getByRole("region", { name: "Agent Sessions sheet" })).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Create Session" }));

    expect(screen.getByRole("region", { name: "Select Provider sheet" })).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("region", { name: "Agent Sessions sheet" })).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);
  });

  it("creates a new agent from the mobile session sheet", async () => {
    const user = userEvent.setup();
    const hydratedSessions = [
      createSession({
        id: "sess_2",
        terminalId: "term-2",
        providerId: "codex",
        state: "idle",
        title: "Codex",
      }),
    ];
    const sendCommand = vi.fn(async (op: string, payload?: Record<string, unknown>) => {
      if (op === "session.list") {
        return hydratedSessions;
      }

      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            claude: {
              providerId: "claude",
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
      }

      if (op === "session.create") {
        return createSession({
          id: "sess_3",
          terminalId: "term-3",
          providerId: String(payload?.providerId ?? "codex"),
          state: "idle",
          title: "Codex 2",
        });
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "Alpha",
          path: "/tmp/alpha",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: payload?.uiState,
        };
      }

      return undefined;
    });

    renderMobileShell({
      sendCommand,
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_2",
      },
    });

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    await user.click(screen.getByRole("button", { name: "Create Session" }));
    await user.click(
      screen.getByRole("button", {
        name: "Codex",
        description: "Start Codex session Start new session",
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_3");
    });
    expect(sendCommand).toHaveBeenCalledWith(
      "session.create",
      {
        workspaceId: "ws-1",
        providerId: "codex",
      },
      undefined
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          activeSessionId: "sess_3",
          paneLayout: expect.objectContaining({
            type: "split",
            direction: "vertical",
            children: [
              expect.objectContaining({ sessionId: "sess_2" }),
              expect.objectContaining({ sessionId: "sess_3" }),
            ],
          }),
        }),
      }),
      undefined
    );
  });

  it("closes the agent sheet once when selecting an existing session", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    await user.click(
      screen.getByRole("button", {
        name: "Claude",
        description: "Switch to agent Claude CLAUDE",
      })
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Agent Sessions sheet" })
      ).not.toBeInTheDocument();
    });

    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(0);
  });

  it("closes the active agent from the current session row action", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [
          createSession({
            id: "sess_1",
            terminalId: "term-1",
            providerId: "claude",
            state: "idle",
            title: "Claude",
          }),
          createSession({
            id: "sess_2",
            terminalId: "term-2",
            providerId: "codex",
            state: "running",
            title: "Codex",
          }),
        ];
      }

      return undefined;
    });

    renderMobileShell({ sendCommand });

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    const activeRow = screen
      .getByRole("button", {
        name: "Codex",
        description: "Switch to agent Codex CODEX",
      })
      .closest(".mobile-select-sheet__item-row");
    expect(activeRow).not.toBeNull();

    await user.click(
      within(activeRow as HTMLElement).getByRole("button", { name: "Close Current Session" })
    );

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
    });
    expect(sendCommand).toHaveBeenCalledWith("session.stop", { sessionId: "sess_2" }, undefined);
  });

  it("closes a non-active agent from its row action without switching first", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [
          createSession({
            id: "sess_1",
            terminalId: "term-1",
            providerId: "claude",
            state: "idle",
            title: "Claude",
          }),
          createSession({
            id: "sess_2",
            terminalId: "term-2",
            providerId: "codex",
            state: "running",
            title: "Codex",
          }),
        ];
      }

      return undefined;
    });

    renderMobileShell({ sendCommand });

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    const inactiveRow = screen
      .getByRole("button", {
        name: "Claude",
        description: "Switch to agent Claude CLAUDE",
      })
      .closest(".mobile-select-sheet__item-row");
    expect(inactiveRow).not.toBeNull();

    await user.click(
      within(inactiveRow as HTMLElement).getByRole("button", { name: "Close Current Session" })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.stop", { sessionId: "sess_1" }, undefined);
    });
    expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_2");
  });

  it("lists and can close a workspace session even when it is missing from the current pane layout", async () => {
    const user = userEvent.setup();
    const existingSession = createSession({
      id: "sess_1",
      terminalId: "term-1",
      providerId: "claude",
      state: "idle",
      lastActiveAt: Date.now() - 5_000,
      title: "Claude",
    });
    const hiddenSession = createSession({
      id: "sess_hidden",
      terminalId: "term-hidden",
      providerId: "codex",
      state: "running",
      lastActiveAt: Date.now() - 500,
      title: "Remote Codex",
    });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [existingSession];
      }

      return undefined;
    });

    const { store } = renderMobileShell({
      sendCommand,
      sessions: [existingSession],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_1",
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
    });

    await act(async () => {
      store.set(sessionsAtom, {
        sess_1: existingSession,
        sess_hidden: hiddenSession,
      });
    });

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));

    const hiddenRow = screen
      .getByRole("button", {
        name: "Remote Codex",
        description: "Switch to agent Remote Codex CODEX",
      })
      .closest(".mobile-select-sheet__item-row");
    expect(hiddenRow).not.toBeNull();

    await user.click(
      within(hiddenRow as HTMLElement).getByRole("button", { name: "Close Current Session" })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "session.stop",
        { sessionId: "sess_hidden" },
        undefined
      );
    });
  });

  it("switches to the target session when a pending focus marker points at a non-active mobile session", async () => {
    const { store } = renderMobileShell({ initialEntry: "/workspace" });

    expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_2");

    await act(async () => {
      store.set(pendingFocusSessionAtom, "sess_1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
    });
  });

  it("persists the global target when a mobile session is selected from the agent sheet", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-1",
          sessionId: "sess_1",
          updatedAt: 10,
        };
      }

      if (op === "session.list") {
        return [
          createSession({
            id: "sess_1",
            terminalId: "term-1",
            providerId: "claude",
            state: "idle",
            title: "Claude",
          }),
          createSession({
            id: "sess_2",
            terminalId: "term-2",
            providerId: "codex",
            state: "running",
            title: "Codex",
          }),
        ];
      }

      return undefined;
    });

    renderMobileShell({ sendCommand });

    await user.click(await screen.findByRole("button", { name: "Open Agent sheet" }));
    await user.click(
      screen.getByRole("button", {
        name: "Claude",
        description: "Switch to agent Claude CLAUDE",
      })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        {
          workspaceId: "ws-1",
          sessionId: "sess_1",
        },
        undefined
      );
    });
  });

  it("tracks the currently visible mobile session in app UI state and clears it on unmount", async () => {
    const { store, unmount } = renderMobileShell({ initialEntry: "/workspace" });

    await waitFor(() => {
      expect(store.get(visibleMobileSessionIdAtom)).toBe("sess_2");
    });

    await act(async () => {
      store.set(pendingFocusSessionAtom, "sess_1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
    });
    await waitFor(() => {
      expect(store.get(visibleMobileSessionIdAtom)).toBe("sess_1");
    });

    unmount();

    await waitFor(() => {
      expect(store.get(visibleMobileSessionIdAtom)).toBeNull();
    });
  });

  it("restores mobile sessions from session.list and workspace pane layout after reload", async () => {
    const sessions = [
      createSession({
        id: "sess_reload_1",
        terminalId: "term-reload-1",
        providerId: "claude",
        state: "idle",
        lastActiveAt: Date.now() - 1000,
        title: "Reloaded Claude",
      }),
    ];
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return sessions;
      }
      return undefined;
    });

    renderMobileShell({
      initialEntry: "/workspace",
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_reload_1",
      },
      sendCommand,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_reload_1");
    });
  });

  it("prefers the saved global session target when the mobile workspace restores", async () => {
    const sessions = [
      createSession({
        id: "sess_1",
        terminalId: "term-1",
        providerId: "claude",
        state: "idle",
        lastActiveAt: Date.now() - 5_000,
        title: "Claude",
      }),
      createSession({
        id: "sess_2",
        terminalId: "term-2",
        providerId: "codex",
        state: "running",
        lastActiveAt: Date.now() - 500,
        title: "Codex",
      }),
    ];

    renderMobileShell({
      initialEntry: "/workspace",
      sessions,
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_1",
      },
      lastViewedTarget: {
        workspaceId: "ws-1",
        sessionId: "sess_1",
        updatedAt: 10,
      },
      sendCommand: vi.fn(async (op: string) => {
        if (op === "session.list") {
          return sessions;
        }

        return undefined;
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
    });
  });

  it("does not persist the global last-viewed target during automatic mobile restore", async () => {
    const sendCommand = vi.fn(async (op: string, payload?: Record<string, unknown>) => {
      if (op === "session.list") {
        return [
          createSession({
            id: "sess_1",
            terminalId: "term-1",
            providerId: "claude",
            state: "idle",
            lastActiveAt: Date.now() - 5_000,
            title: "Claude",
          }),
          createSession({
            id: "sess_2",
            terminalId: "term-2",
            providerId: "codex",
            state: "running",
            lastActiveAt: Date.now() - 500,
            title: "Codex",
          }),
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "Alpha",
          path: "/tmp/alpha",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: payload?.uiState,
        };
      }

      return undefined;
    });

    renderMobileShell({
      initialEntry: "/workspace",
      sendCommand,
      sessions: [
        createSession({
          id: "sess_1",
          terminalId: "term-1",
          providerId: "claude",
          state: "idle",
          lastActiveAt: Date.now() - 5_000,
          title: "Claude",
        }),
        createSession({
          id: "sess_2",
          terminalId: "term-2",
          providerId: "codex",
          state: "running",
          lastActiveAt: Date.now() - 500,
          title: "Codex",
        }),
      ],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_1",
      },
      lastViewedTarget: {
        workspaceId: "ws-1",
        sessionId: "sess_1",
        updatedAt: 10,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_1");
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      expect.anything(),
      undefined
    );
  });

  it("restores a newly created mobile session after reload even when workspace uiState paneLayout is stale", async () => {
    const sessions = [
      createSession({
        id: "sess_existing",
        terminalId: "term-existing",
        providerId: "claude",
        state: "idle",
        lastActiveAt: Date.now() - 5_000,
        title: "Existing Claude",
      }),
      createSession({
        id: "sess_new_mobile",
        terminalId: "term-new-mobile",
        providerId: "codex",
        state: "idle",
        lastActiveAt: Date.now() - 500,
        title: "New Mobile Codex",
      }),
    ];
    const sendCommand = vi.fn(async (op: string, payload?: Record<string, unknown>) => {
      if (op === "session.list") {
        return sessions;
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "Alpha",
          path: "/tmp/alpha",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: payload?.uiState,
        };
      }

      return undefined;
    });

    renderMobileShell({
      initialEntry: "/workspace",
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_existing",
      },
      sendCommand,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_new_mobile");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.uiState.set",
        expect.objectContaining({
          workspaceId: "ws-1",
          uiState: expect.objectContaining({
            activeSessionId: "sess_new_mobile",
            paneLayout: expect.objectContaining({
              type: "split",
              direction: "horizontal",
              children: [
                expect.objectContaining({ sessionId: "sess_existing" }),
                expect.objectContaining({ sessionId: "sess_new_mobile" }),
              ],
            }),
          }),
        }),
        undefined
      );
    });
  });

  it("restores the saved global mobile session even when it is missing from the stale pane layout", async () => {
    const sessions = [
      createSession({
        id: "sess_existing",
        terminalId: "term-existing",
        providerId: "claude",
        state: "idle",
        lastActiveAt: Date.now() - 5_000,
        title: "Existing Claude",
      }),
      createSession({
        id: "sess_saved",
        terminalId: "term-saved",
        providerId: "codex",
        state: "running",
        lastActiveAt: Date.now() - 500,
        title: "Saved Codex",
      }),
    ];
    const sendCommand = vi.fn(async (op: string, payload?: Record<string, unknown>) => {
      if (op === "session.list") {
        return sessions;
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "Alpha",
          path: "/tmp/alpha",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: payload?.uiState,
        };
      }

      return undefined;
    });

    renderMobileShell({
      initialEntry: "/workspace",
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
        sessionId: "sess_existing",
      },
      sendCommand,
      lastViewedTarget: {
        workspaceId: "ws-1",
        sessionId: "sess_saved",
        updatedAt: 10,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_saved");
    });
  });

  it("does not clear a server-backed active mobile session before session hydration completes", async () => {
    let resolveSessions: ((value: Session[]) => void) | null = null;
    const sessionListPromise = new Promise<Session[]>((resolve) => {
      resolveSessions = resolve;
    });
    const sendCommand = vi.fn(async (op: string, payload?: Record<string, unknown>) => {
      if (op === "session.list") {
        return await sessionListPromise;
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          name: "Alpha",
          path: "/tmp/alpha",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: payload?.uiState,
        };
      }

      return undefined;
    });

    renderMobileShell({
      sessions: [],
      sendCommand,
      paneLayout: {
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-1" }, undefined);
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          activeSessionId: undefined,
        }),
      })
    );

    resolveSessions?.([
      createSession({
        id: "sess_1",
        terminalId: "term-1",
        providerId: "claude",
        state: "idle",
        title: "Claude",
      }),
      createSession({
        id: "sess_2",
        terminalId: "term-2",
        providerId: "codex",
        state: "ended",
        title: "Codex",
        endedAt: Date.now(),
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-card")).toHaveTextContent("sess_2");
    });
  });

  it("falls back to the agent empty state when no sessions are open", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.list") {
        return [];
      }

      if (op === "provider.runtimeStatus") {
        return {
          providers: {
            claude: {
              providerId: "claude",
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
      }

      return undefined;
    });

    renderMobileShell({
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
      },
      sendCommand,
    });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-agent-empty")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("agent-panes-empty-mock")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Session" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Session" }));

    expect(screen.getByRole("region", { name: "Select Provider sheet" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Claude",
        description: "Start Claude session Start new session",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Codex",
        description: "Start Codex session Start new session",
      })
    ).toBeInTheDocument();
  });

  it("renders translated mobile workspace chrome in Chinese", async () => {
    const user = userEvent.setup();

    renderMobileShell({
      locale: "zh",
      sessions: [],
      paneLayout: {
        id: "root",
        type: "leaf",
      },
    });

    expect(screen.getByRole("button", { name: "切换工作区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开 Agent 面板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件面板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开终端面板" })).toBeInTheDocument();
    expect(screen.getByText("为当前工作区启动一个新的 Agent 会话。")).toBeInTheDocument();
    expect(screen.getByText("文件和终端可继续通过底部栏访问。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换工作区" }));

    expect(screen.getByRole("complementary", { name: "工作区抽屉" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭工作区抽屉" })).toBeInTheDocument();
    expect(screen.getByText("选择工作区")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建工作区" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开文件面板" }));

    expect(screen.getByRole("region", { name: "文件面板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭当前面板" })).toBeInTheDocument();
  });

  it("applies visualViewport inset to the bottom control stack", async () => {
    installVisualViewport(560);
    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId("mobile-bottom-stack")).toHaveStyle({
        "--mobile-keyboard-inset": "240px",
      });
    });
  });

  it("switches the workspace shell into landscape compact mode on short landscape viewports", async () => {
    const restoreMatchMedia = installMatchMediaMock((query) => {
      if (query.includes("orientation: landscape")) {
        return true;
      }

      if (query.includes("max-height: 540px")) {
        return true;
      }

      return false;
    });

    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId("mobile-shell")).toHaveAttribute(
        "data-layout-mode",
        "landscape-compact"
      );
    });

    restoreMatchMedia();
  });

  it("marks the shell as reduced-motion when the browser prefers reduced motion", async () => {
    const restoreMatchMedia = installMatchMediaMock((query) => {
      if (query.includes("prefers-reduced-motion: reduce")) {
        return true;
      }

      return false;
    });

    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-motion-mode", "reduced");
    });

    restoreMatchMedia();
  });

  it("keeps the shell in default motion mode when reduced motion is not requested", async () => {
    const restoreMatchMedia = installMatchMediaMock(() => false);

    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-layout-mode", "default");
      expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-motion-mode", "default");
    });

    restoreMatchMedia();
  });

  it("opens the files sheet and navigates from file list into the editor view", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Open Files sheet" }));
    expect(screen.getByRole("region", { name: "Files sheet" })).toHaveClass(
      "mobile-sheet--fullscreen"
    );
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "mock-file-tree" }));
    expect(screen.getByTestId("mobile-code-editor")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-code-editor")).toHaveAttribute("data-chrome", "content-only");
    expect(screen.getAllByRole("button", { name: /back|返回/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Close current sheet" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save file|保存文件/i }));
    expect(mockMobileEditorHandleSave).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /back|返回/i }));
    expect(screen.getByRole("button", { name: "mock-file-tree" })).toBeInTheDocument();
  });

  it("switches to the git tab and navigates into the diff viewer", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Open Files sheet" }));
    await user.click(screen.getByRole("tab", { name: "Git" }));
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "mock-git-panel" }));

    expect(screen.getByTestId("mobile-git-diff-viewer")).toBeInTheDocument();
  });

  it("shows file actions in the tab row only on the files tab", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Open Files sheet" }));
    expect(screen.getByRole("button", { name: /^new file$|^新建文件$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh|刷新/i })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Git" }));

    expect(screen.queryByRole("button", { name: /^new file$|^新建文件$/i })).toBeNull();
  });

  it("returns to the session content when closing the diff viewer", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Open Files sheet" }));
    await user.click(screen.getByRole("tab", { name: "Git" }));
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "mock-git-panel" }));

    expect(screen.getByTestId("mobile-git-diff-viewer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => {
      expect(screen.queryByTestId("mobile-git-diff-viewer")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("mobile-session-card")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Files sheet" })).not.toBeInTheDocument();
  });

  it("does not navigate into the diff viewer when the git tab auto-hydrates preview state", async () => {
    const user = userEvent.setup();
    const { store } = renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Open Files sheet" }));
    await user.click(screen.getByRole("tab", { name: "Git" }));
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");

    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      path: "src/app.tsx",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      staged: false,
    });

    await waitFor(() => {
      expect(screen.getByText("mock-git-panel")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mobile-git-diff-viewer")).not.toBeInTheDocument();
  });

  it("opens the terminal sheet from the dock", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Open Terminal sheet" }));

    expect(screen.getByTestId("mobile-terminal-panel")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Terminal sheet" })).toHaveClass(
      "mobile-sheet--fullscreen"
    );
    expect(screen.queryByText("Phase 1")).not.toBeInTheDocument();
  });

  it("shows a supervisor badge for the active session and opens the supervisor sheet", async () => {
    const user = userEvent.setup();
    renderMobileShell({ locale: "zh" });

    const badge = await screen.findByRole("button", { name: "打开 Supervisor 面板" });
    expect(screen.getByTestId("mobile-session-card-header-accessory")).toContainElement(badge);
    expect(badge.querySelector('[data-icon-semantic="supervisor.entry"]')).toBeTruthy();

    await user.click(badge);

    expect(screen.getByRole("region", { name: "Supervisor面板" })).toBeInTheDocument();
  });

  it("keeps the supervisor entry available when the active session has not enabled supervisor yet", async () => {
    const user = userEvent.setup();
    renderMobileShell({ seedSupervisor: false, locale: "en" });

    const badge = await screen.findByRole("button", { name: "Open Supervisor sheet" });
    expect(screen.getByTestId("mobile-session-card-header-accessory")).toContainElement(badge);
    expect(badge).toHaveTextContent("Supervisor");

    await user.click(badge);

    expect(
      screen.getByRole("heading", { name: "Enable Supervisor", level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Objective" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("renders a reconnecting banner inside the mobile workspace scaffold", async () => {
    renderMobileShell({
      connectionStatus: "reconnecting",
      reconnectAttempts: 2,
    });

    expect(await screen.findByText("正在重新连接...")).toBeInTheDocument();
  });
});
