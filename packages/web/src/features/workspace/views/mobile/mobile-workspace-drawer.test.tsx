import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom, localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { MobileWorkspaceDrawer } from "./mobile-workspace-drawer";

const closeWorkspaceMock = vi.fn();

vi.mock("../../actions/use-workspace-close-action", () => ({
  useWorkspaceCloseAction: () => closeWorkspaceMock,
}));

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    switch (key) {
      case "mobile.workspace_drawer.close":
        return "Close workspace drawer";
      case "mobile.workspace_drawer.aria_label":
        return "Workspace drawer";
      case "label.workspace":
        return "Workspace";
      case "mobile.workspace_drawer.select_title":
        return "Select Workspace";
      case "mobile.workspace_drawer.expand_workspace":
        return `Expand ${params?.name ?? ""}`;
      case "mobile.workspace_drawer.collapse_workspace":
        return `Collapse ${params?.name ?? ""}`;
      case "mobile.workspace_drawer.switch_to_workspace":
        return `Switch to ${params?.name ?? ""}`;
      case "mobile.workspace_drawer.close_workspace":
        return `Close ${params?.name ?? ""}`;
      case "mobile.workspace_drawer.current_workspace":
        return `Translated current workspace ${params?.name ?? ""}`;
      case "mobile.workspace_drawer.create_session_in_workspace":
        return `Translated create session in ${params?.name ?? ""}`;
      case "worktree.current":
        return "Current";
      case "action.close":
        return "Close";
      case "action.create_session":
        return "Create session";
      case "mobile.agent.switch_to_agent":
        return `Switch to agent ${params?.name ?? ""}`;
      case "mobile.agent.empty":
        return "No active sessions";
      case "mobile.agent.close_current_session":
        return "Close Current Session";
      case "status.starting":
        return "Starting";
      case "status.running":
        return "Running";
      case "status.idle":
        return "Idle";
      case "status.ended":
        return "Ended";
      case "tooltip.new_workspace":
        return "New Workspace";
      default:
        return key;
    }
  },
}));

describe("MobileWorkspaceDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeWorkspaceMock.mockResolvedValue(true);
  });

  it("uses shared IconButton compatibility classes for workspace close actions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const store = createStore();

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{}}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ]}
        />
      </Provider>
    );

    const closeButton = screen.getByRole("button", { name: "Close demo" });

    expect(closeButton).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "mobile-workspace-drawer__item-close"
    );

    await user.click(closeButton);

    expect(closeWorkspaceMock).toHaveBeenCalledWith("ws-1", { navigateHomeWhenEmpty: true });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("renders a visible dismiss control for closing the drawer", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const store = createStore();

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{}}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ]}
        />
      </Provider>
    );

    const dismissButton = screen.getByRole("button", { name: "Close" });

    expect(dismissButton).toHaveClass("mobile-workspace-drawer__dismiss");
    expect(screen.queryByText("Select Workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Workspace")).toHaveClass("mobile-workspace-drawer__kicker");

    await user.click(dismissButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks the active workspace with a clear current state", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={vi.fn()}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{}}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
            {
              id: "ws-2",
              path: "/tmp/other",
              targetRuntime: "native",
              openedAt: 2,
              lastActiveAt: 2,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ]}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Collapse demo" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("button", { name: "Expand other" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("toggles a non-active workspace subtree without collapsing other expanded workspaces", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(lastViewedTargetAtom, {
      workspaceId: "ws-1",
      updatedAt: 10,
    });

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
            ],
            "ws-2": [
              {
                id: "sess-9",
                workspaceId: "ws-2",
                providerId: "gemini",
                title: "Gemini Sandbox",
                state: "running",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
            {
              id: "ws-2",
              path: "/tmp/other",
              targetRuntime: "native",
              openedAt: 2,
              lastActiveAt: 2,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ]}
        />
      </Provider>
    );

    expect(screen.getByText("Claude Repair CI")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand other" }));

    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      expect.anything(),
      undefined
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Collapse demo" })).toBeInTheDocument();
    expect(screen.getByText("Claude Repair CI")).toBeInTheDocument();
    expect(screen.getByText("Gemini Sandbox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse other" }));

    expect(screen.getByText("Claude Repair CI")).toBeInTheDocument();
    expect(screen.queryByText("Gemini Sandbox")).not.toBeInTheDocument();
  });

  it("does not persist again when the mobile drawer clicks the active workspace", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{}}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ]}
        />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Collapse demo" }));

    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      expect.anything(),
      undefined
    );
  });

  it("renders the active workspace as expanded by default and shows its agent rows with provider state meta", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId="sess-2"
          isOpen
          onClose={vi.fn()}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
              {
                id: "sess-2",
                workspaceId: "ws-1",
                providerId: "codex",
                title: "Codex Mobile Layout",
                state: "idle",
              },
            ],
            "ws-2": [
              {
                id: "sess-9",
                workspaceId: "ws-2",
                providerId: "gemini",
                title: "Gemini Sandbox",
                state: "running",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
            {
              id: "ws-2",
              path: "/tmp/other",
              targetRuntime: "native",
              openedAt: 2,
              lastActiveAt: 2,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    expect(screen.getByText("Codex Mobile Layout")).toBeInTheDocument();
    expect(screen.getByText("CODEX · Idle")).toBeInTheDocument();
    expect(screen.queryByText("Gemini Sandbox")).not.toBeInTheDocument();
  });

  it("switches workspace only when a session row is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelectSession = vi.fn();
    const sendCommand = vi.fn().mockResolvedValue({
      workspaceId: "ws-2",
      sessionId: "sess-9",
      updatedAt: 10,
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(activeWorkspaceIdAtom, "ws-1");

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId="sess-1"
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={onSelectSession}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
              {
                id: "sess-2",
                workspaceId: "ws-1",
                providerId: "codex",
                title: "Codex Mobile Layout",
                state: "idle",
              },
            ],
            "ws-2": [
              {
                id: "sess-9",
                workspaceId: "ws-2",
                providerId: "gemini",
                title: "Gemini Sandbox",
                state: "running",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
            {
              id: "ws-2",
              path: "/tmp/other",
              targetRuntime: "native",
              openedAt: 2,
              lastActiveAt: 2,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Expand other" }));
    await user.click(screen.getByRole("button", { name: "Switch to agent Gemini Sandbox" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-2", sessionId: "sess-9" },
        undefined
      );
    });
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles the active workspace subtree when its header is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Provider store={createStore()}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    expect(screen.getByText("Claude Repair CI")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse demo" }));

    expect(screen.queryByText("Claude Repair CI")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Expand demo" }));

    expect(screen.getByText("Claude Repair CI")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the create-session button beside the workspace close button for the active workspace", async () => {
    const user = userEvent.setup();
    const onCreateSession = vi.fn();

    render(
      <Provider store={createStore()}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={vi.fn()}
          onCreateSession={onCreateSession}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
              {
                id: "sess-2",
                workspaceId: "ws-1",
                providerId: "codex",
                title: "Codex Mobile Layout",
                state: "idle",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    const activeWorkspaceItem = screen
      .getByRole("button", { name: "Collapse demo" })
      .closest(".mobile-workspace-drawer__item");

    expect(activeWorkspaceItem).not.toBeNull();
    expect(
      within(activeWorkspaceItem as HTMLElement).getByRole("button", {
        name: "Translated create session in demo",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to agent Claude Repair CI" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to agent Codex Mobile Layout" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close Current Session" })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Translated create session in demo" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("does not render a create-session button for a non-active workspace", async () => {
    const user = userEvent.setup();

    render(
      <Provider store={createStore()}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={vi.fn()}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [],
            "ws-2": [
              {
                id: "sess-9",
                workspaceId: "ws-2",
                providerId: "gemini",
                title: "Gemini Sandbox",
                state: "running",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
            {
              id: "ws-2",
              path: "/tmp/other",
              targetRuntime: "native",
              openedAt: 2,
              lastActiveAt: 2,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Expand other" }));

    expect(
      screen.queryByRole("button", { name: "Translated create session in other" })
    ).not.toBeInTheDocument();
  });

  it("renders an empty-state action for an expanded workspace with no sessions and switches on click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockResolvedValue({
      workspaceId: "ws-2",
      updatedAt: 10,
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(activeWorkspaceIdAtom, "ws-1");

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
            ],
            "ws-2": [],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
            {
              id: "ws-2",
              path: "/tmp/other",
              targetRuntime: "native",
              openedAt: 2,
              lastActiveAt: 2,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Expand other" }));

    expect(screen.getByText("No active sessions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to other" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-2", sessionId: undefined },
        undefined
      );
    });
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the empty-state action for the active workspace without switching again", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={onClose}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{ "ws-1": [] }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    expect(screen.getByText("No active sessions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to demo" }));

    expect(sendCommand).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes a session from the active workspace subtree and dismisses the drawer", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCloseSession = vi.fn().mockResolvedValue(undefined);

    render(
      <Provider store={createStore()}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId="sess-2"
          isOpen
          onClose={onClose}
          onCloseSession={onCloseSession}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{
            "ws-1": [
              {
                id: "sess-1",
                workspaceId: "ws-1",
                providerId: "claude",
                title: "Claude Repair CI",
                state: "running",
              },
              {
                id: "sess-2",
                workspaceId: "ws-1",
                providerId: "codex",
                title: "Codex Mobile Layout",
                state: "idle",
              },
            ],
          }}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
            },
          ]}
        />
      </Provider>
    );

    const activeRow = screen
      .getByRole("button", { name: "Switch to agent Codex Mobile Layout" })
      .closest(".mobile-workspace-drawer__child-session-row");

    expect(activeRow).not.toBeNull();

    await user.click(
      within(activeRow as HTMLElement).getByRole("button", { name: "Close Current Session" })
    );

    expect(onCloseSession).toHaveBeenCalledWith("sess-2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the footer launch action with the new workspace semantic icon", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          activeSessionId={null}
          isOpen
          onClose={vi.fn()}
          onCreateSession={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
          onSelectSession={vi.fn()}
          sessionsByWorkspaceId={{}}
          workspaces={[
            {
              id: "ws-1",
              path: "/tmp/demo",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ]}
        />
      </Provider>
    );

    const footerButton = screen.getByRole("button", { name: "New Workspace" });
    expect(footerButton.querySelector('[data-icon-semantic="nav.newWorkspace"]')).toBeTruthy();
  });
});
