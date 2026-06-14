// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../../test-utils/workspace-state";
import {
  activeFilePathAtomFamily,
  type GitDiffPreview,
  gitDiffPreviewAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
} from "../../atoms";
import { WorkspaceMobileView } from "./workspace-mobile-view";

vi.hoisted(() => {
  const matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
});

let currentStore: ReturnType<typeof createStore> | null = null;

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      "action.back": "Back",
      "action.close": "Close",
      "action.create_session": "Create session",
      "action.save_file": "Save File",
      "code_editor.mode_diff": "Diff",
      "code_editor.mode_edit": "Edit",
      "code_editor.mode_preview": "Preview",
      "code_editor.edit_as_text": "Edit as text",
      "code_editor.preview_as_image": "Preview as image",
      "code_editor.saving": "Saving",
      "file.title": "File",
      "mobile.empty.files_terminal_hint": "Use files or terminal to get started.",
      "mobile.empty.start_session": "Start session",
      "mobile.files.editor_fallback": "Editor",
      "mobile.sheet.dismiss": "Dismiss sheet",
      "workspace.sidebar.explorer": "Explorer",
      "workspace.sidebar.search": "Search",
      "workspace.sidebar.source_control": "Source Control",
    };

    if (key === "mobile.sheet.region") {
      return `Sheet ${params?.title ?? ""}`.trim();
    }

    return translations[key] ?? key;
  },
}));

vi.mock("../../../agent-panes/views/shared/session-card", () => ({
  SessionCard: () => <div data-testid="session-card" />,
}));

vi.mock("../../../supervisor/views/mobile/mobile-supervisor-sheet", () => ({
  MobileSupervisorSheet: () => <div data-testid="mobile-supervisor-sheet" />,
}));

vi.mock("../../../terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock("../shared/workspace-launch-modal", () => ({
  WorkspaceLaunchModal: () => <div data-testid="workspace-launch-modal" />,
}));

vi.mock("../shared/workspace-status-bar", () => ({
  WorkspaceStatusBar: () => <div data-testid="workspace-status-bar" />,
}));

vi.mock("./hooks/use-mobile-layout-mode", () => ({
  useMobileLayoutMode: () => "compact",
}));

vi.mock("./hooks/use-mobile-motion-mode", () => ({
  useMobileMotionMode: () => "full",
}));

vi.mock("./hooks/use-visual-viewport-inset", () => ({
  useVisualViewportInset: () => 0,
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

vi.mock("../../actions/use-workspace-ui-state-persistence", () => ({
  useWorkspaceUiStatePersistence: () => ({
    persistUiState: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("../../../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHeaderActions: ({
    state,
    variant = "full",
  }: {
    state: {
      activeDiffChange?: GitDiffPreview | null;
      activeFilePath?: string | null;
      handleClose: () => Promise<void> | void;
    };
    variant?: "full" | "mobile";
  }) =>
    variant === "mobile" && (state.activeFilePath || state.activeDiffChange) ? (
      <div className="mobile-sheet__header-actions">
        <button
          type="button"
          className="mobile-sheet__action"
          onClick={() => void state.handleClose()}
          aria-label="Close"
        >
          Close
        </button>
      </div>
    ) : null,
  CodeEditorHost: () => null,
}));

vi.mock("../../../code-editor/actions/use-code-editor-actions", () => ({
  useCodeEditorActions: () => {
    const store = currentStore;
    const activeFilePath = store?.get(activeFilePathAtomFamily("ws-test")) ?? null;
    const diffPreview = store?.get(gitDiffPreviewAtomFamily("ws-test")) ?? null;
    const activeDiffChange =
      diffPreview &&
      (((diffPreview.kind === "worktree-file-diff" ||
        diffPreview.kind === "search-replace-file-diff") &&
        diffPreview.path === activeFilePath) ||
        diffPreview.kind === "commit-file-list" ||
        diffPreview.kind === "commit-file-diff")
        ? diffPreview
        : null;

    return {
      activeFilePath,
      activeDiffChange,
      canDiff: false,
      canEdit: false,
      canPreview: false,
      canSave: false,
      handleClose: async () => {
        if (!store) {
          return;
        }

        const currentDiffPreview = store.get(gitDiffPreviewAtomFamily("ws-test"));
        if (currentDiffPreview?.kind === "commit-file-diff") {
          store.set(gitDiffPreviewAtomFamily("ws-test"), currentDiffPreview.parentList);
          return;
        }

        if (currentDiffPreview?.kind === "commit-file-list") {
          store.set(gitDiffPreviewAtomFamily("ws-test"), null);
          return;
        }

        const currentActiveFilePath = store.get(activeFilePathAtomFamily("ws-test"));
        if (currentActiveFilePath) {
          store.set(activeFilePathAtomFamily("ws-test"), null);
        }
      },
      handleSave: vi.fn(),
      isImageFile: false,
      isSaving: false,
      isSvgTextBacked: false,
      mode: "edit",
      openInDiffMode: vi.fn(),
      setMode: vi.fn(),
      toggleSvgTextMode: vi.fn(),
    };
  },
}));

vi.mock("./mobile-agent-sheet", () => ({
  MobileAgentSheet: () => <div data-testid="mobile-agent-sheet" />,
}));

vi.mock("./mobile-dock", () => ({
  MobileDock: ({
    activeItem,
    onSelectItem,
  }: {
    activeItem: "agent" | "files" | "terminal" | null;
    onSelectItem: (item: "agent" | "files" | "terminal") => void;
  }) => (
    <div data-testid="mobile-dock" data-active-item={activeItem ?? ""}>
      <button type="button" onClick={() => onSelectItem("files")}>
        Files
      </button>
    </div>
  ),
}));

vi.mock("./mobile-files-sheet", () => ({
  MobileFilesSheet: ({
    route,
    onRouteChange,
  }: {
    route: { kind: "root" } | { kind: "detail"; path?: string; title?: string };
    onRouteChange?: (
      route: { kind: "root" } | { kind: "detail"; path?: string; title?: string }
    ) => void;
  }) =>
    route.kind === "root" ? (
      <div data-testid="mobile-files-sheet-root">
        <button
          type="button"
          onClick={() =>
            onRouteChange?.({
              kind: "detail",
              path: "src/a.ts",
              title: "a.ts",
            })
          }
        >
          Open a.ts
        </button>
        <button
          type="button"
          onClick={() =>
            onRouteChange?.({
              kind: "detail",
              path: "abc123",
              title: "abc123 · commit subject",
            })
          }
        >
          Open commit preview
        </button>
      </div>
    ) : (
      <div data-testid="mobile-files-sheet-detail">{route.title ?? route.path}</div>
    ),
}));

vi.mock("./mobile-topbar", () => ({
  MobileTopBar: () => <div data-testid="mobile-topbar" />,
}));

vi.mock("./mobile-workspace-drawer", () => ({
  MobileWorkspaceDrawer: () => null,
}));

function createSendCommandMock() {
  return vi.fn().mockImplementation(async (op: string) => {
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

    if (op === "session.list") {
      return [];
    }

    return null;
  });
}

function renderMobileView(
  options: {
    activePath: string | null;
    openFiles: Record<string, OpenFile>;
    diffPreview?: GitDiffPreview | null;
  } = { activePath: null, openFiles: {} }
) {
  const store = createStore();
  currentStore = store;
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand: createSendCommandMock() } as never);
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
  store.set(activeFilePathAtomFamily("ws-test"), options.activePath);
  store.set(openFilesAtomFamily("ws-test"), options.openFiles as never);
  if (options.diffPreview !== undefined) {
    store.set(gitDiffPreviewAtomFamily("ws-test"), options.diffPreview as never);
  }

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkspaceMobileView />
      </MemoryRouter>
    </Provider>
  );

  return store;
}

describe("WorkspaceMobileView", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    currentStore = null;
    vi.restoreAllMocks();
  });

  it("closes the mobile files sheet when the mobile header closes the current file", async () => {
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
        "src/b.ts": {
          kind: "text",
          path: "src/b.ts",
          content: "beta",
          savedContent: "beta",
          baseHash: "hash-b",
          isDirty: false,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a.ts" }));

    expect(screen.getByRole("heading", { level: 2, name: "a.ts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
      expect(screen.queryByTestId("mobile-files-sheet-root")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-files-sheet-detail")).not.toBeInTheDocument();
    });
  });

  it("closes the mobile files sheet when the mobile header closes the final open editor", async () => {
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a.ts" }));

    expect(screen.getByRole("heading", { level: 2, name: "a.ts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
      expect(screen.queryByTestId("mobile-files-sheet-root")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-files-sheet-detail")).not.toBeInTheDocument();
    });
  });

  it("keeps commit preview detail bound to the commit route and closes the preview without closing the background file", async () => {
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
      diffPreview: {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open commit preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 2, name: "abc123 · commit subject" })
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/a.ts");
      expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "a.ts" })).toBeInTheDocument();
    });
  });

  it("preserves an active commit preview after editor tabs clear open editors", async () => {
    const diffPreview = {
      kind: "commit-file-list" as const,
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified" as const,
          renderAs: "text" as const,
        },
      ],
    };
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
      diffPreview,
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.queryByRole("heading", { level: 2, name: /Open Files|打开的文件/i })).toBeNull();

    act(() => {
      store.set(openFilesAtomFamily("ws-test"), {});
      store.set(activeFilePathAtomFamily("ws-test"), null);
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
      expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual(diffPreview);
    });

    fireEvent.click(screen.getByRole("button", { name: "Open commit preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 2, name: "abc123 · commit subject" })
      ).toBeInTheDocument();
    });
  });

  it("shows the explorer title for the root files sheet", () => {
    renderMobileView({
      activePath: null,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));

    expect(screen.getByTestId("mobile-files-sheet-root")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sheet Explorer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Explorer" })).toBeInTheDocument();
  });

  it("does not expose the dev browser sheet from the mobile dock", async () => {
    renderMobileView();

    expect(screen.queryByRole("button", { name: "Browser" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("dev-browser-surface")).not.toBeInTheDocument();
    });
  });
});
