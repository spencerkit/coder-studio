import type { Workspace } from "@coder-studio/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import {
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { sidebarCollapsedAtom, terminalPanelVisibleAtom } from "../workspace/atoms";
import { TopBar } from "./index";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const viewportMocks = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});

vi.mock("../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => viewportMocks.value,
}));

vi.mock("./components/connection-status", () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}));

vi.mock("../workspace/views/shared/workspace-launch-modal", () => ({
  WorkspaceLaunchModal: () => null,
}));

vi.mock("./components/tab", () => ({
  WorkspaceTab: ({ workspace, isActive }: { workspace: Workspace; isActive: boolean }) => (
    <div data-testid="workspace-tab" data-active={String(isActive)}>
      {workspace.id}
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

describe("TopBar", () => {
  beforeEach(() => {
    routerMocks.navigate.mockReset();
    viewportMocks.value = "desktop";
  });

  it("renders tabs in workspace order and highlights the resolved active workspace", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesAtom, {
      "ws-a": createWorkspace("ws-a", "/tmp/a"),
      "ws-b": createWorkspace("ws-b", "/tmp/b"),
    });
    store.set(workspaceOrderAtom, ["ws-b", "ws-a"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    const tabs = screen.getAllByTestId("workspace-tab");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["ws-b", "ws-a"]);
    expect(tabs[0]?.getAttribute("data-active")).toBe("true");
    expect(tabs[1]?.getAttribute("data-active")).toBe("false");
    expect(screen.getByRole("tablist", { name: "Workspace tabs" })).toBeInTheDocument();
  });

  it("uses translated labels when locale is set to en", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    expect(screen.getByText("No workspace open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quick Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("shows shared tooltip content for bounded topbar actions on desktop without changing button names", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    const addWorkspace = screen.getByRole("button", { name: "New workspace" });
    const settings = screen.getByRole("button", { name: "Settings" });

    expect(addWorkspace).not.toHaveAttribute("title");
    expect(settings).not.toHaveAttribute("title");

    fireEvent.mouseEnter(addWorkspace);
    expect(screen.getByRole("tooltip")).toHaveTextContent("New workspace");
    fireEvent.mouseLeave(addWorkspace);

    fireEvent.focus(settings);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Settings");
  });

  it("does not render tooltip overlays for bounded topbar actions on mobile/coarse viewports", () => {
    viewportMocks.value = "mobile";
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    const addWorkspace = screen.getByRole("button", { name: "New workspace" });
    fireEvent.mouseEnter(addWorkspace);
    fireEvent.focus(addWorkspace);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("marks terminal and files toggles with explicit active and muted states", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");
    store.set(terminalPanelVisibleAtom, false);
    store.set(sidebarCollapsedAtom, false);

    const { rerender } = render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    const terminalButton = screen.getByRole("button", { name: "Show Terminal" });
    const filesButton = screen.getByRole("button", { name: "Hide Files" });

    expect(terminalButton).toHaveClass("topbar-btn--muted");
    expect(terminalButton).not.toHaveClass("topbar-btn--active");
    expect(filesButton).toHaveClass("topbar-btn--active");
    expect(filesButton).not.toHaveClass("topbar-btn--muted");

    store.set(terminalPanelVisibleAtom, true);
    store.set(sidebarCollapsedAtom, true);

    rerender(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Hide Terminal" })).toHaveClass("topbar-btn--active");
    expect(screen.getByRole("button", { name: "Show Files" })).toHaveClass("topbar-btn--muted");
  });

  it("preserves shared IconButton compatibility classes on bounded icon-only topbar actions", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");
    store.set(terminalPanelVisibleAtom, false);
    store.set(sidebarCollapsedAtom, false);

    render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "New workspace" })).toHaveClass("btn", "btn-ghost");
    expect(screen.getByRole("button", { name: "Show Terminal" })).toHaveClass("btn", "btn-ghost");
    expect(screen.getByRole("button", { name: "Hide Files" })).toHaveClass("btn", "btn-ghost");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveClass("btn", "btn-ghost");
    expect(screen.getByRole("button", { name: "Quick Actions" })).not.toHaveClass("btn");
  });

  it("renders the fullscreen toggle immediately to the right of settings when supported", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <TopBar
          fullscreenController={{
            supported: true,
            isFullscreen: false,
            enterFullscreen: vi.fn(),
            exitFullscreen: vi.fn(),
            toggleFullscreen: vi.fn(),
          }}
        />
      </Provider>
    );

    const settingsButton = screen.getByTestId("settings-open");
    const fullscreenButton = screen.getByRole("button", { name: "Enter Fullscreen" });

    expect(settingsButton.nextElementSibling).toBe(fullscreenButton);
  });

  it("keeps the fullscreen toggle visible when the controller reports unsupported", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <TopBar
          fullscreenController={{
            supported: false,
            isFullscreen: false,
            enterFullscreen: vi.fn(),
            exitFullscreen: vi.fn(),
            toggleFullscreen: vi.fn(),
          }}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Enter Fullscreen" })).toBeInTheDocument();
  });
});
