import type { Workspace } from "@coder-studio/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandPaletteOpenAtom, localeAtom } from "../../../atoms/app-ui";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import { terminalPanelVisibleAtom } from "../../workspace/atoms";
import { CommandPalette } from "./command-palette";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: "/settings" },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
    useLocation: () => routerMocks.location,
  };
});

vi.mock("../../workspace/views/shared/workspace-launch-modal", () => ({
  WorkspaceLaunchModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="workspace-launch-modal-mock">
      <button type="button" onClick={onClose}>
        close-launch-modal
      </button>
    </div>
  ),
}));

function createWorkspace(id: string, path: string): Workspace {
  return {
    id,
    path,
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

describe("CommandPalette", () => {
  beforeEach(() => {
    viewportMocks.viewport = "desktop";
    routerMocks.navigate.mockReset();
    routerMocks.location.pathname = "/settings";
  });

  it("switches workspaces by setting the active id in memory and navigating to /workspace", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
      "ws-2": createWorkspace("ws-2", "/tmp/two"),
    });
    store.set(workspaceOrderAtom, ["ws-2", "ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    fireEvent.click(screen.getByText("Workspace: two"));

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    expect(routerMocks.navigate).toHaveBeenCalledWith("/workspace");
  });

  it("renders inside shared Sheet on mobile and still filters commands", () => {
    viewportMocks.viewport = "mobile";

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    expect(document.querySelector(".mobile-sheet")).toBeTruthy();
    expect(document.querySelector(".command-palette-overlay")).toBeNull();
    expect(document.querySelector('[data-icon-semantic="nav.search"]')).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "settings" },
    });

    expect(
      screen.getByText("Settings", { selector: ".command-palette-item-label" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Workspace: one")).toBeNull();
  });

  it("hides desktop-only layout commands on mobile", () => {
    viewportMocks.viewport = "mobile";

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    expect(screen.queryAllByText("Focus Mode: Hide sidebar and bottom panel")).toHaveLength(0);
    expect(screen.queryByText("Open Focus Mode")).toBeNull();
    expect(screen.queryByText("Close Focus Mode")).toBeNull();
    expect(screen.queryByText("Toggle Sidebar")).toBeNull();
    expect(screen.queryByText("Terminal")).toBeNull();
    expect(
      screen.getByText("Settings", { selector: ".command-palette-item-label" })
    ).toBeInTheDocument();
  });

  it("renders the shared empty state shell for no command results", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "__missing-command__" },
    });

    const emptyStateTitle = screen.getByText("No results found");

    expect(emptyStateTitle.tagName).toBe("P");
    expect(emptyStateTitle.closest(".command-palette-empty")).toBeTruthy();
  });

  it("keeps desktop-only layout commands available on desktop and executes them", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(terminalPanelVisibleAtom, false);

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    expect(screen.getByText("Terminal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Terminal"));

    expect(store.get(terminalPanelVisibleAtom)).toBe(true);
  });

  it("closes the mobile palette before opening the workspace launcher", () => {
    viewportMocks.viewport = "mobile";

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    const launchDescription = screen.getByText(
      "Click the button below to open a project directory"
    );
    const launchItem = launchDescription.closest(".command-palette-item");

    expect(launchItem).toBeTruthy();
    fireEvent.click(launchItem!);

    expect(screen.getByTestId("workspace-launch-modal-mock")).toBeInTheDocument();
    expect(document.querySelector(".command-palette-overlay")).toBeNull();
    expect(document.querySelector(".mobile-sheet")).toBeNull();
    expect(store.get(commandPaletteOpenAtom)).toBe(false);
  });

  it("executes the selected command with Enter on desktop", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    const palette = document.querySelector(".command-palette");
    expect(palette).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "settings" },
    });

    fireEvent.keyDown(palette!, { key: "Enter" });

    expect(routerMocks.navigate).toHaveBeenCalledWith("/settings");
    expect(store.get(commandPaletteOpenAtom)).toBe(false);
  });
});
