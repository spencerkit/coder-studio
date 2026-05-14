import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom, pendingFocusSessionAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { sessionsAtom } from "../../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import { SessionCard } from "../views/shared/session-card";

const mockXtermHost = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="mock-xterm-host" data-readonly={String(props.readOnly)} />
));

vi.mock("../../terminal-panel/views/shared/xterm-host", () => ({
  XtermHost: (props: Record<string, unknown>) => mockXtermHost(props),
}));

function createSessionStore(
  overrides: Partial<Record<string, unknown>> = {},
  sendCommand = vi.fn().mockResolvedValue(undefined)
) {
  const store = createStore();

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
    vi.clearAllMocks();
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
        terminalId: "term-ended",
        workspaceId: "ws-123",
        readOnly: true,
        terminalKind: "agent",
      })
    );
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
    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: "term-live",
        readOnly: false,
        isActiveSession: false,
        terminalKind: "agent",
      })
    );
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

    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: "term-live",
        isActiveSession: true,
      })
    );
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

  it("renders a decorative session status strip with legacy session classes", () => {
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

    const progress = container.querySelector(".session-progress");
    const fill = container.querySelector(".session-progress-bar.session-progress-running");

    expect(progress).toHaveAttribute("aria-hidden", "true");
    expect(progress).not.toHaveAttribute("role");
    expect(progress).not.toHaveAttribute("aria-valuemin");
    expect(progress).not.toHaveAttribute("aria-valuemax");
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(fill).toHaveStyle({ "--progress-bar-width": "42%" });
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

    const header = screen.getByText("SESSION-56").closest(".session-header");
    const accessory = screen.getByRole("button", { name: "Supervisor entry" });
    const right = header?.querySelector(".session-header-right");

    expect(header).not.toBeNull();
    expect(accessory.parentElement).toHaveClass("session-header-accessory");
    expect(right).not.toBeNull();
    expect(right).toContainElement(accessory);
    expect(header?.lastElementChild).toBe(right);
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

    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: "term-live",
        readOnly: true,
      })
    );
  });

  it("hydrates supervisor state for full-capability sessions and renders the card above the terminal", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "supervisor.get") {
        return {
          supervisor: {
            id: "sup-1",
            sessionId: "sess_123456",
            workspaceId: "ws-123",
            state: "idle",
            objective: "Keep the agent on track",
            evaluatorProviderId: "claude",
            maxSupervisionCount: 0,
            completedSupervisionCount: 0,
            cycles: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        };
      }
      return undefined;
    });

    const { store } = createSessionStore({ state: "running", capability: "full" }, sendCommand);

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.get",
        { sessionId: "sess_123456" },
        undefined
      );
    });

    expect(screen.getByText("Supervisor")).toBeInTheDocument();
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

    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
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

  it("uses shared IconButton compatibility classes for header actions", () => {
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

    expect(screen.getByRole("button", { name: "Stop" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "session-action-btn"
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
