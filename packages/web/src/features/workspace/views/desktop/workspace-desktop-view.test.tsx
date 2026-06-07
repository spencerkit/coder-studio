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
      "workspace.sidebar.label": "Workspace Sidebar",
      "workspace.sidebar.workspace": "Workspace",
      "workspace.sidebar.open_editors": "Open Files",
      "workspace.sidebar.agent_instructions": "Agent Instructions",
      "workspace.no_workspace": "No workspace",
      "workspace.search.empty": "Type to search across file contents",
      "workspace.search.placeholder": "Search",
      "workspace.agent_instructions.project_title": "Project Agent.md",
      "workspace.agent_instructions.token_trend.title": "Token Trend",
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

vi.mock("../../../terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
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

vi.mock("../shared/agent-instructions-token-trend", () => ({
  AgentInstructionsTokenTrend: ({ workspacePath }: { workspacePath: string }) => (
    <div data-testid="agent-token-trend" data-workspace-path={workspacePath} />
  ),
}));

function renderDesktopView(
  activeView: "explorer" | "search" | "source-control" | "agent-instructions"
) {
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, {
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

    expect(trendSection).toHaveClass("workspace-agent-token-trend-section");
    expect(screen.getByTestId("agent-token-trend")).toHaveAttribute(
      "data-workspace-path",
      "/tmp/ws-test"
    );
    expect(
      trendSection?.compareDocumentPosition(agentInstructionsSection) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(agentInstructionsSection).not.toContainElement(screen.getByTestId("agent-token-trend"));
  });
});
