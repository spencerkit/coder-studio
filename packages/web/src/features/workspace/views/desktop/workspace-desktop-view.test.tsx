// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../../test-utils/workspace-state";
import { desktopSidebarViewAtomFamily } from "../../atoms/layout";
import { WorkspaceDesktopView } from "./workspace-desktop-view";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      "workspace.sidebar.explorer": "Explorer",
      "workspace.sidebar.search": "Search",
      "workspace.sidebar.source_control": "Source Control",
      "workspace.sidebar.extensions": "Extensions",
      "workspace.sidebar.label": "Workspace Sidebar",
      "workspace.sidebar.workspace": "Workspace",
      "workspace.sidebar.open_editors": "Open Files",
      "workspace.sidebar.agent_instructions": "Agent Instructions",
      "workspace.no_workspace": "No workspace",
      "workspace.search.empty": "Type to search across file contents",
      "workspace.search.placeholder": "Search",
      "workspace.agent_instructions.project_title": "Project Agent.md",
      "workspace.agent_instructions.token_trend.title": "Token Trend",
      "workspace.extensions.title": "Extensions",
      "workspace.extensions.empty_title": "No extension state",
      "workspace.extensions.empty_body": "Status, progress, logs, and quick actions appear here.",
      "workspace.extensions.status_title": "Status",
      "workspace.extensions.progress_title": "Progress",
      "workspace.extensions.logs_title": "Logs",
      "workspace.extensions.quick_actions_title": "Quick Actions",
      "workspace.extensions.progress_value": "{{value}}/{{max}}",
      "workspace.extensions.action_failed": "Quick action failed",
      "common.loading": "Loading",
      "topbar.current_project": "Current Project",
    };

    return translations[key] ?? key;
  },
}));

vi.mock("../../../shared/components/branch-quick-pick", () => ({
  BranchQuickPick: () => null,
}));

vi.mock("../../../shared/components/mobile-page-header", () => ({
  MobilePageHeader: () => null,
}));

vi.mock("../../../shared/components/page-header", () => ({
  PageHeader: () => null,
}));

vi.mock("../../../agent-panes", () => ({
  AgentPanes: () => <div data-testid="agent-panes" />,
}));

vi.mock("../../../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: () => <div data-testid="code-editor-host" />,
}));

vi.mock("../shared/workspace-bottom-panel", () => ({
  WorkspaceBottomPanel: () => <div data-testid="workspace-bottom-panel">Terminal Tasks</div>,
}));

vi.mock("../../../topbar", () => ({
  TopBar: () => <div data-testid="top-bar" />,
}));

vi.mock("../../actions/use-workspace-fullscreen", () => ({
  useWorkspaceFullscreen: () => ({
    isSupported: false,
    isFullscreen: false,
    enter: vi.fn(),
    exit: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock("../../actions/use-workspace-navigation-shortcuts", () => ({
  useWorkspaceNavigationShortcuts: () => undefined,
}));

vi.mock("../shared/workspace-status-bar", () => ({
  WorkspaceStatusBar: () => <div data-testid="workspace-status-bar" />,
}));

vi.mock("../shared/git-panel", () => ({
  GitPanel: () => <div>Source Control body</div>,
}));

vi.mock("../shared/agent-instructions-section", () => ({
  AgentInstructionsSection: ({ workspaceId }: { workspaceId: string }) => (
    <section
      className="workspace-sidebar-section workspace-agent-instructions"
      data-testid="agent-instructions-section"
      data-workspace-id={workspaceId}
    >
      <h2 className="workspace-sidebar-section__title">Project Agent.md</h2>
    </section>
  ),
}));

vi.mock("../shared/agent-token-trend-section", () => ({
  AgentTokenTrendSection: ({ workspacePath }: { workspacePath: string }) => (
    <section className="workspace-sidebar-section workspace-agent-token-trend-section">
      <h2 className="workspace-sidebar-section__title">Token Trend</h2>
      <div data-testid="agent-token-trend" data-workspace-path={workspacePath} />
    </section>
  ),
}));

vi.mock("../shared/workspace-extension-state-panel", () => ({
  WorkspaceExtensionStatePanel: () => (
    <div>
      <h2>Extensions</h2>
      <p>No extension state</p>
    </div>
  ),
}));

function renderDesktopView(
  activeView: "explorer" | "search" | "source-control" | "agent-instructions" | "extensions"
) {
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, {
    subscribe: vi.fn(() => vi.fn()),
    sendCommand: vi.fn().mockImplementation(async (op: string) => {
      if (op === "session.list") {
        return [];
      }

      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return null;
    }),
  } as never);
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/tmp/ws-test",
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
  store.set(activeWorkspaceIdAtom, "ws-test");
  store.set(desktopSidebarViewAtomFamily("ws-test"), activeView);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkspaceDesktopView />
      </MemoryRouter>
    </Provider>
  );
}

function renderWorkspaceDesktopView() {
  renderDesktopView("explorer");
}

describe("WorkspaceDesktopView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not duplicate runtime panel titles for search and source control hosts", () => {
    renderDesktopView("search");

    expect(screen.getByRole("navigation", { name: "Workspace Sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByText("Search", { selector: ".panel-header" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Source Control" }));

    expect(screen.getByText("Source Control body")).toBeInTheDocument();
    expect(screen.queryByText("Source Control", { selector: ".panel-header" })).toBeNull();
  });

  it("renders token trend as a separate section above AGENT.MD", () => {
    renderDesktopView("agent-instructions");

    const trendHeading = screen.getByRole("heading", { level: 2, name: "Token Trend" });
    const trendSection = trendHeading.closest(".workspace-sidebar-section");
    const agentInstructionsSection = screen.getByTestId("agent-instructions-section");

    if (!trendSection) {
      throw new Error("Expected token trend section to render");
    }
    expect(trendSection).toHaveClass("workspace-agent-token-trend-section");
    expect(screen.getByTestId("agent-token-trend")).toHaveAttribute(
      "data-workspace-path",
      "/tmp/ws-test"
    );
    expect(
      trendSection.compareDocumentPosition(agentInstructionsSection) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(agentInstructionsSection).not.toContainElement(screen.getByTestId("agent-token-trend"));
  });

  it("renders the shared workspace bottom panel on desktop", () => {
    renderWorkspaceDesktopView();

    expect(screen.getByTestId("workspace-bottom-panel")).toHaveTextContent("Terminal Tasks");
  });

  it("opens the extension-state sidebar panel from the activity bar", () => {
    renderDesktopView("explorer");

    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));

    expect(screen.getByRole("heading", { level: 2, name: "Extensions" })).toBeInTheDocument();
    expect(screen.getByText("No extension state")).toBeInTheDocument();
  });
});
