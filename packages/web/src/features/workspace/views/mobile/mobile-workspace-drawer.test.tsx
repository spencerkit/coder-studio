import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileWorkspaceDrawer } from "./mobile-workspace-drawer";

const navigateMock = vi.fn();
const closeWorkspaceMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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
      case "mobile.workspace_drawer.switch_to_workspace":
        return `Switch to ${params?.name ?? ""}`;
      case "mobile.workspace_drawer.close_workspace":
        return `Close ${params?.name ?? ""}`;
      case "action.close":
        return "Close";
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
          isOpen
          onClose={onClose}
          onOpenWorkspaceLauncher={vi.fn()}
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
      "btn-lg",
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
          isOpen
          onClose={onClose}
          onOpenWorkspaceLauncher={vi.fn()}
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

    await user.click(dismissButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks the active workspace with a clear current state", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MobileWorkspaceDrawer
          activeWorkspaceId="ws-1"
          isOpen
          onClose={vi.fn()}
          onOpenWorkspaceLauncher={vi.fn()}
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

    expect(screen.getByRole("button", { name: "Switch to demo" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to other" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
