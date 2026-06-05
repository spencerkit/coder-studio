import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom, localeAtom, pendingFocusSessionAtom } from "../../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
import { sessionsAtom } from "../../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import { supervisorsAtom } from "../../supervisor/atoms";
import { taskStateAtomFamily } from "../../tasks/atoms";
import { paneLayoutAtomFamily } from "../atoms/pane-layout";
import { SessionCard } from "../views/shared/session-card";

const paneDragEnabledMock = vi.hoisted(() => ({
  value: true,
}));

vi.mock("../actions/use-pane-drag-enabled", () => ({
  usePaneDragEnabled: () => paneDragEnabledMock.value,
}));

const mockXtermHost = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="mock-xterm-host" data-readonly={String(props.readOnly)} />
));

const verifyTask: TaskDefinition = {
  id: "verify",
  workspaceId: "ws-123",
  kind: "verify",
  label: "Verify",
  command: "pnpm",
  args: ["ci:verify"],
  cwdPath: ".",
  source: "package-json",
  priority: 900,
};

const failedVerifyRun: TaskRun = {
  id: "run-verify-1",
  workspaceId: "ws-123",
  taskId: "verify",
  terminalId: "term-verify",
  status: "failed",
  command: "pnpm",
  args: ["ci:verify"],
  cwdPath: ".",
  startedAt: 100,
  finishedAt: 200,
  exitCode: 1,
};

function getLastXtermHostProps() {
  const lastCall = mockXtermHost.mock.calls[mockXtermHost.mock.calls.length - 1];
  return lastCall?.[0];
}

vi.mock("../../terminal-panel/views/shared/xterm-host", () => ({
  XtermHost: (props: Record<string, unknown>) => mockXtermHost(props),
}));

function createSessionStore(
  overrides: Partial<Record<string, unknown>> = {},
  sendCommand = vi.fn().mockResolvedValue(undefined)
) {
  const store = createStore();
  store.set(localeAtom, "en");

  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(activeWorkspaceIdAtom, "ws-123");
  store.set(workspacesLoadStateAtom, "ready");
  store.set(workspacesAtom, {
    "ws-123": {
      id: "ws-123",
      path: "/tmp/ws-123",
      targetRuntime: "native",
      openedAt: Date.now() - 10_000,
      lastActiveAt: Date.now() - 500,
      uiState: {
        leftPanelWidth: 320,
        bottomPanelHeight: 240,
        focusMode: false,
      },
    },
  });

  store.set(sessionsAtom, {
    sess_123456: {
      id: "sess_123456",
      workspaceId: "ws-123",
      terminalId: "term-ended",
      providerId: "codex",
      state: "ended",
      capability: "full",
      startedAt: Date.now() - 5_000,
      lastActiveAt: Date.now() - 1_000,
      endedAt: Date.now(),
      ...overrides,
    },
  });

  return { store, sendCommand };
}

describe("SessionCard", () => {
  beforeEach(() => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    vi.clearAllMocks();
    paneDragEnabledMock.value = true;
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders ended sessions with a read-only terminal host", () => {
    const { store } = createSessionStore();

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(mockXtermHost).toHaveBeenCalled();
    expect(mockXtermHost.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        closedSessionProviderLabel: "Codex",
        terminalId: "term-ended",
        workspaceId: "ws-123",
        readOnly: true,
        terminalKind: "agent",
        onClosedSessionClose: expect.any(Function),
        onClosedSessionContinue: expect.any(Function),
      })
    );
  });

  it("continues an ended session by relaunching the same provider in place", async () => {
    const nextSession = {
      id: "sess_654321",
      workspaceId: "ws-123",
      terminalId: "term-new",
      providerId: "codex",
      state: "starting",
      capability: "full",
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "session.create") {
        return nextSession;
      }

      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-123",
          sessionId: "sess_654321",
          updatedAt: 42,
        };
      }

      if (op === "workspace.uiState.set") {
        const { uiState } = args as {
          workspaceId: string;
          uiState: Record<string, unknown>;
        };
        return {
          id: "ws-123",
          path: "/tmp/ws-123",
          targetRuntime: "native",
          uiState,
        };
      }

      return undefined;
    });
    const { store } = createSessionStore({}, sendCommand);
    store.set(paneLayoutAtomFamily("ws-123"), {
      id: "root",
      type: "leaf",
      sessionId: "sess_123456",
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const props = getLastXtermHostProps() as {
      onClosedSessionContinue?: () => void;
    };

    act(() => {
      props.onClosedSessionContinue?.();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "session.create",
        expect.objectContaining({
          workspaceId: "ws-123",
          providerId: "codex",
          themeBackground: expect.stringMatching(/^#[0-9a-fA-F]{6,8}$/),
        }),
        undefined
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "session.remove",
        { sessionId: "sess_123456" },
        undefined
      );
    });

    expect(store.get(sessionsAtom)).toMatchObject({
      sess_654321: nextSession,
    });
    expect(store.get(paneLayoutAtomFamily("ws-123"))).toEqual({
      id: "root",
      type: "leaf",
      sessionId: "sess_654321",
    });
    expect(store.get(lastViewedTargetAtom)).toMatchObject({
      workspaceId: "ws-123",
      sessionId: "sess_654321",
    });
    expect(store.get(workspacesAtom)["ws-123"]?.uiState).toEqual(
      expect.objectContaining({
        activeSessionId: "sess_654321",
        paneLayout: {
          id: "root",
          type: "leaf",
          sessionId: "sess_654321",
        },
      })
    );
    expect(sendCommand).not.toHaveBeenCalledWith("session.close", expect.anything(), undefined);
  });

  it("renders interactive sessions without the extra command input", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "idle",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(getLastXtermHostProps()).toEqual(
      expect.objectContaining({
        terminalId: "term-live",
        readOnly: false,
        isActiveSession: false,
        terminalKind: "agent",
      })
    );
  });

  it("surfaces the latest verify result in the session card", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });
    store.set(taskStateAtomFamily("ws-123"), {
      tasks: [verifyTask],
      runs: [failedVerifyRun],
      loading: false,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByText("Last verify: Failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View output" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rerun Verify" })).toBeInTheDocument();
  });

  it("renders a pane drag handle button in the header actions on desktop", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard paneId="pane-1" sessionId="sess_123456" onPaneDragStart={vi.fn()} />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Drag pane" })).toBeInTheDocument();
  });

  it("does not render a pane drag handle button on mobile", () => {
    paneDragEnabledMock.value = false;
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard paneId="pane-1" sessionId="sess_123456" onPaneDragStart={vi.fn()} />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Drag pane" })).not.toBeInTheDocument();
  });

  it("starts pane drag only from the drag handle", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });
    const onPaneDragStart = vi.fn();

    render(
      <Provider store={store}>
        <SessionCard paneId="pane-1" sessionId="sess_123456" onPaneDragStart={onPaneDragStart} />
      </Provider>
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Drag pane" }));
    fireEvent.pointerDown(screen.getByText("SESSION-56"));

    expect(onPaneDragStart).toHaveBeenCalledTimes(1);
    expect(onPaneDragStart).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: "pane-1",
        sessionId: "sess_123456",
        providerLabel: "Codex",
      })
    );
  });

  it("does not start pane drag from the drag handle for touch pointers on desktop", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });
    const onPaneDragStart = vi.fn();

    render(
      <Provider store={store}>
        <SessionCard paneId="pane-1" sessionId="sess_123456" onPaneDragStart={onPaneDragStart} />
      </Provider>
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Drag pane" }), {
      pointerType: "touch",
    });

    expect(onPaneDragStart).not.toHaveBeenCalled();
  });

  it("passes isActiveSession to XtermHost when the workspace ui state targets this session", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    store.set(workspacesAtom, {
      "ws-123": {
        id: "ws-123",
        path: "/tmp/ws-123",
        targetRuntime: "native",
        openedAt: Date.now() - 10_000,
        lastActiveAt: Date.now() - 500,
        uiState: {
          leftPanelWidth: 320,
          bottomPanelHeight: 240,
          focusMode: false,
          activeSessionId: "sess_123456",
        },
      },
    });
    store.set(lastViewedTargetAtom, {
      workspaceId: "ws-123",
      sessionId: "sess_123456",
      updatedAt: 10,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(getLastXtermHostProps()).toEqual(
      expect.objectContaining({
        terminalId: "term-live",
        isActiveSession: true,
      })
    );
  });

  it("adds an active class when the workspace ui state targets this session", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    store.set(workspacesAtom, {
      "ws-123": {
        id: "ws-123",
        path: "/tmp/ws-123",
        targetRuntime: "native",
        openedAt: Date.now() - 10_000,
        lastActiveAt: Date.now() - 500,
        uiState: {
          leftPanelWidth: 320,
          bottomPanelHeight: 240,
          focusMode: false,
          activeSessionId: "sess_123456",
        },
      },
    });

    const { container } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(container.querySelector(".session-card")).toHaveClass("session-card--active");
  });

  it("hides header actions when showHeaderActions is false", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" showHeaderActions={false} />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("preserves the legacy session status dot classes", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    const { container } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(container.querySelector(".session-dot.session-dot-running")).not.toBeNull();
    expect(container.querySelector(".session-dot.session-dot-running")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("routes running sessions through the shared pulse dot behavior", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    const { container } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const dot = container.querySelector(".session-dot.session-dot-running");

    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/pulse/);
  });

  it("marks running session cards and headers with explicit running state classes", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    const { container } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const card = container.querySelector(".session-card");
    const header = container.querySelector(".session-card > .panel-header");

    expect(card).toHaveClass("session-card--running");
    expect(header).toHaveClass("session-header--running");
  });

  it("does not render the legacy session progress strip", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    const { container } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(container.querySelector(".session-progress")).toBeNull();
    expect(container.querySelector(".session-progress-bar")).toBeNull();
  });

  it("renders migrated provider and state tags with legacy badge compatibility classes", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByText("Codex")).toHaveClass("badge", "badge-blue", "session-provider-badge");
    expect(screen.getByText("Running")).toHaveClass("badge", "badge-green", "session-state-badge");
  });

  it("renders the session title and badges inside one header row", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "idle",
      endedAt: undefined,
    });

    const { container } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const headerRow = container.querySelector(".panel-header__title-row");
    const inlineMeta = container.querySelector(".panel-header__meta--inline");

    expect(headerRow).not.toBeNull();
    expect(headerRow).toContainElement(screen.getByText("SESSION-56"));
    expect(headerRow).toContainElement(screen.getByText("Codex"));
    expect(headerRow).toContainElement(screen.getByText("Waiting for input"));
    expect(inlineMeta).not.toBeNull();
    expect(headerRow).toContainElement(inlineMeta as HTMLElement);
  });

  it("renders a header accessory on the right side of the session header", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "idle",
      endedAt: undefined,
      capability: "limited",
    });

    render(
      <Provider store={store}>
        <SessionCard
          sessionId="sess_123456"
          showHeaderActions={false}
          showSupervisorInline={false}
          headerAccessory={(<button type="button">Supervisor entry</button>) as ReactNode}
        />
      </Provider>
    );

    const bespokeHeader = screen.getByText("SESSION-56").closest(".session-header");
    const header = screen.getByText("SESSION-56").closest(".panel-header");
    const actions = header?.querySelector(".panel-header__actions");
    const accessory = screen.getByRole("button", { name: "Supervisor entry" });
    const right = header?.querySelector(".session-header-right");

    expect(bespokeHeader).toBeNull();
    expect(header).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(accessory.parentElement).toHaveClass("session-header-accessory");
    expect(right).not.toBeNull();
    expect(right).toContainElement(accessory);
    expect(actions).toContainElement(right as HTMLElement);
    expect(header?.lastElementChild).toBe(actions);
  });

  it("forces the terminal read-only when terminalReadOnlyOverride is true", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" terminalReadOnlyOverride />
      </Provider>
    );

    expect(getLastXtermHostProps()).toEqual(
      expect.objectContaining({
        terminalId: "term-live",
        readOnly: true,
      })
    );
  });

  it("hydrates supervisor state via supervisor.get once after the session becomes connected", async () => {
    const { store, sendCommand } = createSessionStore({
      state: "running",
      capability: "full",
      endedAt: undefined,
      terminalId: "term-live",
    });
    sendCommand.mockResolvedValue({
      supervisor: {
        id: "sup-1",
        sessionId: "sess_123456",
        workspaceId: "ws-123",
        targetId: "tgt-1",
        state: "idle",
        objective: "Keep the rollout healthy",
        evaluatorProviderId: "claude",
        maxSupervisionCount: 0,
        completedSupervisionCount: 0,
        recentTargetCycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });

    const { rerender } = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(sendCommand).not.toHaveBeenCalledWith(
      "supervisor.get",
      { sessionId: "sess_123456" },
      undefined
    );

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.get",
        { sessionId: "sess_123456" },
        undefined
      );
    });

    expect(store.get(supervisorsAtom).get("sess_123456")).toMatchObject({
      id: "sup-1",
      targetId: "tgt-1",
      objective: "Keep the rollout healthy",
    });

    rerender(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      sendCommand.mock.calls.filter(([op]) => op === "supervisor.get" && Boolean(op))
    ).toHaveLength(1);
  });

  it("re-hydrates supervisor state after a reconnect cycle", async () => {
    const { store, sendCommand } = createSessionStore({
      state: "running",
      capability: "full",
      endedAt: undefined,
      terminalId: "term-live",
    });
    sendCommand.mockResolvedValue({ supervisor: null });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
    });

    act(() => {
      store.set(connectionStatusAtom, "reconnecting");
    });

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(2);
    });
  });

  it("reacts to a pending-focus request by scrolling itself into view and pulsing, then clears the marker", async () => {
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView; provide a stub before render.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
    });

    const { store } = createSessionStore({ state: "idle", endedAt: undefined });
    store.set(pendingFocusSessionAtom, "sess_123456");

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    const card = document.querySelector('[data-session-id="sess_123456"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains("session-card--focus-pulse")).toBe(true);
    // Marker should self-clear so siblings don't also fire on re-render.
    expect(store.get(pendingFocusSessionAtom)).toBeNull();
  });

  it("ignores a pending-focus request targeting a different session", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
    });

    const { store } = createSessionStore({ state: "idle", endedAt: undefined });
    store.set(pendingFocusSessionAtom, "some-other-session");

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    // Let any effects flush (none should change anything for this card).
    await act(async () => {
      await Promise.resolve();
    });

    expect(scrollSpy).not.toHaveBeenCalled();
    const card = document.querySelector('[data-session-id="sess_123456"]');
    expect(card?.classList.contains("session-card--focus-pulse")).toBe(false);
    // Untouched.
    expect(store.get(pendingFocusSessionAtom)).toBe("some-other-session");
  });

  it("shows the session title when the server has assigned one", () => {
    const { store } = createSessionStore({
      state: "running",
      endedAt: undefined,
      title: "fix bug",
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByText("fix bug")).toBeInTheDocument();
    // The SESSION-XX fallback should not also render in the header.
    expect(screen.queryByText(/^SESSION-/)).toBeNull();
  });

  it("shows the full first submitted input in a tooltip when hovering the session title", () => {
    const { store } = createSessionStore({
      state: "running",
      endedAt: undefined,
      title: "hello wor…",
      firstSubmittedUserInput: "hello world this is a test",
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const title = screen.getByText("hello wor…");

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(title);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("hello world this is a test");
    expect(title).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");
  });

  it("falls back to SESSION-XX while the session has no title yet", () => {
    const { store } = createSessionStore({
      state: "running",
      endedAt: undefined,
      // title intentionally omitted
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByText("SESSION-56")).toBeInTheDocument();
  });

  it("renders ended sessions without a start action", () => {
    const { store } = createSessionStore({
      terminalId: "term-ended",
      state: "ended",
      endedAt: Date.now(),
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(getLastXtermHostProps()).toEqual(
      expect.objectContaining({
        terminalId: "term-ended",
        readOnly: true,
      })
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("does not render supervisor chrome for ended sessions", () => {
    const { store } = createSessionStore({
      terminalId: "term-ended",
      state: "ended",
      endedAt: Date.now(),
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.queryByText("Supervisor")).not.toBeInTheDocument();
  });

  it("routes close through the explicit callback", async () => {
    const { store, sendCommand } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });
    const onClose = vi.fn();

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" onClose={onClose} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendCommand).not.toHaveBeenCalledWith(
      "session.stop",
      { sessionId: "sess_123456" },
      undefined
    );
  });

  it("does not render stop for running sessions", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("routes split buttons through explicit callbacks", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });
    const onSplitHorizontal = vi.fn();
    const onSplitVertical = vi.fn();

    render(
      <Provider store={store}>
        <SessionCard
          sessionId="sess_123456"
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Split horizontal" }));
    fireEvent.click(screen.getByRole("button", { name: "Split vertical" }));

    expect(onSplitHorizontal).toHaveBeenCalledTimes(1);
    expect(onSplitVertical).toHaveBeenCalledTimes(1);
  });

  it("uses shared IconButton compatibility classes for split and close header actions", () => {
    const { store } = createSessionStore({
      terminalId: "term-live",
      state: "running",
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Split horizontal" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "session-action-btn"
    );
    expect(screen.getByRole("button", { name: "Split vertical" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "session-action-btn"
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "session-action-btn",
      "session-action-btn-close"
    );
  });

  it("persists activeSessionId when the card is clicked", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: "ws-123",
        path: "/tmp/ws-123",
        targetRuntime: "native",
        openedAt: Date.now() - 10_000,
        lastActiveAt: Date.now(),
        uiState: {
          leftPanelWidth: 320,
          bottomPanelHeight: 240,
          focusMode: false,
          activeSessionId: "sess_123456",
        },
      },
    });
    const { store } = createSessionStore(
      {
        terminalId: "term-live",
        state: "running",
        endedAt: undefined,
      },
      sendCommand
    );

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    fireEvent.click(document.querySelector('[data-session-id="sess_123456"]')!);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.uiState.set",
        {
          workspaceId: "ws-123",
          uiState: expect.objectContaining({
            activeSessionId: "sess_123456",
          }),
        },
        undefined
      );
    });
  });

  it("persists the global last-viewed target when the session card body is clicked", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-123",
          sessionId: "sess_123456",
          updatedAt: 10,
        };
      }

      if (op === "workspace.uiState.set") {
        return {
          id: "ws-123",
          path: "/tmp/ws-123",
          targetRuntime: "native",
          openedAt: Date.now() - 10_000,
          lastActiveAt: Date.now(),
          uiState: {
            leftPanelWidth: 320,
            bottomPanelHeight: 240,
            focusMode: false,
            activeSessionId: "sess_123456",
          },
        };
      }

      return undefined;
    });
    const { store } = createSessionStore(
      {
        terminalId: "term-live",
        state: "running",
        endedAt: undefined,
      },
      sendCommand
    );

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    fireEvent.click(document.querySelector('[data-session-id="sess_123456"]')!);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        {
          workspaceId: "ws-123",
          sessionId: "sess_123456",
        },
        undefined
      );
    });
  });

  it("does not persist the global last-viewed target again when the active session card is clicked", () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const { store } = createSessionStore(
      {
        terminalId: "term-live",
        state: "running",
        endedAt: undefined,
      },
      sendCommand
    );

    store.set(workspacesAtom, {
      "ws-123": {
        id: "ws-123",
        path: "/tmp/ws-123",
        targetRuntime: "native",
        openedAt: Date.now() - 10_000,
        lastActiveAt: Date.now(),
        uiState: {
          leftPanelWidth: 320,
          bottomPanelHeight: 240,
          focusMode: false,
          activeSessionId: "sess_123456",
        },
      },
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    fireEvent.click(document.querySelector('[data-session-id="sess_123456"]')!);

    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      expect.anything(),
      undefined
    );
  });

  it("does not persist activeSessionId when header action buttons are clicked", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    const { store } = createSessionStore(
      {
        terminalId: "term-live",
        state: "running",
        endedAt: undefined,
      },
      sendCommand
    );

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" onClose={onClose} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendCommand.mock.calls.some(([command]) => command === "workspace.uiState.set")).toBe(
      false
    );
  });
});
