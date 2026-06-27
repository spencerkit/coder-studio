// @vitest-environment jsdom

import { Topics } from "@coder-studio/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../../../atoms/connection";
import { activeWorkspaceIdAtom, workspacesAtom } from "../../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../../test-utils/workspace-state";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  editorViewVisibleAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { type DesktopSidebarView, desktopSidebarViewAtomFamily } from "../../atoms/layout";
import { WorkspaceDesktopView } from "./workspace-desktop-view";

let lastWsSubscribeSpy: ReturnType<typeof vi.fn> | null = null;

function browserTab(id: string, url: string | null) {
  return {
    kind: "browser" as const,
    id,
    url,
    devicePreset: "desktop" as const,
    viewportWidth: null,
    viewportHeight: null,
    orientation: "portrait" as const,
    userAgentMode: "desktop" as const,
  };
}

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
      "code_editor.open_editor_view": "Open editor view",
      "code_editor.pin_editor_view": "Pin editor view",
      "code_editor.unpin_editor_view": "Unpin editor view",
      "code_editor.move_floating_editor": "Move floating editor",
      "code_editor.resize_floating_editor": "Resize floating editor",
      "code_editor.resize_floating_editor_bottom_left": "Resize floating editor from bottom-left",
      "code_editor.resize_floating_editor_bottom_right": "Resize floating editor from bottom-right",
      "code_editor.resize_floating_editor_top_left": "Resize floating editor from top-left",
      "code_editor.resize_floating_editor_top_right": "Resize floating editor from top-right",
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
  CodeEditorHost: ({
    editorPinned,
    onBeginFloatingEditorMove,
    onToggleEditorPinned,
  }: {
    editorPinned?: boolean;
    onBeginFloatingEditorMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onToggleEditorPinned?: (pinned: boolean) => void;
  }) => (
    <div data-testid="code-editor-host" data-editor-pinned={String(Boolean(editorPinned))}>
      {!editorPinned && onBeginFloatingEditorMove ? (
        <button
          type="button"
          aria-label="Move floating editor"
          onPointerDown={onBeginFloatingEditorMove}
        >
          Move floating editor
        </button>
      ) : null}
      {onToggleEditorPinned ? (
        <button
          type="button"
          aria-label={editorPinned ? "Unpin editor view" : "Pin editor view"}
          onClick={() => onToggleEditorPinned(!editorPinned)}
        >
          {editorPinned ? "Unpin editor view" : "Pin editor view"}
        </button>
      ) : null}
    </div>
  ),
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
  AgentTokenTrendSection: ({
    workspaceId,
    workspacePath,
  }: {
    workspaceId: string;
    workspacePath: string;
  }) => (
    <section
      className="workspace-sidebar-section workspace-agent-token-trend-section"
      data-workspace-id={workspaceId}
    >
      <h2 className="workspace-sidebar-section__title">Token Trend</h2>
      <div data-testid="agent-token-trend" data-workspace-path={workspacePath} />
    </section>
  ),
}));

function renderDesktopView(activeView: DesktopSidebarView) {
  const store = createStore();
  const subscribe = vi.fn(() => vi.fn());
  lastWsSubscribeSpy = subscribe;
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, {
    subscribe,
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

  return store;
}

function renderWorkspaceDesktopView() {
  renderDesktopView("explorer");
}

describe("WorkspaceDesktopView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    lastWsSubscribeSpy = null;
  });

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

  it("subscribes to workspace UI actions for the active workspace", () => {
    renderDesktopView("explorer");

    expect(lastWsSubscribeSpy).toHaveBeenCalledWith(
      [Topics.workspaceUiAction("ws-test")],
      expect.any(Function)
    );
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

  it("does not expose the dev browser from the activity bar", () => {
    renderDesktopView("explorer");

    expect(screen.queryByRole("button", { name: "Browser" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("dev-browser-surface")).not.toBeInTheDocument();
  });

  it("animates the floating editor restore icon back into the editor overlay", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx", "src/other.ts"]);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "changed",
          savedContent: "saved",
          baseHash: "hash-app",
          isDirty: true,
        },
        "src/other.ts": {
          kind: "text",
          path: "src/other.ts",
          content: "other",
          savedContent: "other",
          baseHash: "hash-other",
          isDirty: false,
        },
      });
    });

    const restoreButton = screen.getByRole("button", { name: "Open editor view" });

    expect(screen.queryByTestId("code-editor-host")).toBeNull();
    expect(restoreButton).toHaveClass("workspace-editor-restore");
    expect(restoreButton.closest(".workspace-main-stage")).toBeTruthy();
    expect(restoreButton.querySelector(".workspace-editor-restore__count")).toHaveTextContent("2");

    fireEvent.click(restoreButton);

    expect(restoreButton).toHaveClass("workspace-editor-restore--restoring");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(screen.getByTestId("code-editor-host")).toBeInTheDocument();
    expect(
      screen.getByTestId("code-editor-host").closest(".workspace-main-stage__editor-overlay")
    ).toHaveClass("workspace-main-stage__editor-overlay--opening");
  });

  it("shows the global editor restore icon even when no editor files are open", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(openEditorPathsAtomFamily("ws-test"), []);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/panel-only.ts": {
          kind: "text",
          path: "src/panel-only.ts",
          content: "panel",
          savedContent: "panel",
          baseHash: "hash-panel",
          isDirty: false,
        },
      });
    });

    const restoreButton = screen.getByRole("button", { name: "Open editor view" });

    expect(restoreButton).toBeInTheDocument();
    expect(restoreButton.querySelector(".workspace-editor-restore__count")).toHaveTextContent("0");
  });

  it("opens an empty editor overlay when the restore icon is clicked without any open editor files", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(openEditorPathsAtomFamily("ws-test"), []);
      store.set(openFilesAtomFamily("ws-test"), {});
      store.set(activeFilePathAtomFamily("ws-test"), null);
    });

    const restoreButton = screen.getByRole("button", { name: "Open editor view" });

    fireEvent.click(restoreButton);

    expect(screen.getByTestId("code-editor-host")).toBeInTheDocument();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("shows the restore icon instead of the editor overlay when a browser tab exists but the editor view is hidden", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx"]);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "app",
          savedContent: "app",
          baseHash: "hash-app",
          isDirty: false,
        },
      });
      store.set(activeEditorTabAtomFamily("ws-test"), {
        kind: "browser",
        id: "browser-1",
        url: "http://127.0.0.1:5173/",
      });
      store.set(editorViewVisibleAtomFamily("ws-test"), false);
      store.set(activeFilePathAtomFamily("ws-test"), null);
    });

    expect(screen.getByRole("button", { name: "Open editor view" })).toBeInTheDocument();
    expect(screen.queryByTestId("code-editor-host")).toBeNull();
    expect(screen.getByTestId("agent-panes").closest(".agent-panes")).not.toHaveAttribute(
      "aria-hidden"
    );
  });

  it("restores the desktop editor as floating after refresh when persisted as unpinned with an active browser tab", () => {
    const store = renderDesktopView("explorer");
    const persistedBrowserTab = browserTab("browser-1", "http://127.0.0.1:5173/");

    act(() => {
      const currentWorkspaces = store.get(workspacesAtom);
      const currentWorkspace = currentWorkspaces["ws-test"];
      if (!currentWorkspace) {
        throw new Error("Expected test workspace to exist");
      }

      store.set(workspacesAtom, {
        ...currentWorkspaces,
        "ws-test": {
          ...currentWorkspace,
          uiState: {
            ...currentWorkspace.uiState,
            editorPinned: false,
          } as never,
        },
      });
      store.set(editorViewVisibleAtomFamily("ws-test"), true);
      store.set(openEditorTabsAtomFamily("ws-test"), [persistedBrowserTab]);
      store.set(activeEditorTabAtomFamily("ws-test"), persistedBrowserTab);
      store.set(activeFilePathAtomFamily("ws-test"), null);
    });

    const editorHost = screen.getByTestId("code-editor-host");
    const overlay = editorHost.closest(".workspace-main-stage__editor-overlay");
    const agentPanes = screen.getByTestId("agent-panes").closest(".agent-panes");

    expect(editorHost).toHaveAttribute("data-editor-pinned", "false");
    expect(overlay).toHaveClass("workspace-main-stage__editor-overlay--floating");
    expect(agentPanes).not.toHaveAttribute("aria-hidden");
  });

  it("toggles the desktop editor between pinned and floating overlay modes", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
      store.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx"]);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "app",
          savedContent: "app",
          baseHash: "hash-app",
          isDirty: false,
        },
      });
    });

    const editorHost = screen.getByTestId("code-editor-host");
    const overlay = editorHost.closest(".workspace-main-stage__editor-overlay");
    const agentPanes = screen.getByTestId("agent-panes").closest(".agent-panes");

    expect(editorHost).toHaveAttribute("data-editor-pinned", "true");
    expect(overlay).toHaveClass("workspace-main-stage__editor-overlay--pinned");
    expect(agentPanes).toHaveAttribute("aria-hidden", "true");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Unpin editor view" }));
    });

    expect(screen.getByTestId("code-editor-host")).toHaveAttribute("data-editor-pinned", "false");
    expect(
      screen.getByTestId("code-editor-host").closest(".workspace-main-stage__editor-overlay")
    ).toHaveClass("workspace-main-stage__editor-overlay--floating");
    expect(agentPanes).not.toHaveAttribute("aria-hidden");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Pin editor view" }));
    });

    expect(screen.getByTestId("code-editor-host")).toHaveAttribute("data-editor-pinned", "true");
    expect(
      screen.getByTestId("code-editor-host").closest(".workspace-main-stage__editor-overlay")
    ).toHaveClass("workspace-main-stage__editor-overlay--pinned");
    expect(agentPanes).toHaveAttribute("aria-hidden", "true");
  });

  it("lets the unpinned desktop editor drag freely across the page", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
      store.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx"]);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "app",
          savedContent: "app",
          baseHash: "hash-app",
          isDirty: false,
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Unpin editor view" }));

    const page = document.querySelector(".workspace-page") as HTMLElement;
    const overlay = screen
      .getByTestId("code-editor-host")
      .closest(".workspace-main-stage__editor-overlay") as HTMLElement;
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        bottom: 760,
        height: 720,
        left: 0,
        right: 1200,
        top: 40,
        width: 1200,
        x: 0,
        y: 40,
        toJSON: () => undefined,
      }),
    });
    Object.defineProperty(overlay, "getBoundingClientRect", {
      value: () => ({
        bottom: 644,
        height: 560,
        left: 424,
        right: 1184,
        top: 84,
        width: 760,
        x: 424,
        y: 84,
        toJSON: () => undefined,
      }),
    });

    const moveHandle = within(screen.getByTestId("code-editor-host")).getByRole("button", {
      name: "Move floating editor",
    });
    fireEvent.pointerDown(moveHandle, { button: 0, clientX: 600, clientY: 24, pointerId: 2 });

    expect(document.body).toHaveClass("is-moving-floating-editor");

    fireEvent.pointerMove(window, { clientX: 520, clientY: 86, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 520, clientY: 86, pointerId: 2 });

    expect(overlay).toHaveStyle({
      height: "560px",
      left: "344px",
      top: "146px",
      width: "760px",
    });
    expect(document.body).not.toHaveClass("is-moving-floating-editor");
  });

  it.each([
    {
      name: "top-left",
      label: "Resize floating editor from top-left",
      pointerStart: { x: 224, y: 116 },
      pointerMove: { x: 124, y: 66 },
      expected: { height: "470px", left: "124px", top: "66px", width: "700px" },
    },
    {
      name: "top-right",
      label: "Resize floating editor from top-right",
      pointerStart: { x: 824, y: 116 },
      pointerMove: { x: 904, y: 76 },
      expected: { height: "460px", left: "224px", top: "76px", width: "680px" },
    },
    {
      name: "bottom-left",
      label: "Resize floating editor from bottom-left",
      pointerStart: { x: 224, y: 536 },
      pointerMove: { x: 104, y: 616 },
      expected: { height: "500px", left: "104px", top: "116px", width: "720px" },
    },
    {
      name: "bottom-right",
      label: "Resize floating editor from bottom-right",
      pointerStart: { x: 824, y: 536 },
      pointerMove: { x: 1400, y: 900 },
      expected: { height: "628px", left: "224px", top: "116px", width: "960px" },
    },
  ])("lets the unpinned desktop editor resize from the $name corner", ({
    expected,
    label,
    pointerMove,
    pointerStart,
  }) => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
      store.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx"]);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "app",
          savedContent: "app",
          baseHash: "hash-app",
          isDirty: false,
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Unpin editor view" }));

    const page = document.querySelector(".workspace-page") as HTMLElement;
    const overlay = screen
      .getByTestId("code-editor-host")
      .closest(".workspace-main-stage__editor-overlay") as HTMLElement;
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        bottom: 760,
        height: 720,
        left: 0,
        right: 1200,
        top: 40,
        width: 1200,
        x: 0,
        y: 40,
        toJSON: () => undefined,
      }),
    });
    Object.defineProperty(overlay, "getBoundingClientRect", {
      value: () => ({
        bottom: 536,
        height: 420,
        left: 224,
        right: 824,
        top: 116,
        width: 600,
        x: 224,
        y: 116,
        toJSON: () => undefined,
      }),
    });

    const resizeHandle = screen.getByRole("button", { name: label });
    fireEvent.pointerDown(resizeHandle, {
      button: 0,
      clientX: pointerStart.x,
      clientY: pointerStart.y,
      pointerId: 3,
    });

    expect(document.body).toHaveClass("is-resizing-floating-editor");

    fireEvent.pointerMove(window, {
      clientX: pointerMove.x,
      clientY: pointerMove.y,
      pointerId: 3,
    });
    fireEvent.pointerUp(window, { clientX: pointerMove.x, clientY: pointerMove.y, pointerId: 3 });

    expect(overlay).toHaveStyle(expected);
    expect(document.body).not.toHaveClass("is-resizing-floating-editor");
  });

  it("lets the floating editor restore icon drag freely over the workspace page", () => {
    const store = renderDesktopView("explorer");
    act(() => {
      store.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx"]);
      store.set(openFilesAtomFamily("ws-test"), {
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "app",
          savedContent: "app",
          baseHash: "hash-app",
          isDirty: false,
        },
      });
    });

    const page = document.querySelector(".workspace-page") as HTMLElement;
    const stage = document.querySelector(".workspace-main-stage") as HTMLElement;
    const restoreButton = screen.getByRole("button", { name: "Open editor view" });
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        bottom: 760,
        height: 760,
        left: 0,
        right: 1200,
        top: 0,
        width: 1200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }),
    });
    Object.defineProperty(stage, "getBoundingClientRect", {
      value: () => ({
        bottom: 568,
        height: 520,
        left: 320,
        right: 1184,
        top: 48,
        width: 864,
        x: 320,
        y: 48,
        toJSON: () => undefined,
      }),
    });
    Object.defineProperty(restoreButton, "getBoundingClientRect", {
      value: () => ({
        bottom: 552,
        height: 40,
        left: 1144,
        right: 1184,
        top: 512,
        width: 40,
        x: 1144,
        y: 512,
        toJSON: () => undefined,
      }),
    });

    fireEvent.pointerDown(restoreButton, { button: 0, clientX: 1164, clientY: 532, pointerId: 1 });
    fireEvent.pointerMove(restoreButton, { clientX: 160, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(restoreButton, { clientX: 160, clientY: 120, pointerId: 1 });

    expect(restoreButton).toHaveStyle({ left: "-180px", top: "52px" });
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });
});
